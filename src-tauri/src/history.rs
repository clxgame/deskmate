use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

mod archive;
mod recovery;
mod storage;
pub(crate) mod view;

use archive::{upsert_agent_snapshot, upsert_message};

use storage::{load_path, persist_path};
pub(crate) use view::continuation_origin;

#[cfg(test)]
mod history_tests;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    pub role: String,
    pub text: String,
    pub time: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistorySession {
    pub id: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    pub messages: Vec<HistoryMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummary {
    pub id: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_details: Option<recovery::AgentHistoryDetails>,
}

pub struct HistoryState(pub Mutex<Vec<HistorySession>>);

fn history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("history.json"))
        .map_err(|_| "history_storage_unavailable".to_owned())
}

pub fn load(app: &tauri::AppHandle) -> Result<Vec<HistorySession>, String> {
    load_path(&history_path(app)?)
}

pub(crate) fn index_agent_records(
    app: &tauri::AppHandle,
    state: &HistoryState,
    records: &[crate::agent::RunRecord],
) -> Result<(), String> {
    let mut list = state.0.lock().map_err(|_| "history_state_unavailable")?;
    recovery::index_agent_records(&history_path(app)?, &mut list, records)
}

pub(super) struct RendererHistorySave<'a> {
    pub(super) session: HistorySession,
    pub(super) trusted_origin_run_id: Option<&'a str>,
}

pub(super) fn save_renderer_to_path(
    path: &Path,
    list: &mut Vec<HistorySession>,
    request: RendererHistorySave<'_>,
) -> Result<(), String> {
    let existing = list.iter().find(|item| item.id == request.session.id);
    if request.trusted_origin_run_id.is_some()
        || request.session.origin_run_id.is_some()
        || existing.is_some_and(|item| item.origin_run_id.is_some())
    {
        return Err("history_agent_owned".to_owned());
    }
    if existing.is_some_and(|item| item.deleted) {
        return Err("history_deleted".to_owned());
    }
    save_to_path(path, list, request.session)
}

pub(super) fn save_to_path(
    path: &Path,
    list: &mut Vec<HistorySession>,
    mut session: HistorySession,
) -> Result<(), String> {
    let existing = list.iter().find(|item| item.id == session.id);
    if let Some(created) = existing.map(|item| item.created) {
        session.created = created;
    }
    let mut next = list.clone();
    next.retain(|item| item.id != session.id);
    next.push(session);
    next.sort_by(|left, right| right.updated.cmp(&left.updated));
    persist_path(path, &next)?;
    *list = next;
    Ok(())
}

#[tauri::command]
pub fn history_save(
    app: tauri::AppHandle,
    state: tauri::State<HistoryState>,
    runs: tauri::State<crate::agent::AgentRunState>,
    session: HistorySession,
) -> Result<(), String> {
    let trusted_origin = runs.origin_run_for_session(&session.id)?;
    let mut list = state.0.lock().map_err(|_| "history_state_unavailable")?;
    save_renderer_to_path(
        &history_path(&app)?,
        &mut list,
        RendererHistorySave {
            session,
            trusted_origin_run_id: trusted_origin.as_deref(),
        },
    )
}

#[tauri::command]
pub fn history_delete(
    app: tauri::AppHandle,
    state: tauri::State<HistoryState>,
    runs: tauri::State<crate::agent::AgentRunState>,
    id: String,
) -> Result<(), String> {
    let active_session = runs.read()?.active.and_then(|record| record.session_id);
    let trusted_origin = runs.origin_run_for_session(&id)?;
    let mut list = state.0.lock().map_err(|_| "history_state_unavailable")?;
    delete_from_path(
        &history_path(&app)?,
        &mut list,
        DeleteHistory {
            id: &id,
            trusted_origin_run_id: trusted_origin.as_deref(),
            active: active_session.as_deref() == Some(&id),
        },
    )
}

struct DeleteHistory<'a> {
    id: &'a str,
    trusted_origin_run_id: Option<&'a str>,
    active: bool,
}

fn delete_from_path(
    path: &Path,
    list: &mut Vec<HistorySession>,
    request: DeleteHistory<'_>,
) -> Result<(), String> {
    let Some(existing) = list.iter().find(|session| session.id == request.id) else {
        return Ok(());
    };
    let agent_owned = existing.origin_run_id.is_some() || request.trusted_origin_run_id.is_some();
    if agent_owned && request.active {
        return Err("history_agent_running".to_owned());
    }
    let mut next = list.clone();
    if let Some(session) = next.iter_mut().find(|session| session.id == request.id) {
        if agent_owned {
            session.title.clear();
            session.messages.clear();
            if session.origin_run_id.is_none() {
                session.origin_run_id = request.trusted_origin_run_id.map(str::to_owned);
            }
            session.deleted = true;
        } else {
            next.retain(|session| session.id != request.id);
        }
    }
    persist_path(path, &next)?;
    *list = next;
    Ok(())
}

pub(crate) struct AgentHistoryInput<'a> {
    pub(crate) session_id: &'a str,
    pub(crate) run_id: &'a str,
    pub(crate) text: &'a str,
    pub(crate) created: u64,
}

pub(crate) struct AgentHistorySnapshot<'a> {
    pub(crate) session_id: &'a str,
    pub(crate) messages: &'a [crate::agent::NativeMessage],
}

pub(crate) fn save_agent_input(
    app: &tauri::AppHandle,
    state: &HistoryState,
    input: AgentHistoryInput<'_>,
) -> Result<(), String> {
    let mut list = state.0.lock().map_err(|_| "history_state_unavailable")?;
    let mut session = list
        .iter()
        .find(|session| session.id == input.session_id)
        .cloned()
        .unwrap_or_else(|| HistorySession {
            id: input.session_id.to_owned(),
            title: input.text.to_owned(),
            created: input.created,
            updated: input.created,
            messages: Vec::new(),
            origin_run_id: Some(input.run_id.to_owned()),
            deleted: false,
        });
    if session.deleted {
        return Err("history_deleted".to_owned());
    }
    if session.origin_run_id.is_none() {
        return Err("history_agent_owned".to_owned());
    }
    upsert_message(
        &mut session.messages,
        HistoryMessage {
            role: "user".to_owned(),
            text: input.text.to_owned(),
            time: input.created,
            message_id: Some(input.run_id.to_owned()),
            part_id: None,
        },
    );
    session.updated = session.updated.max(input.created);
    save_to_path(&history_path(app)?, &mut list, session)
}

pub(crate) fn save_agent_snapshot(
    app: &tauri::AppHandle,
    state: &HistoryState,
    snapshot: AgentHistorySnapshot<'_>,
) -> Result<(), String> {
    let mut list = state.0.lock().map_err(|_| "history_state_unavailable")?;
    upsert_agent_snapshot(&history_path(app)?, &mut list, snapshot)
}
