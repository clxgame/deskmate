use super::{archive::upsert_message, catalog_model::*, catalog_query::CatalogRow, commands, HistoryMessage, HistorySession, HistoryState};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

pub(super) fn append_local(path: &std::path::Path, list: &mut Vec<HistorySession>, update: (&CatalogEntry, &[HistoryMessage])) -> Result<(), String> {
    let (entry, messages) = update;
    if !matches!(entry.identity, CatalogIdentity::Native { .. }) || entry.tombstone.is_some() || entry.ownership == Ownership::Agent {
        return Err("history_local_messages_denied".into());
    }
    if messages.is_empty() || messages.iter().any(|message| !message.local_only || !matches!(message.role.as_str(), "user" | "assistant")
        || message.part_id.is_some() || message.message_id.as_deref().is_none_or(|id| !id.starts_with("local_") || !crate::worklog::bridge::safe_id(id))) {
        return Err("history_local_messages_invalid".into());
    }
    let id = format!("local_{:x}", Sha256::digest(entry.key().as_bytes()));
    let mut session = list.iter().find(|session| session.local_link.as_ref().is_some_and(|identity| identity.key() == entry.key()))
        .cloned().unwrap_or_else(|| HistorySession {
            id, title: entry.display_title().into(), created: entry.created, updated: entry.updated,
            messages: Vec::new(), origin_run_id: None, deleted: false, local_link: Some(entry.identity.clone()),
        });
    for message in messages { upsert_message(&mut session.messages, message.clone()); }
    session.updated = session.messages.last().map_or(session.updated, |message| message.time.max(session.updated));
    super::save_to_path(path, list, session)
}

pub(super) fn combine_messages(entry: CatalogRow, native: Vec<HistoryMessage>, local: &[HistorySession], workspace: &str) -> (CatalogRow, Vec<HistoryMessage>) {
    let mut entry = entry;
    let linked = local.iter().find(|session| !session.deleted && session.local_link.as_ref().is_some_and(|identity| identity.key() == entry.key));
    let old = match &entry.entry.identity {
        CatalogIdentity::Native { sidecar_id, directory, session_id } if sidecar_id == SIDECAR_ID
            && directory == workspace && entry.entry.source == ConversationSource::LightChat => local.iter().find(|session| session.local_link.is_none()
                && session.origin_run_id.is_none() && session.id == *session_id && !session.deleted),
        CatalogIdentity::Native { .. } | CatalogIdentity::Legacy { .. } => None,
    };
    let mut messages = native;
    if messages.is_empty() {
        if let Some(old) = old.filter(|session| !session.messages.is_empty() && session.messages.iter().any(|message| !message.local_only)) {
            messages.extend(old.messages.iter().cloned());
            entry.entry.source = ConversationSource::Legacy;
            entry.capabilities.send = false;
            entry.capabilities.read_only_reason = Some("legacy_text_only");
        }
    }
    for message in linked.into_iter().flat_map(|session| &session.messages).filter(|message| message.local_only) {
        upsert_message(&mut messages, message.clone());
    }
    messages.sort_by(|left, right| left.time.cmp(&right.time).then_with(|| left.message_id.cmp(&right.message_id)).then_with(|| left.part_id.cmp(&right.part_id)));
    (entry, messages)
}

fn authorize_local_window(label: &str) -> Result<(), String> {
    match label { "chat" => Ok(()), _ => Err("history_forbidden".into()) }
}

#[tauri::command]
pub(crate) async fn history_save_local_messages(window: tauri::WebviewWindow, app: tauri::AppHandle, key: String, messages: Vec<HistoryMessage>) -> Result<(), String> {
    authorize_local_window(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let runs = app.state::<crate::agent::AgentRunState>();
        let _operation = runs.lock_operation()?;
        let entry = commands::store(&app)?.get(&key)?;
        let CatalogIdentity::Native { sidecar_id, directory, session_id } = &entry.identity else { return Err("history_local_messages_denied".into()); };
        if sidecar_id != SIDECAR_ID || entry.tombstone.is_some() || entry.archived || entry.ownership == Ownership::Agent
            || app.state::<crate::workbench::WorkbenchOwnership>().is_owned(directory, session_id)?
            || runs.all_records()?.iter().any(|record| record.session_id.as_deref() == Some(session_id)
                && super::catalog_import::canonical_directory(&record.workspace_path.to_string_lossy()) == *directory) {
            return Err("history_local_messages_denied".into());
        }
        let client = commands::client(&app)?;
        client.get(directory, session_id).map_err(|error| error.to_string())?;
        if matches!(client.statuses(directory).map_err(|error| error.to_string())?.get(session_id), Some(super::native_api::NativeStatus::Busy | super::native_api::NativeStatus::Retry { .. })) {
            return Err("history_agent_running".into());
        }
        let state = app.state::<HistoryState>();
        let mut list = state.0.lock().map_err(|_| "history_state_unavailable")?;
        append_local(&super::history_path(&app)?, &mut list, (&entry, &messages))?;
        app.emit("history-catalog-changed", ()).map_err(|_| "history_event_unavailable".to_owned())
    }).await.map_err(|_| "history_local_messages_unavailable".to_owned())?
}

#[cfg(test)]
#[path = "catalog_local_tests.rs"]
mod tests;


