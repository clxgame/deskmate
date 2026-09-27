use super::*;
use crate::memory::{
    commands::MemoryState,
    domain::MemoryQuery,
    repository::{MemoryRepository, SystemClock},
};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

pub(super) fn repository<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&MemoryRepository<SystemClock>) -> crate::memory::error::MemoryResult<T>,
) -> Result<T, String> {
    let state = app.state::<MemoryState>();
    let guard = state.0.lock().map_err(|_| "MEMORY_UNAVAILABLE")?;
    f(guard.as_ref().ok_or("MEMORY_UNAVAILABLE")?).map_err(|_| "MEMORY_OPERATION_FAILED".to_owned())
}
pub(crate) fn register(app: &tauri::AppHandle, mut r: Registration) -> Result<String, String> {
    if crate::yume_context::excluded_session(app, &r.session_id) {
        return Err("INTERNAL_SESSION".into());
    }
    if !model::safe_id(&r.session_id) || !model::safe_id(&r.message_id) {
        return Err("INVALID_IDENTITY".into());
    }
    let dir = crate::history::catalog_model::canonical_directory(&r.directory)
        .map_err(|_| "INVALID_DIRECTORY")?;
    let rows = crate::history::commands::store(app)?.all()?;
    // Explicitly known directories only. The native workbench can introduce sessions inside them.
    if !crate::history::commands::store(app)?
        .directories()?
        .contains(&dir)
    {
        return Err("UNKNOWN_DIRECTORY".into());
    }
    r.directory = dir;
    let session = model::Client::new(app, &r.directory).session(&r.session_id)?;
    if !model::owns_session(&session, &r.directory) {
        return Err("SOURCE_DIRECTORY_MISMATCH".into());
    }
    if !session["parentID"].is_null() {
        return Err("INTERNAL_SESSION".into());
    }
    r.catalog_key = crate::history::catalog_model::CatalogIdentity::Native {
        sidecar_id: crate::history::catalog_model::SIDECAR_ID.into(),
        directory: r.directory.clone(),
        session_id: r.session_id.clone(),
    }
    .key();
    if rows
        .iter()
        .any(|row| row.key() == r.catalog_key && row.tombstone.is_some())
    {
        return Err("DELETED_SESSION".into());
    }
    let settings = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map_err(|_| "SETTINGS_UNAVAILABLE")?
        .clone();
    r.persona_id = settings.persona_id;
    r.memory = settings.memory_auto_extract && settings.memory_ai_use;
    r.worklog = settings.worklog_auto_archive;
    if !r.memory && !r.worklog {
        return Ok(String::new());
    }
    r.workspace =
        (r.directory != crate::history::commands::workspace(app)?).then_some(r.directory.clone());
    r.received_at = now();
    r.utc_offset = chrono::Local::now().offset().local_minus_utc();
    repository(app, |repo| repo.register_automatic(&r))
}

