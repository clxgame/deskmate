use super::{
    commands::WorklogState,
    contract::ReportKind,
    error::{WorklogError, WorklogResult},
    repository::Repository,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Markdown,
    Text,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportReportRequest {
    pub report_id: String,
    pub version_id: String,
    pub format: ExportFormat,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReportReceipt {
    pub file_name: String,
    pub exported_at: String,
}

struct PreparedExport {
    stem: String,
    body: String,
    format: ExportFormat,
}

#[tauri::command]
pub fn worklog_export_report(
    app: tauri::AppHandle,
    state: tauri::State<'_, WorklogState>,
    request: ExportReportRequest,
) -> WorklogResult<ExportReportReceipt> {
    let document = state.with_repository(|repository| prepare(repository, &request))?;
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| downloads_unavailable())?;
    write_export(&downloads, &document, write_body)
}

fn prepare(
    repository: &Repository,
    request: &ExportReportRequest,
) -> WorklogResult<PreparedExport> {
    let detail = repository.get_report(&request.report_id)?;
    let version = detail
        .versions
        .into_iter()
        .find(|version| version.id == request.version_id && version.report_id == request.report_id)
        .ok_or_else(WorklogError::missing)?;
    super::repository::range(&detail.report.period_start, &detail.report.period_end)?;
    let kind = match detail.report.kind {
        ReportKind::Daily => "日报",
        ReportKind::Weekly => "周报",
        ReportKind::Custom => "工作报告",
    };
    Ok(PreparedExport {
        stem: format!(
            "{kind}_{}_{}_v{}",
            detail.report.period_start, detail.report.period_end, version.version
        ),
        body: version.body_markdown,
        format: request.format,
    })
}

struct ReservedFile {
    file: Option<File>,
    path: PathBuf,
    committed: bool,
}
impl Drop for ReservedFile {
    fn drop(&mut self) {
        // Close first: Windows may refuse removal while the writer remains open.
        drop(self.file.take());
        if !self.committed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn write_export(
    directory: &Path,
    document: &PreparedExport,
    writer: impl FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
) -> WorklogResult<ExportReportReceipt> {
    if !directory.is_dir() {
        return Err(downloads_unavailable());
    }
    let extension = match document.format {
        ExportFormat::Markdown => "md",
        ExportFormat::Text => "txt",
    };
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("{}.{extension}", document.stem)
        } else {
            format!("{} ({suffix}).{extension}", document.stem)
        };
        let destination = directory.join(&name);
        let file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(export_failed()),
        };
        let mut reserved = ReservedFile {
            file: Some(file),
            path: destination,
            committed: false,
        };
        let file = reserved.file.as_mut().ok_or_else(export_failed)?;
        writer(file, document.body.as_bytes()).map_err(|_| export_failed())?;
        file.sync_all().map_err(|_| export_failed())?;
        reserved.committed = true;
        return Ok(ExportReportReceipt {
            file_name: name,
            exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        });
    }
    Err(WorklogError::new(
        "EXPORT_NAME_UNAVAILABLE",
        "Too many exports share this file name",
    ))
}

fn write_body(file: &mut File, body: &[u8]) -> std::io::Result<()> {
    file.write_all(body)
}
fn downloads_unavailable() -> WorklogError {
    WorklogError::new("DOWNLOADS_UNAVAILABLE", "Downloads folder is unavailable")
}
fn export_failed() -> WorklogError {
    WorklogError::new("EXPORT_FAILED", "Report could not be written to Downloads")
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod tests;
