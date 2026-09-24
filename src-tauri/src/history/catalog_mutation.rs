use tauri::{Emitter, Manager};
use super::{catalog_model::*, catalog_query::{CatalogMutation, CatalogRow}, commands};

pub(crate) fn apply_local(entry: &mut CatalogEntry, mutation: &CatalogMutation, now: u64) -> Result<(), String> {
    if entry.tombstone.is_some() { return Err("history_deleted".into()); }
    let capabilities = entry.capabilities();
    match mutation {
        CatalogMutation::Rename { title } => {
            if !capabilities.rename { return Err("history_mutation_denied".into()); }
            if title.trim().is_empty() || title.len() > 1000 { return Err("history_title_invalid".into()); }
            entry.user_title = Some(title.trim().into());
        }
        CatalogMutation::Pin { pinned } => { if !capabilities.pin { return Err("history_mutation_denied".into()); } entry.pinned = *pinned; }
        CatalogMutation::Archive { archived } => { if !capabilities.archive { return Err("history_mutation_denied".into()); } entry.archived = *archived; }
        CatalogMutation::Delete { confirmed } => {
            if !confirmed { return Err("history_delete_confirmation_required".into()); }
            if !capabilities.delete { return Err("history_agent_running".into()); }
            entry.tombstone = Some(DeletionTombstone { requested_at: now, remote_deleted: matches!(entry.identity, CatalogIdentity::Legacy { .. }) });
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn history_catalog_mutate(window: tauri::WebviewWindow, app: tauri::AppHandle, key: String, mutation: CatalogMutation) -> Result<Option<CatalogRow>, String> {
    super::native_api::authorize_history_window(window.label()).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || mutate(&app, &key, &mutation)).await.map_err(|_| "history_mutation_unavailable".to_owned())?
}

fn mutate(app: &tauri::AppHandle, key: &str, mutation: &CatalogMutation) -> Result<Option<CatalogRow>, String> {
    commands::initialize(app)?;
    let runs = app.state::<crate::agent::AgentRunState>();
    // Share the launch/stop operation lock so an active run cannot race permanent deletion.
    let _guard = runs.lock_operation()?;
    let store = commands::store(app)?;
    let mut entry = store.get(key)?;
    if let CatalogIdentity::Native { directory, session_id, .. } = &entry.identity {
        let active = runs.all_records()?.into_iter().any(|record| record.outcome.is_none() && record.session_id.as_deref() == Some(session_id) && super::catalog_import::canonical_directory(&record.workspace_path.to_string_lossy()) == *directory);
        if active { entry.ownership = Ownership::Agent; entry.runtime = RuntimeState::Running; }
        if matches!(mutation, CatalogMutation::Delete { .. }) && !active {
            let statuses = commands::client(app)?.statuses(directory).map_err(|error| error.to_string())?;
            entry.runtime = match statuses.get(session_id) {
                Some(super::native_api::NativeStatus::Busy | super::native_api::NativeStatus::Retry { .. }) => RuntimeState::Running,
                Some(super::native_api::NativeStatus::Idle) | None => RuntimeState::Idle,
            };
        }
    }
    apply_local(&mut entry, mutation, commands::now()?)?;
    if let (CatalogIdentity::Native { directory, session_id, .. }, CatalogMutation::Rename { title }) = (&entry.identity, mutation) {
        commands::client(app)?.rename(directory, session_id, title.trim()).map_err(|error| error.to_string())?;
    }
    store.update(|rows| {
        let row = rows.iter_mut().find(|row| row.key() == key).ok_or("history_not_found")?;
        // Refresh only fields changed by the mutation; preserve concurrent discovery and pin updates.
        row.runtime = entry.runtime; row.ownership = entry.ownership;
        apply_local(row, mutation, commands::now()?)?;
        Ok(())
    })?;
    let mut pending_error = None;
    if let (CatalogIdentity::Native { directory, session_id, .. }, CatalogMutation::Delete { .. }) = (&entry.identity, mutation) {
        match commands::client(app)?.delete(directory, session_id) {
            Ok(()) => store.update(|rows| { if let Some(row) = rows.iter_mut().find(|row| row.key() == key) { if let Some(tombstone) = &mut row.tombstone { tombstone.remote_deleted = true; } } Ok(()) })?,
            Err(error) => pending_error = Some(error.to_string()),
        }
    }
    app.emit("history-catalog-changed", ()).map_err(|_| "history_event_unavailable")?;
    if let Some(error) = pending_error { return Err(format!("history_delete_pending:{error}")); }
    if matches!(mutation, CatalogMutation::Delete { .. }) { Ok(None) } else { Ok(Some(store.get(key)?.into())) }
}

