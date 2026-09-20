use super::{
    permissions::{ApprovalDetail, PendingDecision},
    workspace::{PathIntent, WorkspaceRoot},
};
use crate::tool_permissions::{
    agent_request_is_approved, runtime::PermissionRequest, AgentPermissionApproval,
};
use std::path::Path;

fn request_paths(request: &PermissionRequest) -> Result<Vec<&Path>, String> {
    if request.patterns.is_empty() || request.patterns.iter().any(String::is_empty) {
        return Err("agent_path_metadata_missing".to_owned());
    }
    Ok(request.patterns.iter().map(Path::new).collect())
}

fn read_paths_allowed(
    workspace: &WorkspaceRoot,
    request: &PermissionRequest,
) -> Result<bool, String> {
    Ok(request_paths(request)?.into_iter().all(|path| {
        workspace
            .resolve_opencode(path, PathIntent::Existing)
            .is_ok()
    }))
}

fn mutation_paths_allowed(
    workspace: &WorkspaceRoot,
    request: &PermissionRequest,
) -> Result<bool, String> {
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
        let Ok(target) = workspace.resolve_opencode(filepath, intent) else {
            return Ok(false);
        };
        return Ok(patterns
            .into_iter()
            .all(|path| workspace.matches_opencode_path(path, intent, &target)));
    }

    Ok(patterns.into_iter().all(|path| {
        workspace
            .resolve_opencode(path, PathIntent::Existing)
            .is_ok()
            || workspace
                .resolve_opencode(path, PathIntent::NewFile)
                .is_ok()
    }))
}

pub(super) fn decision_with_approvals(
    workspace: &WorkspaceRoot,
    request: &PermissionRequest,
    approvals: &[AgentPermissionApproval],
) -> Result<PendingDecision, String> {
    let decision = match request.permission.as_str() {
        "read" | "glob" | "grep" | "list" => {
            if read_paths_allowed(workspace, request)? {
                PendingDecision::AllowOnce
            } else {
                PendingDecision::Reject
            }
        }
        "edit" | "write" | "patch" => {
            if mutation_paths_allowed(workspace, request)? {
                PendingDecision::Ask(ApprovalDetail {
                    command: None,
                    cwd: workspace.path().to_path_buf(),
                })
            } else {
                PendingDecision::Reject
            }
        }
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
            PendingDecision::Ask(ApprovalDetail {
                command: Some(command.to_owned()),
                cwd: workspace.path().to_path_buf(),
            })
        }
        "webfetch" | "websearch" => PendingDecision::Ask(ApprovalDetail {
            command: None,
            cwd: workspace.path().to_path_buf(),
        }),
        "external_directory" | "question" | "task" | "doom_loop" => PendingDecision::Reject,
        _ => PendingDecision::Reject,
    };
    if matches!(decision, PendingDecision::Ask(_))
        && agent_request_is_approved(approvals, workspace.path(), request)
    {
        Ok(PendingDecision::AllowOnce)
    } else {
        Ok(decision)
    }
}
