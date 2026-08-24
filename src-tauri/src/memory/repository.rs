//! SQL for the memory domain. The only module that writes memory rows.

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use super::domain::{
    Memory, MemoryQuery, MemoryRecord, MemoryScope, MemorySource, MemoryStatus, MemoryType,
    MemoryUpdate, NewMemory, RelationshipState, Sensitivity, SourceKind, MAX_CONTENT_CHARS,
    MAX_SUMMARY_CHARS,
};
use super::error::{MemoryError, MemoryResult};
use super::policy::{self, AcceptedMemory};
use super::storage::MemoryStore;

/// Default page size for Memory Center listings.
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;
/// Shortest query the trigram FTS index can answer.
const TRIGRAM_MIN_CHARS: usize = 3;

/// How many rows a query may return.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RowBound {
    /// Frontend listings: clamped, so a buggy or hostile caller cannot pull the
    /// whole database into a window at once.
    Capped,
    /// Export only. The user is asking for a complete copy of their own data, so
    /// a cap here would hand them a silently incomplete file.
    Unbounded,
}

/// A clock, so tests get deterministic timestamps.
pub trait Clock: Send + Sync {
    /// RFC 3339 UTC "now".
    fn now(&self) -> String;
    /// RFC 3339 UTC now plus `hours`.
    fn now_plus_hours(&self, hours: i64) -> String;
}

/// The real clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

