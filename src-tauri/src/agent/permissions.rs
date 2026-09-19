use super::workspace::{PathIntent, WorkspaceRoot};
use crate::{tool_permissions::runtime::PermissionRequest, worklog::bridge::safe_id};
use serde::Deserialize;
use std::{collections::HashMap, path::Path, sync::Mutex};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentReply {
    Once,
    Reject,
}

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
}

struct OwnedRequest {
    run_id: String,
    request: PermissionRequest,
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
        if !safe_id(run_id) || !safe_id(session_id) {
            return Err("agent_invalid_id".into());
        }
        let run = OwnedRun {
            session_id: session_id.to_owned(),
            workspace: WorkspaceRoot::open(workspace).map_err(|error| error.to_string())?,
        };
        let mut data = self
            .0
            .lock()
            .map_err(|_| "agent_permission_unavailable".to_owned())?;
        data.pending.retain(|_, request| request.run_id != run_id);
        data.blocked_sessions.insert(session_id.to_owned());
        data.runs.insert(run_id.to_owned(), run);
        Ok(())
    }

    pub(super) fn accept(
        &self,
        run_id: &str,
        request: PermissionRequest,
    ) -> Result<PendingDecision, String> {
        if !safe_id(run_id) || !safe_id(&request.id) || !safe_id(&request.session_id) {
            return Err("agent_invalid_id".into());
        }
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
        let decision = decision(run, &request)?;
        if matches!(decision, PendingDecision::Ask(_)) {
            if let Some(existing) = data.pending.get(&request.id) {
                return if existing.run_id == run_id {
                    Ok(decision)
                } else {
                    Err("agent_permission_owner_mismatch".into())
                };
            }
            data.pending.insert(
                request.id.clone(),
                OwnedRequest {
                    run_id: run_id.to_owned(),
                    request,
                },
            );
        }
        Ok(decision)
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

fn request_paths(request: &PermissionRequest) -> Result<Vec<&Path>, String> {
    if request.patterns.is_empty() || request.patterns.iter().any(String::is_empty) {
        return Err("agent_path_metadata_missing".to_owned());
    }
    Ok(request.patterns.iter().map(Path::new).collect())
}

fn read_paths_allowed(run: &OwnedRun, request: &PermissionRequest) -> Result<bool, String> {
    Ok(request_paths(request)?.into_iter().all(|path| {
        run.workspace
            .resolve_opencode(path, PathIntent::Existing)
            .is_ok()
    }))
}

fn mutation_paths_allowed(run: &OwnedRun, request: &PermissionRequest) -> Result<bool, String> {
    let patterns = request_paths(request)?;
    if let Some(filepath) = request
        .metadata
        .get("filepath")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let filepath = Path::new(filepath);
        let intent = if filepath.exists() {
            PathIntent::Existing
        } else {
            PathIntent::NewFile
        };
        let Ok(target) = run.workspace.resolve_opencode(filepath, intent) else {
            return Ok(false);
        };
        return Ok(patterns
            .into_iter()
            .all(|path| run.workspace.matches_opencode_path(path, intent, &target)));
    }

    Ok(patterns.into_iter().all(|path| {
        run.workspace
            .resolve_opencode(path, PathIntent::Existing)
            .is_ok()
            || run
                .workspace
                .resolve_opencode(path, PathIntent::NewFile)
                .is_ok()
    }))
}

fn decision(run: &OwnedRun, request: &PermissionRequest) -> Result<PendingDecision, String> {
    match request.permission.as_str() {
        "read" | "glob" | "grep" | "list" => Ok(if read_paths_allowed(run, request)? {
            PendingDecision::AllowOnce
        } else {
            PendingDecision::Reject
        }),
        "edit" | "write" | "patch" => Ok(if mutation_paths_allowed(run, request)? {
            PendingDecision::Ask(ApprovalDetail {
                command: None,
                cwd: run.workspace.path().to_path_buf(),
            })
        } else {
            PendingDecision::Reject
        }),
        "bash" | "shell" => {
            let Some(command) = request
                .metadata
                .get("command")
                .and_then(serde_json::Value::as_str)
            else {
                return Err("agent_shell_metadata_missing".into());
            };
            if command.is_empty() {
                return Err("agent_shell_metadata_missing".into());
            }
            Ok(PendingDecision::Ask(ApprovalDetail {
                command: Some(command.to_owned()),
                cwd: run.workspace.path().to_path_buf(),
            }))
        }
        "webfetch" | "websearch" => Ok(PendingDecision::Ask(ApprovalDetail {
            command: None,
            cwd: run.workspace.path().to_path_buf(),
        })),
        "external_directory" | "question" | "task" | "doom_loop" => Ok(PendingDecision::Reject),
        _ => Ok(PendingDecision::Reject),
    }
}

#[cfg(test)]
#[path = "permissions_path_tests.rs"]
mod path_tests;
#[cfg(test)]
#[path = "permissions_tests.rs"]
mod tests;
