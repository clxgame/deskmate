use super::{lifecycle::AgentRunState, run_commands::AgentStartInput};

pub(super) struct StartTarget {
    pub(super) workspace: std::path::PathBuf,
    pub(super) session_id: Option<String>,
}

pub(super) fn catalog_start_target(
    request: &AgentStartInput,
    entry: &crate::history::catalog_model::CatalogEntry,
    history: &crate::history::HistoryState,
    runs: &AgentRunState,
) -> Result<StartTarget, String> {
    use crate::history::catalog_model::{canonical_directory, Availability, CatalogIdentity, Ownership, RuntimeState};
    if request.workspace_path.is_some() {
        return Err("agent_history_workspace_spoof".into());
    }
    if request.catalog_key.as_deref() != Some(entry.key().as_str()) {
        return Err("agent_history_identity_mismatch".into());
    }
    if entry.tombstone.is_some() { return Err("history_deleted".into()); }
    if entry.archived { return Err("agent_history_archived".into()); }
    if entry.availability != Availability::Available { return Err("agent_history_unavailable".into()); }
    if entry.runtime != RuntimeState::Idle { return Err("agent_history_busy".into()); }
    if entry.ownership != Ownership::Agent { return Err("history_not_agent_owned".into()); }
    match &entry.identity {
        CatalogIdentity::Native { directory, session_id, .. } => {
            if request.history_id.as_deref() != Some(session_id) {
                return Err("agent_history_identity_mismatch".into());
            }
            let records = runs.all_records()?;
            let origin = records.iter().filter(|record| {
                record.session_id.as_deref() == Some(session_id)
                    && canonical_directory(&record.workspace_path.to_string_lossy()).is_ok_and(|path| path == *directory)
            }).min_by(|left, right| left.created_at.cmp(&right.created_at).then_with(|| left.run_id.cmp(&right.run_id)))
                .ok_or("agent_history_origin_mismatch")?;
            Ok(StartTarget {
                workspace: runs.continuation_workspace(session_id, &origin.run_id)?,
                session_id: Some(session_id.clone()),
            })
        }
        CatalogIdentity::Legacy { history_id } => {
            if request.history_id.as_deref() != Some(history_id) {
                return Err("agent_history_identity_mismatch".into());
            }
            start_target(request, history, runs)
        }
    }
}

#[cfg(test)]
#[path = "continuation_catalog_tests.rs"]
mod catalog_tests;

pub(super) fn start_target(
    request: &AgentStartInput,
    history: &crate::history::HistoryState,
    runs: &AgentRunState,
) -> Result<StartTarget, String> {
    match request.history_id.as_deref() {
        Some(history_id) => {
            if request.workspace_path.is_some() {
                return Err("agent_history_workspace_spoof".to_owned());
            }
            let origin = crate::history::continuation_origin(history, history_id)?;
            Ok(StartTarget {
                workspace: runs.continuation_workspace(history_id, &origin)?,
                session_id: Some(history_id.to_owned()),
            })
        }
        None => Ok(StartTarget {
            workspace: request
                .workspace_path
                .clone()
                .ok_or_else(|| "agent_start_invalid".to_owned())?,
            session_id: None,
        }),
    }
}
