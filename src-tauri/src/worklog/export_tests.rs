use super::*;
use std::fs;

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("worklog-export-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn prepared(format: ExportFormat) -> PreparedExport {
    PreparedExport {
        stem: "周报_2026-09-07_2026-09-11_v1".into(),
        body: "# 本周成果\n\n- 完成中文导出 ✅\n\n**人工修订**\n".into(),
        format,
    }
}

#[test]
fn exports_utf8_both_formats_and_preserves_colliding_file() {
    let sandbox = Sandbox::new();
    for format in [ExportFormat::Markdown, ExportFormat::Text] {
        let document = prepared(format);
        let first = write_export(&sandbox.0, &document, write_body).unwrap();
        let second = write_export(&sandbox.0, &document, write_body).unwrap();
        assert_ne!(first.file_name, second.file_name);
        assert!(second.file_name.contains(" (1)."));
        for receipt in [first, second] {
            assert_eq!(
                fs::read_to_string(sandbox.0.join(&receipt.file_name)).unwrap(),
                document.body
            );
            chrono::DateTime::parse_from_rfc3339(&receipt.exported_at).unwrap();
            let json = serde_json::to_value(receipt).unwrap();
            assert_eq!(json.as_object().unwrap().len(), 2);
        }
    }
}

#[test]
fn partial_write_failure_cleans_reserved_file() {
    let sandbox = Sandbox::new();
    let result = write_export(&sandbox.0, &prepared(ExportFormat::Markdown), |file, _| {
        file.write_all("部分写入".as_bytes())?;
        Err(std::io::Error::new(
            std::io::ErrorKind::WriteZero,
            "injected full disk",
        ))
    });
    assert_eq!(result.unwrap_err().code, "EXPORT_FAILED");
    assert_eq!(fs::read_dir(&sandbox.0).unwrap().count(), 0);
}

#[test]
fn permission_failure_cleans_file_and_exposes_no_native_path() {
    let sandbox = Sandbox::new();
    let document = prepared(ExportFormat::Text);
    let path = sandbox.0.join(format!("{}.txt", document.stem));
    let result = write_export(&sandbox.0, &document, |_, bytes| {
        File::open(&path)?.write_all(bytes)
    });
    let error = result.unwrap_err();
    assert_eq!(error.code, "EXPORT_FAILED");
    assert!(!error.message.contains(&sandbox.0.display().to_string()));
    assert_eq!(fs::read_dir(&sandbox.0).unwrap().count(), 0);
}

#[test]
fn missing_destination_and_unknown_request_fields_are_rejected() {
    let sandbox = Sandbox::new();
    assert_eq!(
        write_export(
            &sandbox.0.join("missing"),
            &prepared(ExportFormat::Text),
            write_body
        )
        .unwrap_err()
        .code,
        "DOWNLOADS_UNAVAILABLE"
    );
    assert!(serde_json::from_str::<ExportReportRequest>(
        r#"{"reportId":"r","versionId":"v","format":"text","path":"C:/private"}"#
    )
    .is_err());
}

#[test]
fn resolves_selected_historical_version_and_rejects_other_report_version() {
    use super::super::{contract::SaveReport, storage::WorklogStore};
    let sandbox = Sandbox::new();
    let repository = Repository::new(WorklogStore::open(&sandbox.0.join("journal.db")).unwrap());
    let mut save = SaveReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Weekly,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-11".into(),
        expected_revision: None,
        body_markdown: "# 第一版\n人工中文正文".into(),
    };
    let receipt = repository.save_report(&save).unwrap();
    let original = repository
        .get_report(&receipt.entity_id)
        .unwrap()
        .versions
        .remove(0);
    save.request_id = uuid::Uuid::new_v4().to_string();
    save.expected_revision = Some(receipt.revision);
    save.body_markdown = "第二版，不应导出".into();
    repository.save_report(&save).unwrap();
    let mut request = ExportReportRequest {
        report_id: receipt.entity_id,
        version_id: original.id,
        format: ExportFormat::Markdown,
    };
    let selected = prepare(&repository, &request).unwrap();
    let exported = write_export(&sandbox.0, &selected, write_body).unwrap();
    assert_eq!(
        fs::read_to_string(sandbox.0.join(exported.file_name)).unwrap(),
        original.body_markdown
    );
    save.request_id = uuid::Uuid::new_v4().to_string();
    save.expected_revision = None;
    save.kind = ReportKind::Custom;
    let other = repository.save_report(&save).unwrap();
    request.version_id = repository
        .get_report(&other.entity_id)
        .unwrap()
        .versions
        .remove(0)
        .id;
    assert_eq!(
        prepare(&repository, &request).err().unwrap().code,
        "NOT_FOUND"
    );
}

#[test]
#[ignore = "Writes synthetic export evidence under the repository evidence directory"]
fn manual_export_reopen_evidence() {
    let destination = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".omo/evidence/task-9-work-journal-reports-happy");
    fs::create_dir_all(&destination).unwrap();
    for format in [ExportFormat::Markdown, ExportFormat::Text] {
        let document = prepared(format);
        let receipt = write_export(&destination, &document, write_body).unwrap();
        let path = destination.join(&receipt.file_name);
        let reopened = fs::read_to_string(&path).unwrap();
        assert_eq!(reopened, document.body);
        println!(
            "Exported and reopened {} ({} UTF-8 bytes): {:?}",
            path.display(),
            reopened.len(),
            receipt
        );
    }
}
