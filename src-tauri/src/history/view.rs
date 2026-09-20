use super::{
    recovery::{self, DetailAvailability, LazyReadPlan},
    HistorySession, HistoryState, HistorySummary,
};
use tauri::Manager;

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
    history_summaries(&sessions, &records)
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
            Err(error) if error == "agent_http_404" => DetailAvailability::Missing,
            Err(_) => DetailAvailability::Retryable,
        };
        Ok(visible_session(&state, &id)?.map(|session| loaded(session, &records, availability)))
    })
    .await
    .map_err(|_| "history_load_unavailable".to_owned())?
}
