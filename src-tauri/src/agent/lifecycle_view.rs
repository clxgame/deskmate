use super::{
    lifecycle::AgentRunState,
    permissions::AgentPermissionState,
    record_store::{RunListing, RunRecord},
};
use std::path::PathBuf;

impl AgentRunState {
    pub(crate) fn all_records(&self) -> Result<Vec<RunRecord>, String> {
        self.store.load()
    }

    pub(crate) fn continuation_workspace(
        &self,
        session_id: &str,
        origin_run_id: &str,
    ) -> Result<PathBuf, String> {
        let records = self.all_records()?;
        let origin = records
            .iter()
            .find(|record| record.run_id == origin_run_id)
            .ok_or_else(|| "agent_history_origin_mismatch".to_owned())?;
        if origin.session_id.as_deref() != Some(session_id) {
            return Err("agent_history_session_mismatch".to_owned());
        }
        let workspace = origin
            .workspace_path
            .canonicalize()
            .map_err(|_| "agent_history_workspace_missing".to_owned())?;
        if !workspace.is_dir() {
            return Err("agent_history_workspace_missing".to_owned());
        }
        Ok(workspace)
    }

    pub(crate) fn origin_run_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<String>, String> {
        Ok(self
            .all_records()?
            .iter()
            .filter(|record| record.session_id.as_deref() == Some(session_id))
            .min_by(|left, right| {
                left.created_at
                    .cmp(&right.created_at)
                    .then_with(|| left.run_id.cmp(&right.run_id))
            })
            .map(|record| record.run_id.clone()))
    }

    pub(crate) fn restore_permission_ownership(
        &self,
        permissions: &AgentPermissionState,
        approvals: &[crate::tool_permissions::AgentPermissionApproval],
    ) -> Result<(), String> {
        for session_id in self
            .all_records()?
            .iter()
            .filter_map(|record| record.session_id.as_deref())
        {
            permissions.block_session(session_id)?;
        }
        let Some(record) = self.read()?.active else {
            return Ok(());
        };
        if record.initial_input.is_some() {
            if let Some(session_id) = record.session_id.as_deref() {
                permissions.block_session(session_id)?;
            }
            return Ok(());
        }
        let Some(session_id) = record.session_id else {
            return self.interrupt_active("submission_not_confirmed");
        };
        if permissions
            .register_run_with_approvals(
                &record.run_id,
                &session_id,
                &record.workspace_path,
                approvals,
            )
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

    #[cfg(test)]
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

    pub(super) fn matches_active(&self, candidate: &RunRecord) -> Result<bool, String> {
        let data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        Ok(data.active.as_ref().is_some_and(|record| {
            record.run_id == candidate.run_id && record.session_id == candidate.session_id
        }))
    }

    #[cfg(test)]
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