pub(super) fn candidates(app: &tauri::AppHandle, r: &Registration) -> Value {
    let memories = repository(app, |repo| {
        repo.list(&MemoryQuery {
            persona_id: Some(r.persona_id.clone()),
            limit: Some(80),
            ..Default::default()
        })
    })
    .unwrap_or_default();
    let memories:Vec<_>=memories.into_iter().filter(|m|m.memory.status==crate::memory::domain::MemoryStatus::Active && ordinary(&m.memory.content) && m.context.as_ref().and_then(|c|c.workspace.as_deref()).is_none_or(|w|Some(w)==r.workspace.as_deref())).map(|m|json!({"id":m.memory.id,"content":m.memory.content,"type":m.memory.memory_type,"context":m.context})).collect();
    let work = if r.worklog {
        let day = chrono::DateTime::from_timestamp_millis(r.received_at)
            .unwrap_or_else(chrono::Utc::now)
            .date_naive();
        app.state::<crate::worklog::WorklogState>()
            .repository()
            .ok()
            .and_then(|repo| {
                repo.query_entries(&crate::worklog::contract::DateQuery {
                    start: (day - chrono::Duration::days(30)).to_string(),
                    end: (day + chrono::Duration::days(14)).to_string(),
                    project: r
                        .workspace
                        .as_deref()
                        .and_then(|w| std::path::Path::new(w).file_name())
                        .map(|s| s.to_string_lossy().into_owned()),
                })
                .ok()
                .map(|entries| {
                    entries
                        .into_iter()
                        .filter(|e| {
                            repo.automatic_entry_visible(&e.id, r.workspace.as_deref())
                                .unwrap_or(false)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .unwrap_or_default()
            .into_iter()
            .rev()
            .take(40)
            .filter(|e| ordinary(&e.text))
            .map(|e| json!({"id":e.id,"text":e.text,"date":e.business_date,"status":e.status}))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    // Candidate matching is bounded independently from the new source text.
    let bounded = |items: Vec<Value>, budget: usize| {
        let mut remaining = budget;
        items
            .into_iter()
            .filter(|item| {
                let size = item.to_string().chars().count();
                if size > remaining {
                    return false;
                }
                remaining -= size;
                true
            })
            .collect::<Vec<_>>()
    };
    json!({"memories":if r.memory{bounded(memories,3000)}else{vec![]},"work":bounded(work,3000)})
}

fn process(app: &tauri::AppHandle, mut job: Job) -> Result<(), String> {
    let r = &job.registration;
    let client = model::Client::new(app, &r.directory);
    if let Some(child) = &job.child_session {
        if !client.remove(child) {
            return Err("INTERNAL_CLEANUP_PENDING".into());
        }
        repository(app, |repo| repo.automatic_child(&job.id, None))?;
    }
    if job.attempts >= 3 {
        return Ok(());
    }
    let settings = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map_err(|_| "SETTINGS_UNAVAILABLE")?
        .clone();
    let epochs = repository(app, |repo| repo.automation_epochs())?;
    job.registration.memory &= settings.memory_auto_extract
        && settings.memory_ai_use
        && epochs.0 == job.memory_epoch
        && !job.memory_done;
    job.registration.worklog &=
        settings.worklog_auto_archive && epochs.1 == job.log_epoch && !job.log_done;
    if !job.registration.memory && !job.registration.worklog {
        return repository(app, |repo| repo.finish_automatic(&job.id));
    }
    let r = &job.registration;
    let rows = crate::history::commands::store(app)?.all()?;
    if crate::yume_context::excluded_session(app, &r.session_id) {
        return repository(app, |repo| repo.finish_automatic(&job.id));
    }
    if rows
        .iter()
        .any(|row| row.key() == r.catalog_key && row.tombstone.is_some())
    {
        return repository(app, |repo| repo.finish_automatic(&job.id));
    }
    let messages = client.source_messages(&r.session_id, &r.message_id)?;
    let Some(user) = messages
        .iter()
        .find(|m| m["info"]["id"] == r.message_id && m["info"]["role"] == "user")
    else {
        if now() - r.received_at > 120_000 {
            return Err("SOURCE_NOT_AVAILABLE".into());
        }
        return repository(app, |repo| repo.delay_automatic(&job.id, None));
    };
    if !model::settled(&messages, &r.message_id) {
        if now() - r.received_at > 24 * 3600 * 1000 {
            return repository(app, |repo| repo.finish_automatic(&job.id));
        }
        return repository(app, |repo| repo.delay_automatic(&job.id, None));
    }
    if model::internal_source(user) {
        return repository(app, |repo| repo.finish_automatic(&job.id));
    }
    let source = model::message_text(user);
    let text = eligible_text(&source);
    if text.trim().is_empty() || no_record(&text) {
        return repository(app, |repo| repo.finish_automatic(&job.id));
    }
    if text.chars().count() > 48_000 {
        return Err("SOURCE_TOO_LARGE".into());
    }
    let run = app
        .state::<crate::agent::AgentRunState>()
        .all_records()
        .ok()
        .and_then(|rows| rows.into_iter().find(|run| run.run_id == r.message_id));
    if run.as_ref().is_some_and(|run| run.outcome.is_none()) {
        return repository(app, |repo| repo.delay_automatic(&job.id, None));
    }
    let verified = run
        .as_ref()
        .map(|run| evidence::verified_results(run, r, &messages))
        .unwrap_or_default();
    if let Some(created) = user["info"]["time"]["created"].as_i64().filter(|t| *t > 0) {
        job.registration.received_at = created;
    }
    // Resolve the actual persisted model when the registration was made by a native plugin.
    {
        job.registration.provider_id = user["info"]["model"]["providerID"]
            .as_str()
            .unwrap_or("")
            .into();
    }
    {
        job.registration.model_id = user["info"]["model"]["modelID"]
            .as_str()
            .unwrap_or("")
            .into();
    }
    if job.registration.provider_id.is_empty() || job.registration.model_id.is_empty() {
        return Err("MODEL_UNAVAILABLE".into());
    }
    let parsed = if let Some(payload) = &job.payload {
        serde_json::from_str(payload).map_err(|_| "INVALID_SAVED_EXTRACTION")?
    } else {
        let mut checked = Extraction::default();
        for (index, chunk) in evidence::chunks(&text)?.into_iter().enumerate() {
            let verified = if index == 0 { verified.as_str() } else { "" };
            let extracted = client.generate(
                &job,
                &chunk,
                verified,
                candidates(app, &job.registration),
                |child| repository(app, |repo| repo.automatic_child(&job.id, child)),
                || {
                    repository(app, |repo| repo.automation_epochs())
                        .map_or(true, |current| current != epochs)
                },
            )?;
            let mut part = validate(
                extracted,
                &format!("{chunk}\n{verified}"),
                &job.registration,
            )?;
            part.memories.retain(|fact| {
                chunk.contains(&fact.evidence)
                    || matches!(
                        fact.kind,
                        crate::memory::domain::MemoryType::Goal
                            | crate::memory::domain::MemoryType::Event
                    )
            });
            checked.memories.extend(part.memories);
            checked.work.extend(part.work);
        }
        // Later evidence in the same source wins; distinct dated work remains distinct.
        let mut seen = std::collections::HashSet::new();
        checked.memories.reverse();
        checked
            .memories
            .retain(|f| seen.insert(format!("{}:{}", f.scope, f.key)));
        checked.memories.reverse();
        seen.clear();
        checked.work.reverse();
        checked
            .work
            .retain(|f| seen.insert(format!("{}:{}", f.key, f.business_date)));
        checked.work.reverse();
        // Persist only when the generation used to classify this source is still current.
        if repository(app, |repo| repo.automation_epochs())? != epochs {
            return Err("EXTRACTION_INVALIDATED".into());
        }
        repository(app, |repo| repo.automatic_payload(&job.id, &checked))?;
        checked
    };
    // Saved payloads have already passed per-chunk evidence validation.
    let parsed: Extraction = parsed;
    let memory_result = if job.registration.memory {
        repository(app, |repo| {
            repo.apply_automatic_memories(&job, &parsed.memories)
        })
    } else {
        Ok(())
    };
    let log_result = if job.registration.worklog {
        // Settings/epoch are checked under the memory lock, serializing settings invalidation.
        repository(app, |repo| {
            if repo.automation_epochs()?.1 != job.log_epoch {
                return Ok(());
            }
            let log = app
                .state::<crate::worklog::WorklogState>()
                .repository()
                .map_err(|_| {
                    crate::memory::error::MemoryError::storage_unavailable("journal unavailable")
                })?;
            for f in &parsed.work {
                let key = hash(&format!("{}:{}:{}", job.id, f.key, f.business_date));
                log.archive_automatic(&key, &job.registration, f)
                    .map_err(|_| {
                        crate::memory::error::MemoryError::storage_unavailable(
                            "journal archive failed",
                        )
                    })?;
            }
            repo.automatic_branch_done(&job.id, false)
        })
    } else {
        Ok(())
    };
    // One branch failing must not prevent the other branch from committing.
    memory_result?;
    log_result?;
    if let Ok(log) = app.state::<crate::worklog::WorklogState>().repository() {
        for fact in &parsed.memories {
            for work in parsed.work.iter().filter(|work| {
                fact.work_key.as_deref() == Some(work.key.as_str())
                    || fact.evidence == work.evidence
            }) {
                let key = hash(&format!("{}:{}:{}", job.id, work.key, work.business_date));
                if let Ok(Some((entry, revision))) = log.automatic_source(&key) {
                    repository(app, |repo| repo.link_work(&job, fact, &entry, revision))?;
                }
            }
        }
    }
    repository(app, |repo| repo.finish_automatic(&job.id))?;
    let _=app.emit("deskmate://memory-changed",json!({"version":1,"action":"updated","memoryId":null,"scope":null,"personaId":null,"revision":null}));
    let _ = app.emit("deskmate://worklog-changed", json!({"version":1}));
    Ok(())
}

pub(super) fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_sync = std::time::Instant::now() - std::time::Duration::from_secs(10);
        loop {
            if last_sync.elapsed().as_secs() >= 10 {
                synchronize_work_links(&app);
                last_sync = std::time::Instant::now();
            }
            if let Ok(Some(job)) = repository(&app, |repo| repo.next_automatic()) {
                let id = job.id.clone();
                if let Err(code) = process(&app, job) {
                    let _ = repository(&app, |repo| {
                        repo.delay_automatic(
                            &id,
                            if code == "NATIVE_UNAVAILABLE"
                                || code == "INTERNAL_CLEANUP_PENDING"
                                || code == "EXTRACTION_INVALIDATED"
                            {
                                None
                            } else {
                                Some(&code)
                            },
                        )
                    });
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(800));
        }
    });
}
