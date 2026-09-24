use super::{
    recovery::{self, DetailAvailability, LazyReadPlan},
    HistorySession, HistoryState, HistorySummary,
};
use tauri::Manager;

/// The sidecar `/session` list returns these per session; only the fields the
/// history projection needs are read.
#[derive(serde::Deserialize)]
struct NativeSessionInfo {
    id: String,
    title: Option<String>,
    directory: Option<String>,
    time: Option<NativeSessionTime>,
}

#[derive(serde::Deserialize)]
struct NativeSessionTime {
    created: Option<u64>,
    updated: Option<u64>,
}

/// Merge sessions that live only on the managed OpenCode sidecar (e.g. created
/// in the native workbench) into the history list, flagged `native`, without
/// copying them into history.json (§8.1 / §9.2: native sessions stay native;
/// the light chat shows them as projections and hands off to the workbench).
fn native_sessions(
    app: &tauri::AppHandle,
    already: &std::collections::HashSet<String>,
) -> Vec<HistorySummary> {
    let Ok(data_dir) = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data dir unavailable".to_string())
    else {
        return Vec::new();
    };
    let workspace = data_dir.join("workspace").to_string_lossy().into_owned();
    let url = format!("{}/session", crate::sidecar_url(app));
    let list: Vec<NativeSessionInfo> = match ureq::get(&url)
        .set("Authorization", &crate::sidecar_auth_header(app))
        .timeout(std::time::Duration::from_secs(3))
        .call()
    {
        Ok(response) => response.into_json().unwrap_or_default(),
        Err(_) => return Vec::new(),
    };
    list.into_iter()
        .filter(|session| {
            !already.contains(&session.id)
                && session
                    .directory
                    .as_deref()
                    .map(|directory| directory == workspace)
                    .unwrap_or(false)
        })
        .map(|session| HistorySummary {
            id: session.id,
            title: session.title.unwrap_or_default(),
            created: session
                .time
                .as_ref()
                .and_then(|time| time.created)
                .unwrap_or(0),
            updated: session
                .time
                .as_ref()
                .and_then(|time| time.updated)
                .unwrap_or(0),
            count: 0,
            agent_details: None,
            native: true,
        })
        .collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryLoaded {
    #[serde(flatten)]
    session: HistorySession,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_details: Option<recovery::AgentHistoryDetails>,
}

pub(crate) fn continuation_origin(state: &HistoryState, id: &str) -> Result<String, String> {
    if !crate::worklog::bridge::safe_id(id) {
        return Err("history_id_invalid".to_owned());
    }
    let list = state.0.lock().map_err(|_| "history_state_unavailable")?;
    let session = list
        .iter()
        .find(|session| session.id == id)
        .ok_or_else(|| "history_not_found".to_owned())?;
    if session.deleted {
        return Err("history_deleted".to_owned());
    }
    session
        .origin_run_id
        .clone()
        .ok_or_else(|| "history_not_agent_owned".to_owned())
}

#[tauri::command]
pub(crate) fn history_list(app: tauri::AppHandle) -> Result<Vec<HistorySummary>, String> {
    let records = app.state::<crate::agent::AgentRunState>().all_records()?;
    let state = app.state::<HistoryState>();
    let sessions = state
        .0
        .lock()
        .map_err(|_| "history_state_unavailable")?
        .clone();
    let mut list = history_summaries(&sessions, &records)?;
    // Merge native-only sessions (created in the workbench) that are not
    // already projected in history.json. They are flagged `native` so the UI
    // hands them off to the workbench instead of resuming them here (§8.1).
    let already: std::collections::HashSet<String> =
        sessions.iter().map(|session| session.id.clone()).collect();
    list.extend(native_sessions(&app, &already));
    list.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(list)
}

pub(super) fn history_summaries(
    sessions: &[HistorySession],
    records: &[crate::agent::RunRecord],
) -> Result<Vec<HistorySummary>, String> {
    Ok(sessions
        .iter()
        .filter(|session| !session.deleted)
        .map(|session| HistorySummary {
            id: session.id.clone(),
            title: session.title.clone(),
            created: session.created,
            updated: session.updated,
            count: session.messages.len(),
            agent_details: session.origin_run_id.as_ref().and_then(|_| {
                recovery::details_for(records, &session.id, DetailAvailability::Ready)
            }),
            native: false,
        })
        .collect())
}

fn visible_session(state: &HistoryState, id: &str) -> Result<Option<HistorySession>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "history_state_unavailable")?
        .iter()
        .find(|session| session.id == id && !session.deleted)
        .cloned())
}

fn loaded(
    session: HistorySession,
    records: &[crate::agent::RunRecord],
    availability: DetailAvailability,
) -> HistoryLoaded {
    let id = session.id.clone();
    HistoryLoaded {
        agent_details: session
            .origin_run_id
            .as_ref()
            .and_then(|_| recovery::details_for(records, &id, availability)),
        session,
    }
}

#[tauri::command]
pub(crate) async fn history_load(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<HistoryLoaded>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<HistoryState>();
        let existing = visible_session(&state, &id)?;
        let Some(existing) = existing else {
            return Ok(None);
        };
        if existing.origin_run_id.is_none() {
            return Ok(Some(HistoryLoaded {
                session: existing,
                agent_details: None,
            }));
        }
        let records = app.state::<crate::agent::AgentRunState>().all_records()?;
        let plan = {
            let list = state.0.lock().map_err(|_| "history_state_unavailable")?;
            recovery::prepare_lazy_read(&list, &records, &id)?
        };
        let target = match plan {
            LazyReadPlan::Absent => return Ok(None),
            LazyReadPlan::Ready => {
                return Ok(visible_session(&state, &id)?
                    .map(|session| loaded(session, &records, DetailAvailability::Ready)))
            }
            LazyReadPlan::WorkspaceMissing => {
                return Ok(visible_session(&state, &id)?.map(|session| {
                    loaded(session, &records, DetailAvailability::WorkspaceMissing)
                }))
            }
            LazyReadPlan::Fetch { target } => target,
        };
        let snapshot =
            crate::agent::read_session_snapshot(&app, &target.workspace_path, &target.session_id);
        let availability = match snapshot {
            Ok(messages) => {
                let path = super::history_path(&app)?;
                let mut list = state.0.lock().map_err(|_| "history_state_unavailable")?;
                match recovery::apply_lazy_snapshot(
                    &path,
                    &mut list,
                    recovery::LazySnapshot {
                        target: &target,
                        messages: &messages,
                    },
                ) {
                    Ok(_) => DetailAvailability::Ready,
                    Err(error) if error == "history_deleted" => return Ok(None),
                    Err(error) => return Err(error),
                }
            }
            Err(error) if matches!(error.as_str(), "agent_http_404" | "history_native_missing") => DetailAvailability::Missing,
            Err(_) => DetailAvailability::Retryable,
        };
        Ok(visible_session(&state, &id)?.map(|session| loaded(session, &records, availability)))
    })
    .await
    .map_err(|_| "history_load_unavailable".to_owned())?
}

