use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EntryStatus {
    Done,
    InProgress,
    Blocked,
    Planned,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReportKind {
    Daily,
    Weekly,
    Custom,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VersionOrigin {
    Generated,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordEntry {
    pub request_id: String,
    pub business_date: String,
    pub project: Option<String>,
    pub original_text: String,
    pub text: String,
    pub status: EntryStatus,
    pub source_session_id: Option<String>,
    pub source_message_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateEntry {
    pub request_id: String,
    pub id: String,
    pub expected_revision: i64,
    pub business_date: String,
    pub project: Option<String>,
    pub text: String,
    pub status: EntryStatus,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub business_date: String,
    pub project: Option<String>,
    pub original_text: String,
    pub text: String,
    pub status: EntryStatus,
    pub source_session_id: Option<String>,
    pub source_message_id: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DateQuery {
    pub start: String,
    pub end: String,
    pub project: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteRecord {
    pub request_id: String,
    pub id: String,
    pub expected_revision: i64,
    #[serde(default)]
    pub delete_linked_reports: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationReceipt {
    pub operation_id: String,
    pub entity_kind: String,
    pub entity_id: String,
    pub revision: i64,
    pub business_date: Option<String>,
    pub status: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub id: String,
    pub kind: ReportKind,
    pub period_start: String,
    pub period_end: String,
    pub current_version_id: Option<String>,
    pub revision: i64,
    pub stale: bool,
    pub source_deleted: bool,
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub kind: String,
    pub id: String,
    pub revision: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSnapshot {
    #[serde(default)]
    pub entry_status: Option<EntryStatus>,
    pub source: SourceRef,
    pub business_date: String,
    pub project: Option<String>,
    pub text: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportVersion {
    pub id: String,
    pub report_id: String,
    pub version: i64,
    pub body_markdown: String,
    pub origin: VersionOrigin,
    pub source_revision_manifest: Vec<SourceRef>,
    pub source_snapshot: Vec<SourceSnapshot>,
    pub coverage_dates: Vec<String>,
    pub generated_at: String,
    pub model_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportDetail {
    pub report: Report,
    pub versions: Vec<ReportVersion>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveReport {
    pub request_id: String,
    pub kind: ReportKind,
    pub period_start: String,
    pub period_end: String,
    pub expected_revision: Option<i64>,
    pub body_markdown: String,
}

pub fn enum_text<T: Serialize>(value: &T) -> super::error::WorklogResult<String> {
    match serde_json::to_value(value)? {
        serde_json::Value::String(text) => Ok(text),
        _ => Err(super::error::WorklogError::validation(
            "Expected enum value",
        )),
    }
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyVersion {
    pub request_id: String,
    pub report_id: String,
    pub version_id: String,
    pub expected_revision: i64,
}
