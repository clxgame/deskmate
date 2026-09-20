use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolPermissions {
    pub worklog_read: Mode,
    pub worklog_write: Mode,
    pub web: Mode,
    pub shell: Mode,
}
impl Default for ToolPermissions {
    fn default() -> Self {
        Self {
            worklog_read: Mode::Allow,
            worklog_write: Mode::Allow,
            web: Mode::Allow,
            shell: Mode::Ask,
        }
    }
}
impl ToolPermissions {
    pub fn mode(&self, permission: &str) -> Mode {
        match permission {
            "worklog_query" => self.worklog_read,
            "worklog_record"
            | "worklog_update"
            | "worklog_generate_report"
            | "worklog_schedule_report" => self.worklog_write,
            "webfetch" | "websearch" => self.web,
            "bash" | "shell" => self.shell,
            _ => Mode::Deny,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentPermissionApproval {
    pub workspace_path: PathBuf,
    pub permission: String,
    pub pattern: String,
}

fn same_workspace(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

pub(crate) fn rememberable_agent_patterns(
    request: &runtime::PermissionRequest,
) -> Option<&[String]> {
    if !matches!(request.permission.as_str(), "bash" | "shell")
        || request.always.is_empty()
        || request
            .always
            .iter()
            .any(|pattern| pattern.is_empty() || pattern == "*" || pattern.len() > 2_048)
    {
        return None;
    }
    Some(&request.always)
}

pub(crate) fn agent_request_is_approved(
    approvals: &[AgentPermissionApproval],
    workspace: &Path,
    request: &runtime::PermissionRequest,
) -> bool {
    let Some(patterns) = rememberable_agent_patterns(request) else {
        return false;
    };
    patterns.iter().all(|pattern| {
        approvals.iter().any(|approval| {
            same_workspace(&approval.workspace_path, workspace)
                && approval.permission == request.permission
                && approval.pattern == *pattern
        })
    })
}

pub(crate) fn approvals_for_request(
    workspace: &Path,
    request: &runtime::PermissionRequest,
) -> Result<Vec<AgentPermissionApproval>, String> {
    let patterns = rememberable_agent_patterns(request)
        .ok_or_else(|| "agent_permission_not_rememberable".to_owned())?;
    Ok(patterns
        .iter()
        .map(|pattern| AgentPermissionApproval {
            workspace_path: workspace.to_path_buf(),
            permission: request.permission.clone(),
            pattern: pattern.clone(),
        })
        .collect())
}

pub const CONTROLLED_TOOLS: &[&str] = &[
    "bash",
    "webfetch",
    "websearch",
    "worklog_record",
    "worklog_query",
    "worklog_update",
    "worklog_generate_report",
    "worklog_schedule_report",
];

pub mod events;
pub mod runtime;
mod scoped;
#[cfg(test)]
mod tests;
