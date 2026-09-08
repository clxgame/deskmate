use super::contract::{ReportKind, SourceRef, SourceSnapshot};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveSchedule {
    pub request_id: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub kind: ReportKind,
    pub weekday_set: Vec<u32>,
    pub local_time: String,
    pub enabled: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub kind: ReportKind,
    pub weekday_set: Vec<u32>,
    pub local_time: String,
    pub timezone_mode: String,
    pub enabled: bool,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub next_due_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Queued,
    Running,
    Succeeded,
    NoMaterial,
    RetryWait,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateReport {
    pub request_id: String,
    pub kind: ReportKind,
    pub period_start: String,
    pub period_end: String,
    pub model_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetryRun {
    pub request_id: String,
    pub id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub schedule_id: Option<String>,
    pub kind: ReportKind,
    pub period_start: String,
    pub period_end: String,
    pub occurrence_key: String,
    pub state: RunState,
    pub attempt: i64,
    pub next_retry_at: Option<String>,
    pub lease_until: Option<String>,
    pub session_id: Option<String>,
    pub base_report_revision: Option<i64>,
    pub source_manifest: Vec<SourceRef>,
    pub source_snapshot: Vec<SourceSnapshot>,
    pub model_id: String,
    pub result_report_id: Option<String>,
    pub error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
