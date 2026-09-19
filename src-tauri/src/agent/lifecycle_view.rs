use super::{
    lifecycle::AgentRunState,
    permissions::AgentPermissionState,
    record_store::{RunListing, RunRecord},
};
use std::path::PathBuf;

impl AgentRunState {
    pub(crate) fn restore_permission_ownership(
        &self,
        permissions: &AgentPermissionState,
    ) -> Result<(), String> {
        let Some(record) = self.read()?.active else {
            return Ok(());
        };
        let Some(session_id) = record.session_id else {
            return self.interrupt_active("submission_not_confirmed");
        };
        if permissions
            .register_run(&record.run_id, &session_id, &record.workspace_path)
            .is_ok()
        {
            return Ok(());
        }
        permissions.block_session(&session_id)?;
        self.interrupt_active("workspace_invalid_path")
    }

    pub(crate) fn read(&self) -> Result<RunListing, String> {
        let data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        Ok(RunListing {
            active: data.active.clone(),
            recent: data.recent.iter().take(20).cloned().collect(),
            artifacts: data
                .artifacts
                .iter()
                .cloned()
                .map(super::artifacts::current)
                .collect(),
        })
    }

    pub(crate) fn active_workspace(&self, run_id: &str) -> Result<PathBuf, String> {
        self.data
            .lock()
            .map_err(|_| "agent_state_unavailable")?
            .active
            .as_ref()
            .filter(|record| record.run_id == run_id)
            .map(|record| record.workspace_path.clone())
            .ok_or_else(|| "agent_run_unknown".into())
    }

    pub(crate) fn active_record(&self, run_id: &str) -> Result<RunRecord, String> {
        self.data
            .lock()
            .map_err(|_| "agent_state_unavailable")?
            .active
            .as_ref()
            .filter(|record| record.run_id == run_id)
            .cloned()
            .ok_or_else(|| "agent_run_unknown".into())
    }

    pub(super) fn active_session(&self, run_id: &str) -> Result<String, String> {
        self.data
            .lock()
            .map_err(|_| "agent_state_unavailable")?
            .active
            .as_ref()
            .filter(|record| record.run_id == run_id)
            .and_then(|record| record.session_id.clone())
            .ok_or_else(|| "agent_session_unknown".into())
    }
}
