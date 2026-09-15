use serde::{Deserialize, Serialize};

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
#[cfg(test)]
mod tests;
