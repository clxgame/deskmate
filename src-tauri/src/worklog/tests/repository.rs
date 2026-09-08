use super::*;
fn request() -> RecordEntry {
    RecordEntry {
        request_id: uuid::Uuid::new_v4().to_string(),
        business_date: "2026-09-07".into(),
        project: Some(" Project ".into()),
        original_text: "Finished release checks".into(),
        text: "Finished release checks".into(),
        status: EntryStatus::Done,
        source_session_id: Some("session-a".into()),
        source_message_id: Some("message-a".into()),
    }
}
#[test]
fn idempotent_revision_and_deleted_receipt() {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let request = request();
    let saved = repo.record_entry(&request).unwrap();
    assert_eq!(
        repo.record_entry(&request).unwrap().entity_id,
        saved.entity_id
    );
    let mut different = request.clone();
    different.text = "different".into();
    assert_eq!(
        repo.record_entry(&different).unwrap_err().code,
        "IDEMPOTENCY_CONFLICT"
    );
    let update = UpdateEntry {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: saved.entity_id.clone(),
        expected_revision: 1,
        business_date: request.business_date.clone(),
        project: None,
        text: "Updated release checks".into(),
        status: EntryStatus::Done,
    };
    assert_eq!(repo.update_entry(&update).unwrap().revision, 2);
    let mut stale = update.clone();
    stale.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(repo.update_entry(&stale).unwrap_err().code, "CONFLICT");
    repo.delete_entry(&DeleteRecord {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: saved.entity_id,
        expected_revision: 2,
        delete_linked_reports: false,
    })
    .unwrap();
    assert_eq!(
        repo.operation(&request.request_id).unwrap().unwrap().status,
        "deleted"
    );
}
#[test]
fn sqlite_reopen_preserves_dates_and_provenance() {
    let dir = std::env::temp_dir().join(format!("worklog-persistence-{}", uuid::Uuid::new_v4()));
    let path = dir.join("journal.db");
    {
        let repo = Repository::new(WorklogStore::open(&path).unwrap());
        repo.record_entry(&request()).unwrap();
        let mut second = request();
        second.business_date = "2026-09-08".into();
        repo.record_entry(&second).unwrap();
    }
    {
        let repo = Repository::new(WorklogStore::open(&path).unwrap());
        let rows = repo
            .query_entries(&DateQuery {
                start: "2026-09-07".into(),
                end: "2026-09-11".into(),
                project: Some("Project".into()),
            })
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].business_date, "2026-09-07");
        assert_eq!(rows[1].business_date, "2026-09-08");
        assert_eq!(rows[0].source_message_id.as_deref(), Some("message-a"));
    }
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn secret_and_future_completed_entries_are_rejected() {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let mut input = request();
    input.original_text = "api_key=secret-value".into();
    assert_eq!(
        repo.record_entry(&input).unwrap_err().code,
        "SECRET_REJECTED"
    );
    input = request();
    input.business_date = "2099-01-01".into();
    assert_eq!(
        repo.record_entry(&input).unwrap_err().code,
        "VALIDATION_FAILED"
    );
    input.status = EntryStatus::Planned;
    assert!(repo.record_entry(&input).is_ok());
}
#[test]
fn daily_import_versions_are_unique_and_protected() {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let request = SaveReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Daily,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        expected_revision: None,
        body_markdown: "# Daily\nOriginal work notes".into(),
    };
    let first = repo.save_report(&request).unwrap();
    let mut next = request.clone();
    next.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(repo.save_report(&next).unwrap_err().code, "CONFLICT");
    next.expected_revision = Some(1);
    next.body_markdown = "Revised daily".into();
    repo.save_report(&next).unwrap();
    let detail = repo.get_report(&first.entity_id).unwrap();
    assert_eq!(detail.versions.len(), 2);
    assert_eq!(detail.versions[1].body_markdown, request.body_markdown);
    assert_eq!(detail.report.revision, 2);
}

#[test]
fn schedule_receipt_has_atomic_next_time_and_pause_resume() {
    use super::super::contract_runtime::*;
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let mut request = SaveSchedule {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: None,
        expected_revision: None,
        kind: ReportKind::Weekly,
        weekday_set: vec![5],
        local_time: "17:00".into(),
        enabled: true,
    };
    let saved = repo.save_schedule(&request).unwrap();
    let initial = repo.list_schedules().unwrap().remove(0);
    assert!(initial.next_due_at.is_some());
    assert!(initial.enabled);
    request.id = Some(saved.entity_id);
    request.expected_revision = Some(1);
    request.request_id = uuid::Uuid::new_v4().to_string();
    request.enabled = false;
    repo.save_schedule(&request).unwrap();
    let paused = repo.list_schedules().unwrap().remove(0);
    assert!(paused.next_due_at.is_none());
    assert!(!paused.enabled);
    request.expected_revision = Some(2);
    request.request_id = uuid::Uuid::new_v4().to_string();
    request.enabled = true;
    repo.save_schedule(&request).unwrap();
    assert!(repo.list_schedules().unwrap()[0].next_due_at.is_some());
}

#[test]
fn generate_replay_is_stable_after_configured_model_changes() {
    use super::super::contract_runtime::*;
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let mut request = GenerateReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Daily,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        model_id: "first/model".into(),
    };
    let first = repo.generate_report(&request).unwrap();
    request.model_id = "changed/model".into();
    let replayed = repo.generate_report(&request).unwrap();
    assert_eq!(first.entity_id, replayed.entity_id);
    assert_eq!(repo.list_runs().unwrap()[0].model_id, "first/model");
}
