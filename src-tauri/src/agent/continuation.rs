use super::{lifecycle::AgentRunState, run_commands::AgentStartInput};

pub(super) struct StartTarget {
    pub(super) workspace: std::path::PathBuf,
    pub(super) session_id: Option<String>,
}

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
