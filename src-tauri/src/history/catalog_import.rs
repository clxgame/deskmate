use super::{catalog::CatalogStore, catalog_model::*, native_index::NativeSessionMetadata, HistorySession};
use std::collections::HashMap;

pub(crate) fn register_sources(store: &CatalogStore, sessions: &[HistorySession], index: &[NativeSessionMetadata], workspace: &str, records: &[crate::agent::RunRecord]) -> Result<(), String> {
    store.update(|rows| {
        for record in index {
            let identity = CatalogIdentity::Native {
                sidecar_id: SIDECAR_ID.into(), directory: canonical_directory(&record.workspace_path), session_id: record.session_id.clone(),
            };
            if rows.iter().any(|row| row.key() == identity.key()) { continue; }
            let source = if record.source == "light_chat" { ConversationSource::LightChat } else { ConversationSource::Workbench };
            rows.push(new_entry(identity, String::new(), source, record.created_at, record.updated_at));
        }
        for record in records {
            let Some(id) = &record.session_id else { continue; };
            let directory = canonical_directory(&record.workspace_path.to_string_lossy());
            let identity = CatalogIdentity::Native { sidecar_id: SIDECAR_ID.into(), directory: directory.clone(), session_id: id.clone() };
            if !rows.iter().any(|row| row.key() == identity.key()) {
                rows.push(new_entry(identity.clone(), String::new(), ConversationSource::Workbench, 0, 0));
            }
            if let Some(row) = rows.iter_mut().find(|row| row.key() == identity.key()) {
                row.ownership = Ownership::Agent;
                row.runtime = if records.iter().any(|candidate| candidate.outcome.is_none()
                    && candidate.session_id == record.session_id
                    && canonical_directory(&candidate.workspace_path.to_string_lossy()) == directory) {
                    RuntimeState::Running
                } else { RuntimeState::Idle };
            }
        }
        let mut projections = HashMap::new();
        for session in sessions {
            if session.local_link.is_some() { continue; }
            let directory = match &session.origin_run_id {
                Some(origin) => records.iter().find(|record| &record.run_id == origin && record.session_id.as_deref() == Some(&session.id))
                    .map(|record| canonical_directory(&record.workspace_path.to_string_lossy())),
                None => {
                    let workspace = canonical_directory(workspace);
                    let registered = index.iter().any(|record| record.session_id == session.id && canonical_directory(&record.workspace_path) == workspace)
                        || rows.iter().any(|row| row.source == ConversationSource::LightChat && matches!(&row.identity,
                            CatalogIdentity::Native { sidecar_id, directory, session_id } if sidecar_id == SIDECAR_ID && directory == &workspace && session_id == &session.id));
                    registered.then_some(workspace)
                }
            };
            if let Some(directory) = directory {
                let identity = CatalogIdentity::Native { sidecar_id: SIDECAR_ID.into(), directory, session_id: session.id.clone() };
                if rows.iter().any(|row| row.key() == identity.key()) {
                    projections.insert(session.id.clone(), identity.key());
                    continue;
                }
            }
            let identity = CatalogIdentity::Legacy { history_id: session.id.clone() };
            if rows.iter().any(|row| row.key() == identity.key()) { continue; }
            let mut row = new_entry(identity, session.title.clone(), ConversationSource::Legacy, session.created, session.updated);
            row.availability = Availability::Available;
            row.runtime = RuntimeState::Idle;
            if session.deleted { row.tombstone = Some(DeletionTombstone { requested_at: session.updated, remote_deleted: true }); }
            rows.push(row);
        }
        for (id, key) in projections {
            let legacy = rows.iter().find(|row| matches!(&row.identity, CatalogIdentity::Legacy { history_id } if history_id == &id)).cloned();
            let snapshot = sessions.iter().find(|session| session.id == id);
            if let Some(native) = rows.iter_mut().find(|row| row.key() == key) {
                if let Some(legacy) = legacy {
                    if native.user_title.is_none() { native.user_title = legacy.user_title; }
                    native.pinned |= legacy.pinned;
                    native.archived |= legacy.archived;
                    if native.tombstone.is_none() { native.tombstone = legacy.tombstone; }
                }
                if let Some(snapshot) = snapshot {
                    if native.title.is_empty() { native.title = snapshot.title.clone(); }
                    if native.created == 0 { native.created = snapshot.created; }
                    native.updated = native.updated.max(snapshot.updated);
                    if snapshot.deleted && native.tombstone.is_none() {
                        native.tombstone = Some(DeletionTombstone { requested_at: snapshot.updated, remote_deleted: true });
                    }
                }
            }
            rows.retain(|row| !matches!(&row.identity, CatalogIdentity::Legacy { history_id } if history_id == &id));
        }
        Ok(())
    })
}

pub(crate) fn canonical_directory(directory: &str) -> String {
    let path = std::path::Path::new(directory);
    let path = path.canonicalize().unwrap_or_else(|_| path.to_owned());
    super::catalog_model::canonical_directory(&path.to_string_lossy()).unwrap_or_else(|_| directory.to_owned())
}

pub(crate) fn new_entry(identity: CatalogIdentity, title: String, source: ConversationSource, created: u64, updated: u64) -> CatalogEntry {
    CatalogEntry { identity, title, user_title: None, source, created, updated, pinned: false, archived: false, availability: Availability::Stale, ownership: Ownership::Unowned, runtime: RuntimeState::Unknown, tombstone: None }
}

