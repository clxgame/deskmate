use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// A single chat message saved to local history.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    pub role: String,
    pub text: String,
    pub time: u64,
}

/// A full chat session (one opencode session = one history record).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySession {
    pub id: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    pub messages: Vec<HistoryMessage>,
}

/// Lightweight listing entry (no message bodies).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummary {
    pub id: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    pub count: usize,
}

/// In-memory history store, persisted to `history.json` in the app data dir.
pub struct HistoryState(pub Mutex<Vec<HistorySession>>);

fn history_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir unavailable")
        .join("history.json")
}

pub fn load(app: &tauri::AppHandle) -> Vec<HistorySession> {
    std::fs::read_to_string(history_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist(app: &tauri::AppHandle, list: &[HistorySession]) {
    if let Ok(json) = serde_json::to_string_pretty(list) {
        let _ = std::fs::write(history_path(app), json);
    }
}

#[tauri::command]
pub fn history_list(state: tauri::State<HistoryState>) -> Vec<HistorySummary> {
    state
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|s| HistorySummary {
            id: s.id.clone(),
            title: s.title.clone(),
            created: s.created,
            updated: s.updated,
            count: s.messages.len(),
        })
        .collect()
}

#[tauri::command]
pub fn history_load(state: tauri::State<HistoryState>, id: String) -> Option<HistorySession> {
    state.0.lock().unwrap().iter().find(|s| s.id == id).cloned()
}

/// Upsert a session, preserving its original creation time, sorted by recency.
#[tauri::command]
pub fn history_save(
    app: tauri::AppHandle,
    state: tauri::State<HistoryState>,
    mut session: HistorySession,
) {
    let mut list = state.0.lock().unwrap();
    if let Some(existing) = list.iter().find(|s| s.id == session.id) {
        session.created = existing.created;
    }
    list.retain(|s| s.id != session.id);
    list.push(session);
    list.sort_by(|a, b| b.updated.cmp(&a.updated));
    persist(&app, &list);
}

#[tauri::command]
pub fn history_delete(app: tauri::AppHandle, state: tauri::State<HistoryState>, id: String) {
    let mut list = state.0.lock().unwrap();
    list.retain(|s| s.id != id);
    persist(&app, &list);
}