fn format(instant: chrono::DateTime<chrono::Utc>) -> String {
    instant.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

impl Clock for SystemClock {
    fn now(&self) -> String {
        format(chrono::Utc::now())
    }

    fn now_plus_hours(&self, hours: i64) -> String {
        format(chrono::Utc::now() + chrono::Duration::hours(hours))
    }
}

/// Everything a caller can do to memory, with policy already enforced.
pub struct MemoryRepository<C: Clock> {
    store: MemoryStore,
    clock: C,
}

impl<C: Clock> MemoryRepository<C> {
    pub fn new(store: MemoryStore, clock: C) -> Self {
        Self { store, clock }
    }

    /// The underlying store, for tests that inspect the database directly.
    #[cfg(test)]
    pub fn store(&self) -> &MemoryStore {
        &self.store
    }

    pub fn clock(&self) -> &C {
        &self.clock
    }

    /// Create a memory the user explicitly asked for.
    ///
    /// A stable fact with a key supersedes the previous active value instead of
    /// piling up duplicates.
    pub fn create(&self, request: &NewMemory) -> MemoryResult<Memory> {
        let accepted = policy::accept_new(
            request,
            &self.clock.now_plus_hours(policy::MOOD_TTL_HOURS),
        )?;
        let now = self.clock.now();
        let source_kind = request.source_kind;
        let conversation_id = request.conversation_id.clone();
        let message_id = request.message_id.clone();

        self.store.with_transaction(|tx| {
            expire_due(tx, &now)?;
            let superseded = supersede_previous(tx, &accepted, &now)?;
            let memory = insert_memory(tx, &accepted, source_kind, superseded.as_deref(), &now)?;
            insert_source(
                tx,
                &memory.id,
                conversation_id.as_deref(),
                message_id.as_deref(),
                source_kind,
                &now,
            )?;
            record_event(tx, &memory.id, "created", &now)?;
            Ok(memory)
        })
    }

    /// Edit a memory, refusing to overwrite a newer revision.
    pub fn update(&self, request: &MemoryUpdate) -> MemoryResult<Memory> {
        let content = request.content.trim();
        let char_count = content.chars().count();
        if char_count == 0 {
            return Err(MemoryError::validation_failed("empty content"));
        }
        if char_count > MAX_CONTENT_CHARS {
            return Err(MemoryError::validation_failed("content too long"));
        }
        if policy::rejects_inferred_label(content) {
            return Err(MemoryError::validation_failed(
                "inferred personal labels are not storable",
            ));
        }
        let sensitivity = policy::classify(content);
        match sensitivity {
            Sensitivity::Secret => {
                return Err(MemoryError::secret_rejected(
                    "credential-like content is never stored",
                ))
            }
            Sensitivity::Sensitive if !request.sensitive_confirmed => {
                return Err(MemoryError::sensitive_confirmation_required(
                    "sensitive content needs explicit confirmation",
                ))
            }
            _ => {}
        }
        if let Some(importance) = request.importance {
            if !(1..=5).contains(&importance) {
                return Err(MemoryError::validation_failed("importance out of range"));
            }
        }

        let now = self.clock.now();
        let content = content.to_owned();
        self.store.with_transaction(|tx| {
            let stored = load_memory(tx, &request.id)?
                .ok_or_else(|| MemoryError::not_found("no such memory"))?;
            if stored.revision != request.expected_revision {
                return Err(MemoryError::conflict("memory changed in another window"));
            }
            let importance = request.importance.unwrap_or(stored.importance);
            tx.execute(
                "UPDATE memories \
                 SET content = ?1, sensitivity = ?2, importance = ?3, expires_at = ?4, \
                     updated_at = ?5, revision = revision + 1 \
                 WHERE id = ?6 AND revision = ?7",
                params![
                    content,
                    sensitivity.as_str(),
                    importance,
                    request.expires_at.as_deref(),
                    now,
                    request.id,
                    request.expected_revision,
                ],
            )
            .map_err(storage_error)?;
            record_event(tx, &request.id, "updated", &now)?;
            load_memory(tx, &request.id)?
                .ok_or_else(|| MemoryError::not_found("memory vanished during update"))
        })
    }

    /// List memories with provenance, honoring scope isolation.
    ///
    /// Bounded: the result is capped so no single window can pull the whole
    /// database at once. Use [`Self::export_records`] when the user asked for a
    /// complete copy.
    pub fn list(&self, query: &MemoryQuery) -> MemoryResult<Vec<MemoryRecord>> {
        self.list_bounded(query, RowBound::Capped)
    }

    /// Every matching memory with provenance, with no row cap.
    ///
    /// Only for export: a truncated export would hand the user an incomplete
    /// copy of their own data while still reporting success.
    pub fn export_records(&self, query: &MemoryQuery) -> MemoryResult<Vec<MemoryRecord>> {
        self.list_bounded(query, RowBound::Unbounded)
    }

    fn list_bounded(
        &self,
        query: &MemoryQuery,
        bound: RowBound,
    ) -> MemoryResult<Vec<MemoryRecord>> {
        let now = self.clock.now();
        self.store.with_transaction(|tx| {
            expire_due(tx, &now)?;
            let memories = select_memories(tx, query, bound)?;
            let mut records = Vec::with_capacity(memories.len());
            for memory in memories {
                let sources = select_sources(tx, &memory.id)?;
                let linked_task_ids = select_task_links(tx, &memory.id)?;
                records.push(MemoryRecord {
                    memory,
                    sources,
                    linked_task_ids,
                });
            }
            Ok(records)
        })
    }

    /// Hard-delete one memory and everything that carries its content.
    pub fn forget(&self, id: &str) -> MemoryResult<Memory> {
        let now = self.clock.now();
        let memory = self.store.with_transaction(|tx| {
            let stored =
                load_memory(tx, id)?.ok_or_else(|| MemoryError::not_found("no such memory"))?;
            // ON DELETE CASCADE clears sources/links/FTS via triggers; the
            // audit row deliberately survives without content.
            tx.execute("DELETE FROM memories WHERE id = ?1", params![id])
                .map_err(storage_error)?;
            record_event(tx, id, "forgotten", &now)?;
            Ok(stored)
        })?;
        self.store.checkpoint()?;
        Ok(memory)
    }

    /// Delete every memory in a scope. `persona_id` clears that persona only.
    pub fn clear(&self, scope: Option<MemoryScope>, persona_id: Option<&str>) -> MemoryResult<u64> {
        let now = self.clock.now();
        let removed = self.store.with_transaction(|tx| {
            let removed = match (scope, persona_id) {
                (Some(MemoryScope::Persona), Some(persona)) => tx
                    .execute(
                        "DELETE FROM memories WHERE scope = 'persona' AND persona_id = ?1",
                        params![persona],
                    )
                    .map_err(storage_error)?,
                (Some(scope), _) => tx
                    .execute(
                        "DELETE FROM memories WHERE scope = ?1",
                        params![scope.as_str()],
                    )
                    .map_err(storage_error)?,
                (None, Some(persona)) => tx
                    .execute(
                        "DELETE FROM memories WHERE scope = 'persona' AND persona_id = ?1",
                        params![persona],
                    )
                    .map_err(storage_error)?,
                (None, None) => {
                    tx.execute("DELETE FROM memory_candidates", [])
                        .map_err(storage_error)?;
                    tx.execute("DELETE FROM relationship_states", [])
                        .map_err(storage_error)?;
                    tx.execute("DELETE FROM memories", [])
                        .map_err(storage_error)?
                }
            };
            if let Some(persona) = persona_id {
                tx.execute(
                    "DELETE FROM relationship_states WHERE persona_id = ?1",
                    params![persona],
                )
                .map_err(storage_error)?;
                tx.execute(
                    "DELETE FROM memory_candidates WHERE persona_id = ?1",
                    params![persona],
                )
                .map_err(storage_error)?;
            }
            record_event(tx, "*", "cleared", &now)?;
            Ok(removed as u64)
        })?;
        // Clearing is the one place a user expects the file to shrink.
        self.store.compact()?;
        Ok(removed)
    }

    /// Detach a conversation's provenance, deleting memories that had no other
    /// source. Explicit and multi-source memories survive.
    pub fn forget_conversation(&self, conversation_id: &str) -> MemoryResult<u64> {
        let now = self.clock.now();
        let removed = self.store.with_transaction(|tx| {
            let orphans: Vec<String> = tx
                .prepare(
                    "SELECT m.id FROM memories m \
                     WHERE EXISTS (SELECT 1 FROM memory_sources s \
                                   WHERE s.memory_id = m.id AND s.conversation_id = ?1) \
                       AND NOT EXISTS (SELECT 1 FROM memory_sources s \
                                       WHERE s.memory_id = m.id \
                                         AND IFNULL(s.conversation_id, '') <> ?1)",
                    )
                .map_err(storage_error)?
                .query_map(params![conversation_id], |row| row.get(0))
                .map_err(storage_error)?
                .collect::<Result<_, _>>()
                .map_err(storage_error)?;

            for id in &orphans {
                tx.execute("DELETE FROM memories WHERE id = ?1", params![id])
                    .map_err(storage_error)?;
                record_event(tx, id, "forgotten", &now)?;
            }
            // Surviving memories lose only the deleted conversation's link.
            tx.execute(
                "DELETE FROM memory_sources WHERE conversation_id = ?1",
                params![conversation_id],
            )
            .map_err(storage_error)?;
            Ok(orphans.len() as u64)
        })?;
        self.store.checkpoint()?;
        Ok(removed)
    }

    /// Read (creating on first use) a persona's relationship state.
    pub fn relationship(&self, persona_id: &str) -> MemoryResult<RelationshipState> {
        let persona = persona_id.trim();
        if persona.is_empty() {
            return Err(MemoryError::validation_failed("empty persona id"));
        }
        let now = self.clock.now();
        self.store.with_transaction(|tx| {
            tx.execute(
                "INSERT INTO relationship_states (persona_id, familiarity, summary, revision, updated_at) \
                 VALUES (?1, 0, '', 1, ?2) ON CONFLICT (persona_id) DO NOTHING",
                params![persona, now],
            )
            .map_err(storage_error)?;
            load_relationship(tx, persona)?
                .ok_or_else(|| MemoryError::not_found("relationship state missing"))
        })
    }

    /// Update a persona's relationship summary with an optimistic revision.
    pub fn set_relationship_summary(
        &self,
        persona_id: &str,
        summary: &str,
        expected_revision: i64,
    ) -> MemoryResult<RelationshipState> {
        let summary = summary.trim();
        if summary.chars().count() > MAX_SUMMARY_CHARS {
            return Err(MemoryError::validation_failed("summary too long"));
        }
        if policy::classify(summary) != Sensitivity::Normal {
            return Err(MemoryError::validation_failed(
                "relationship summaries must stay non-sensitive",
            ));
        }
        let persona = persona_id.trim().to_owned();
        let summary = summary.to_owned();
        let now = self.clock.now();
        self.relationship(&persona)?;
        self.store.with_transaction(|tx| {
            let stored = load_relationship(tx, &persona)?
                .ok_or_else(|| MemoryError::not_found("relationship state missing"))?;
            if stored.revision != expected_revision {
                return Err(MemoryError::conflict("relationship changed elsewhere"));
            }
            tx.execute(
                "UPDATE relationship_states \
                 SET summary = ?1, revision = revision + 1, updated_at = ?2 \
                 WHERE persona_id = ?3 AND revision = ?4",
                params![summary, now, persona, expected_revision],
            )
            .map_err(storage_error)?;
            load_relationship(tx, &persona)?
                .ok_or_else(|| MemoryError::not_found("relationship state missing"))
        })
    }

    /// Retrieve candidates for prompt injection.
    ///
    /// Deliberately not [`Self::list`]: a chat turn must not pay for per-record
    /// provenance lookups or one expiry write per keyword. This runs a single
    /// expiry pass and a single bounded query, and returns bare memories.
    ///
    /// `keywords` are matched as substrings rather than through FTS because the
    /// caller's CJK bigrams are shorter than the trigram index can answer.
    pub fn retrieve(
        &self,
        persona_id: &str,
        keywords: &[String],
        anchor_types: &[MemoryType],
        limit: i64,
    ) -> MemoryResult<Vec<Memory>> {
        let now = self.clock.now();
        self.store.with_transaction(|tx| {
            expire_due(tx, &now)?;

            // Build the relevance clause first, then assemble bind values in
            // statement order: persona, relevance values, limit.
            let mut relevance: Vec<String> = Vec::new();
            let mut relevance_values: Vec<rusqlite::types::Value> = Vec::new();

            if !anchor_types.is_empty() {
                let placeholders = vec!["?"; anchor_types.len()].join(", ");
                relevance.push(format!("m.type IN ({placeholders})"));
                for memory_type in anchor_types {
                    relevance_values.push(memory_type.as_str().to_owned().into());
                }
            }
            for keyword in keywords {
                relevance.push("m.content LIKE ? ESCAPE '\\'".to_owned());
                relevance_values.push(format!("%{}%", escape_like(keyword)).into());
            }
            if relevance.is_empty() {
                return Ok(Vec::new());
            }

            // Scope isolation: this persona's own memories plus the shared ones,
            // never another persona's.
            let sql = format!(
                "SELECT m.* FROM memories m \
                 WHERE m.status = 'active' \
                   AND (m.scope = 'global' OR (m.scope = 'persona' AND m.persona_id = ?)) \
                   AND ({}) \
                 ORDER BY m.importance DESC, m.updated_at DESC, m.id LIMIT ?",
                relevance.join(" OR ")
            );

            let mut values: Vec<rusqlite::types::Value> =
                vec![persona_id.to_owned().into()];
            values.extend(relevance_values);
            values.push(limit.clamp(1, MAX_LIMIT).into());

            let mut statement = tx.prepare(&sql).map_err(storage_error)?;
            let rows = statement
                .query_map(rusqlite::params_from_iter(values), row_to_memory)
                .map_err(storage_error)?;
            rows.collect::<Result<_, _>>().map_err(storage_error)
        })
    }

    /// Every persona's relationship state, for export.
    pub fn all_relationships(&self) -> MemoryResult<Vec<RelationshipState>> {
        self.store.with_connection(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT persona_id, familiarity, summary, revision, updated_at \
                     FROM relationship_states ORDER BY persona_id",
                )
                .map_err(storage_error)?;
            let rows = statement
                .query_map([], |row| {
                    Ok(RelationshipState {
                        persona_id: row.get(0)?,
                        familiarity: row.get(1)?,
                        summary: row.get(2)?,
                        revision: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<Result<_, _>>().map_err(storage_error)
        })
    }

    /// Link an accepted memory to a task that already exists in settings.
    pub fn link_task(&self, memory_id: &str, task_id: &str) -> MemoryResult<()> {
        let now = self.clock.now();
        self.store.with_transaction(|tx| {
            if load_memory(tx, memory_id)?.is_none() {
                return Err(MemoryError::not_found("no such memory"));
            }
            tx.execute(
                "INSERT INTO memory_task_links (memory_id, task_id, created_at) \
                 VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING",
                params![memory_id, task_id, now],
            )
            .map_err(storage_error)?;
            Ok(())
        })
    }

    /// Remove a link. Never touches the task itself or the memory.
    pub fn unlink_task(&self, memory_id: &str, task_id: &str) -> MemoryResult<()> {
        self.store.with_transaction(|tx| {
            tx.execute(
                "DELETE FROM memory_task_links WHERE memory_id = ?1 AND task_id = ?2",
                params![memory_id, task_id],
            )
            .map_err(storage_error)?;
            Ok(())
        })
    }

    /// Drop every link to a task that no longer exists.
    pub fn unlink_task_everywhere(&self, task_id: &str) -> MemoryResult<u64> {
        self.store.with_transaction(|tx| {
            let removed = tx
                .execute(
                    "DELETE FROM memory_task_links WHERE task_id = ?1",
                    params![task_id],
                )
                .map_err(storage_error)?;
            Ok(removed as u64)
        })
    }
}

fn storage_error(error: rusqlite::Error) -> MemoryError {
    MemoryError::storage_unavailable(error.to_string())
}

/// Flip anything past its expiry to `expired` so it drops out of retrieval.
fn expire_due(tx: &Transaction<'_>, now: &str) -> MemoryResult<()> {
    tx.execute(
        "UPDATE memories SET status = 'expired', updated_at = ?1 \
         WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?1",
        params![now],
    )
    .map_err(storage_error)?;
    tx.execute(
        "DELETE FROM memory_candidates WHERE decision = 'pending' AND expires_at <= ?1",
        params![now],
    )
    .map_err(storage_error)?;
    Ok(())
}

/// A changed stable fact supersedes the previous active value with the same key.
fn supersede_previous(
    tx: &Transaction<'_>,
    accepted: &AcceptedMemory,
    now: &str,
) -> MemoryResult<Option<String>> {
    let Some(key) = accepted.memory_key.as_deref() else {
        return Ok(None);
    };
    if !accepted.memory_type.is_stable_fact() {
        return Ok(None);
    }
    let previous: Option<String> = tx
        .query_row(
            "SELECT id FROM memories \
             WHERE status = 'active' AND memory_key = ?1 AND scope = ?2 \
               AND IFNULL(persona_id, '') = IFNULL(?3, '')",
            params![key, accepted.scope.as_str(), accepted.persona_id.as_deref()],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?;
    if let Some(id) = previous.as_deref() {
        tx.execute(
            "UPDATE memories SET status = 'superseded', updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(storage_error)?;
        record_event(tx, id, "superseded", now)?;
    }
    Ok(previous)
}

fn insert_memory(
    tx: &Transaction<'_>,
    accepted: &AcceptedMemory,
    source_kind: SourceKind,
    supersedes_id: Option<&str>,
    now: &str,
) -> MemoryResult<Memory> {
    let id = uuid::Uuid::new_v4().to_string();
    // Explicit user statements are certain; extracted ones are proposals.
    let confidence = match source_kind {
        SourceKind::Explicit | SourceKind::Onboarding => 1.0_f64,
        SourceKind::Extracted | SourceKind::FollowUp => 0.7_f64,
    };
    tx.execute(
        "INSERT INTO memories (id, scope, persona_id, type, memory_key, content, status, \
                               confidence, importance, sensitivity, source_kind, valid_from, \
                               expires_at, created_at, updated_at, revision, supersedes_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9, ?10, ?11, ?12, ?11, ?11, 1, ?13)",
        params![
            id,
            accepted.scope.as_str(),
            accepted.persona_id.as_deref(),
            accepted.memory_type.as_str(),
            accepted.memory_key.as_deref(),
            accepted.content,
            confidence,
            accepted.importance,
            accepted.sensitivity.as_str(),
            source_kind.as_str(),
            now,
            accepted.expires_at.as_deref(),
            supersedes_id,
        ],
    )
    .map_err(storage_error)?;
    load_memory(tx, &id)?.ok_or_else(|| MemoryError::storage_unavailable("insert vanished"))
}

fn insert_source(
    tx: &Transaction<'_>,
    memory_id: &str,
    conversation_id: Option<&str>,
    message_id: Option<&str>,
    source_kind: SourceKind,
    now: &str,
) -> MemoryResult<()> {
    tx.execute(
        "INSERT INTO memory_sources (id, memory_id, conversation_id, message_id, source_kind, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING",
        params![
            uuid::Uuid::new_v4().to_string(),
            memory_id,
            conversation_id,
            message_id,
            source_kind.as_str(),
            now,
        ],
    )
    .map_err(storage_error)?;
    Ok(())
}

/// Audit metadata. Never called with content.
fn record_event(tx: &Transaction<'_>, memory_id: &str, action: &str, now: &str) -> MemoryResult<()> {
    tx.execute(
        "INSERT INTO memory_events (id, memory_id, action, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![
            uuid::Uuid::new_v4().to_string(),
            memory_id,
            action,
            now
        ],
    )
    .map_err(storage_error)?;
    Ok(())
}

fn row_to_memory(row: &Row<'_>) -> rusqlite::Result<Memory> {
    let scope: String = row.get("scope")?;
    let memory_type: String = row.get("type")?;
    let status: String = row.get("status")?;
    let sensitivity: String = row.get("sensitivity")?;
    let source_kind: String = row.get("source_kind")?;
    // The CHECK constraints guarantee these parse; a failure means the file was
    // edited outside the app, which we surface as a storage error.
    let invalid = |field: &str| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid {field} in database"),
            )),
        )
    };
    Ok(Memory {
        id: row.get("id")?,
        scope: MemoryScope::parse(&scope).map_err(|_| invalid("scope"))?,
        persona_id: row.get("persona_id")?,
        memory_type: MemoryType::parse(&memory_type).map_err(|_| invalid("type"))?,
        memory_key: row.get("memory_key")?,
        content: row.get("content")?,
        status: MemoryStatus::parse(&status).map_err(|_| invalid("status"))?,
        confidence: row.get("confidence")?,
        importance: row.get("importance")?,
        sensitivity: Sensitivity::parse(&sensitivity).map_err(|_| invalid("sensitivity"))?,
        source_kind: SourceKind::parse(&source_kind).map_err(|_| invalid("source_kind"))?,
        valid_from: row.get("valid_from")?,
        expires_at: row.get("expires_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        revision: row.get("revision")?,
        supersedes_id: row.get("supersedes_id")?,
    })
}

fn load_memory(connection: &Connection, id: &str) -> MemoryResult<Option<Memory>> {
    connection
        .query_row("SELECT * FROM memories WHERE id = ?1", params![id], |row| {
            row_to_memory(row)
        })
        .optional()
        .map_err(storage_error)
}

fn load_relationship(
    connection: &Connection,
    persona_id: &str,
) -> MemoryResult<Option<RelationshipState>> {
    connection
        .query_row(
            "SELECT persona_id, familiarity, summary, revision, updated_at \
             FROM relationship_states WHERE persona_id = ?1",
            params![persona_id],
            |row| {
                Ok(RelationshipState {
                    persona_id: row.get(0)?,
                    familiarity: row.get(1)?,
                    summary: row.get(2)?,
                    revision: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

fn select_sources(connection: &Connection, memory_id: &str) -> MemoryResult<Vec<MemorySource>> {
    let mut statement = connection
        .prepare(
            "SELECT conversation_id, message_id, source_kind, created_at \
             FROM memory_sources WHERE memory_id = ?1 ORDER BY created_at",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![memory_id], |row| {
            let kind: String = row.get(2)?;
            Ok(MemorySource {
                conversation_id: row.get(0)?,
                message_id: row.get(1)?,
                source_kind: SourceKind::parse(&kind).unwrap_or(SourceKind::Explicit),
                created_at: row.get(3)?,
            })
        })
        .map_err(storage_error)?;
    rows.collect::<Result<_, _>>().map_err(storage_error)
}

fn select_task_links(connection: &Connection, memory_id: &str) -> MemoryResult<Vec<String>> {
    let mut statement = connection
        .prepare("SELECT task_id FROM memory_task_links WHERE memory_id = ?1 ORDER BY created_at")
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![memory_id], |row| row.get(0))
        .map_err(storage_error)?;
    rows.collect::<Result<_, _>>().map_err(storage_error)
}

/// Build the filtered listing query.
///
/// Scope isolation is not optional: naming a persona returns that persona's
/// memories plus globals, never another persona's.
fn select_memories(
    connection: &Connection,
    query: &MemoryQuery,
    bound: RowBound,
) -> MemoryResult<Vec<Memory>> {
    let mut sql = String::from("SELECT m.* FROM memories m");
    let mut clauses: Vec<String> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(search) = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        // The trigram tokenizer needs at least three characters, which a CJK
        // keyword often does not have ("甜食"). Short queries fall back to a
        // bounded LIKE scan so search works at every input length.
        if search.chars().count() >= TRIGRAM_MIN_CHARS {
            sql.push_str(" JOIN memory_search s ON s.memory_id = m.id");
            clauses.push("memory_search MATCH ?".to_owned());
            values.push(fts_query(search).into());
        } else {
            clauses.push(
                "(m.content LIKE ? ESCAPE '\\' OR IFNULL(m.memory_key, '') LIKE ? ESCAPE '\\')"
                    .to_owned(),
            );
            let pattern = format!("%{}%", escape_like(search));
            values.push(pattern.clone().into());
            values.push(pattern.into());
        }
    }

    match (query.scope, query.persona_id.as_deref()) {
        (Some(MemoryScope::Global), _) => clauses.push("m.scope = 'global'".to_owned()),
        (Some(MemoryScope::Persona), Some(persona)) => {
            clauses.push("(m.scope = 'persona' AND m.persona_id = ?)".to_owned());
            values.push(persona.to_owned().into());
        }
        (Some(MemoryScope::Persona), None) => clauses.push("m.scope = 'persona'".to_owned()),
        (None, Some(persona)) => {
            clauses.push("(m.scope = 'global' OR (m.scope = 'persona' AND m.persona_id = ?))".to_owned());
            values.push(persona.to_owned().into());
        }
        (None, None) => {}
    }

    if let Some(types) = query.types.as_deref().filter(|types| !types.is_empty()) {
        let placeholders = vec!["?"; types.len()].join(", ");
        clauses.push(format!("m.type IN ({placeholders})"));
        for memory_type in types {
            values.push(memory_type.as_str().to_owned().into());
        }
    }

    let statuses: Vec<MemoryStatus> = query
        .statuses
        .clone()
        .filter(|statuses| !statuses.is_empty())
        .unwrap_or_else(|| vec![MemoryStatus::Active]);
    let placeholders = vec!["?"; statuses.len()].join(", ");
    clauses.push(format!("m.status IN ({placeholders})"));
    for status in &statuses {
        values.push(status.as_str().to_owned().into());
    }

    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY m.importance DESC, m.updated_at DESC, m.id LIMIT ?");
    let limit = match bound {
        RowBound::Capped => query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
        // -1 is SQLite's "no limit". An explicit smaller request is still
        // honored so an export of one scope can stay narrow.
        RowBound::Unbounded => query.limit.filter(|limit| *limit > 0).unwrap_or(-1),
    };
    values.push(limit.into());

    let mut statement = connection.prepare(&sql).map_err(storage_error)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values), row_to_memory)
        .map_err(storage_error)?;
    rows.collect::<Result<_, _>>().map_err(storage_error)
}

/// Turn user input into a safe FTS5 query: every token is quoted so FTS syntax
/// in memory text or search input cannot change the query's meaning.
fn fts_query(input: &str) -> String {
    let tokens: Vec<String> = input
        .split_whitespace()
        .map(|token| token.replace('"', ""))
        .filter(|token| token.chars().count() >= TRIGRAM_MIN_CHARS)
        .map(|token| format!("\"{token}\""))
        .collect();
    if tokens.is_empty() {
        // Matches nothing rather than erroring on an empty MATCH expression.
        return "\"\"".to_owned();
    }
    tokens.join(" ")
}

/// Neutralize LIKE wildcards in the short-query fallback path.
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
