use super::{
    permission_policy::decision_with_approvals,
    permission_provenance::{matches_current_tool, validate_request},
    workspace::WorkspaceRoot,
};
use crate::{
    tool_permissions::{
        approvals_for_request, runtime::PermissionRequest, AgentPermissionApproval,
    },
    worklog::bridge::safe_id,
};
use std::{collections::HashMap, path::Path, sync::Mutex};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum PendingDecision {
    AllowOnce,
    Ask(ApprovalDetail),
    Reject,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ApprovalDetail {
    pub(super) command: Option<String>,
    pub(super) cwd: std::path::PathBuf,
}

struct OwnedRun {
    session_id: String,
    workspace: WorkspaceRoot,
    approvals: Vec<AgentPermissionApproval>,
}

struct OwnedRequest {
    run_id: String,
    request: PermissionRequest,
    detail: ApprovalDetail,
}

pub(super) struct WaitingPermission {
    pub(super) request: PermissionRequest,
    pub(super) detail: ApprovalDetail,
}

#[derive(Default)]
struct PermissionData {
    runs: HashMap<String, OwnedRun>,
    pending: HashMap<String, OwnedRequest>,
    blocked_sessions: std::collections::HashSet<String>,
}

#[derive(Default)]
pub(crate) struct AgentPermissionState(Mutex<PermissionData>);

impl AgentPermissionState {
    pub(crate) fn register_run(
        &self,
        run_id: &str,
        session_id: &str,
        workspace: impl AsRef<Path>,
    ) -> Result<(), String> {
        self.register_run_with_approvals(run_id, session_id, workspace, &[])
    }

    pub(crate) fn register_run_with_approvals(
        &self,
        run_id: &str,
        session_id: &str,
        workspace: impl AsRef<Path>,
        approvals: &[AgentPermissionApproval],
    ) -> Result<(), String> {
        if !safe_id(run_id) || !safe_id(session_id) {
            return Err("agent_invalid_id".into());
        }
        let run = OwnedRun {
            session_id: session_id.to_owned(),
            workspace: WorkspaceRoot::open(workspace).map_err(|error| error.to_string())?,
            approvals: approvals.to_vec(),
        };
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        let old_run_ids = data
            .runs
            .iter()
            .filter(|(_, owned)| owned.session_id == session_id)
            .map(|(owned_run_id, _)| owned_run_id.clone())
            .collect::<Vec<_>>();
        data.pending.retain(|_, request| {
            request.run_id != run_id && !old_run_ids.contains(&request.run_id)
        });
        data.runs
            .retain(|owned_run_id, _| !old_run_ids.contains(owned_run_id));
        data.blocked_sessions.insert(session_id.to_owned());
        data.runs.insert(run_id.to_owned(), run);
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn accept(
        &self,
        run_id: &str,
        request: PermissionRequest,
    ) -> Result<PendingDecision, String> {
        validate_request(run_id, &request)?;
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        let run = data
            .runs
            .get(run_id)
            .ok_or_else(|| "agent_run_unknown".to_owned())?;
        if run.session_id != request.session_id {
            return Err("agent_session_mismatch".into());
        }
        let result = decision_with_approvals(&run.workspace, &request, &run.approvals)?;
        if let PendingDecision::Ask(detail) = &result {
            if let Some(existing) = data.pending.get(&request.id) {
                return if existing.run_id == run_id {
                    Ok(result)
                } else {
                    Err("agent_permission_owner_mismatch".into())
                };
            }
            data.pending.insert(
                request.id.clone(),
                OwnedRequest {
                    run_id: run_id.to_owned(),
                    request,
                    detail: detail.clone(),
                },
            );
        }
        Ok(result)
    }

    pub(super) fn sync_pending(
        &self,
        run_id: &str,
        requests: Vec<PermissionRequest>,
        message_ids: &[String],
        call_ids: &[String],
    ) -> Result<Vec<(PermissionRequest, PendingDecision)>, String> {
        if !safe_id(run_id) {
            return Err("agent_invalid_id".into());
        }
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        if !data.runs.contains_key(run_id) {
            return Err("agent_run_unknown".to_owned());
        }
        data.pending.retain(|_, request| request.run_id != run_id);
        let run = data
            .runs
            .get(run_id)
            .ok_or_else(|| "agent_run_unknown".to_owned())?;
        let mut evaluated = Vec::with_capacity(requests.len());
        for request in requests {
            validate_request(run_id, &request)?;
            if run.session_id != request.session_id {
                return Err("agent_session_mismatch".into());
            }
            if !matches_current_tool(&request, message_ids, call_ids) {
                continue;
            }
            let result = decision_with_approvals(&run.workspace, &request, &run.approvals)?;
            evaluated.push((request, result));
        }
        for (request, result) in &evaluated {
            if let PendingDecision::Ask(detail) = result {
                data.pending.insert(
                    request.id.clone(),
                    OwnedRequest {
                        run_id: run_id.to_owned(),
                        request: request.clone(),
                        detail: detail.clone(),
                    },
                );
            }
        }
        Ok(evaluated)
    }

    pub(super) fn waiting(&self, run_id: &str) -> Result<Vec<WaitingPermission>, String> {
        let data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        if !data.runs.contains_key(run_id) {
            return Err("agent_run_unknown".to_owned());
        }
        let mut waiting: Vec<_> = data
            .pending
            .values()
            .filter(|owned| owned.run_id == run_id)
            .map(|owned| WaitingPermission {
                request: owned.request.clone(),
                detail: owned.detail.clone(),
            })
            .collect();
        waiting.sort_by(|left, right| left.request.id.cmp(&right.request.id));
        Ok(waiting)
    }

    pub(super) fn take_reply(
        &self,
        run_id: &str,
        request_id: &str,
    ) -> Result<PermissionRequest, String> {
        if !safe_id(run_id) || !safe_id(request_id) {
            return Err("agent_invalid_id".into());
        }
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        let owned = data
            .pending
            .get(request_id)
            .ok_or_else(|| "agent_permission_expired".to_owned())?;
        if owned.run_id != run_id {
            return Err("agent_permission_owner_mismatch".into());
        }
        data.pending
            .remove(request_id)
            .map(|owned| owned.request)
            .ok_or_else(|| "agent_permission_expired".to_owned())
    }

    pub(crate) fn remember_approval(
        &self,
        run_id: &str,
        request: &PermissionRequest,
    ) -> Result<(), String> {
        if !safe_id(run_id) || !safe_id(&request.id) {
            return Err("agent_invalid_id".into());
        }
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        let run = data
            .runs
            .get_mut(run_id)
            .ok_or_else(|| "agent_run_unknown".to_owned())?;
        for approval in approvals_for_request(run.workspace.path(), request)? {
            if !run.approvals.contains(&approval) {
                run.approvals.push(approval);
            }
        }
        Ok(())
    }

    pub(crate) fn forget_approval(&self, approval: &AgentPermissionApproval) -> Result<(), String> {
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        for run in data.runs.values_mut() {
            run.approvals.retain(|saved| saved != approval);
        }
        Ok(())
    }

    pub(crate) fn cancel_run(&self, run_id: &str) -> Result<(), String> {
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        if data.runs.remove(run_id).is_none() {
            return Err("agent_run_unknown".into());
        }
        data.pending.retain(|_, request| request.run_id != run_id);
        Ok(())
    }

    pub(crate) fn block_session(&self, session_id: &str) -> Result<(), String> {
        if !safe_id(session_id) {
            return Err("agent_invalid_id".into());
        }
        self.0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?
            .blocked_sessions
            .insert(session_id.to_owned());
        Ok(())
    }

    pub(crate) fn reject_legacy_session(&self, session_id: &str) -> Result<(), String> {
        if !safe_id(session_id) {
            return Err("agent_invalid_id".into());
        }
        let data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        if data.blocked_sessions.contains(session_id) {
            Err("permission_agent_session_scoped".into())
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
#[path = "permissions_path_tests.rs"]
mod path_tests;
#[cfg(test)]
#[path = "permissions_tests.rs"]
mod tests;
