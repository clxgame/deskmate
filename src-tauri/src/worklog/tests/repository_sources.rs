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
fn source_deletion_clears_transitive_snapshots_and_cancels_generation() {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let saved = repo.record_entry(&request()).unwrap();
    let daily = SaveReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Daily,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        expected_revision: None,
        body_markdown: "Source may remain in report body".into(),
    };
    let report = repo.save_report(&daily).unwrap();
    let detail = repo.get_report(&report.entity_id).unwrap();
    let version = &detail.versions[0];
    let source = SourceSnapshot {
        source: SourceRef {
            kind: "entry".into(),
            id: saved.entity_id.clone(),
            revision: 1,
        },
        business_date: "2026-09-07".into(),
        project: None,
        text: "private synthetic source".into(),
        entry_status: Some(EntryStatus::Done),
    };
    repo.store.with_transaction(|db|{
        db.execute("INSERT INTO report_sources VALUES (?1,'entry',?2,1)",params![version.id,saved.entity_id])?;
        db.execute("UPDATE report_versions SET source_revision_manifest=?1,source_snapshot=?2 WHERE id=?3",params![serde_json::to_string(&vec![&source.source])?,serde_json::to_string(&vec![&source])?,version.id])?;
        db.execute("INSERT INTO report_runs(id,kind,period_start,period_end,occurrence_key,state,source_manifest,source_snapshot,model_id,created_at,updated_at) VALUES ('run','daily','2026-09-07','2026-09-07','test','running',?1,?2,'p/m','now','now')",params![serde_json::to_string(&vec![&source.source])?,serde_json::to_string(&vec![&source])?])?;
        Ok(())
    }).unwrap();
    repo.delete_entry(&DeleteRecord {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: saved.entity_id,
        expected_revision: 1,
        delete_linked_reports: false,
    })
    .unwrap();
    let after = repo.get_report(&report.entity_id).unwrap();
    assert!(after.report.stale);
    assert!(after.report.source_deleted);
    assert!(after.versions[0].source_snapshot.is_empty());
    assert_eq!(after.versions[0].body_markdown, daily.body_markdown);
    let runs = repo.list_runs().unwrap();
    assert_eq!(
        runs[0].state,
        super::super::contract_runtime::RunState::Cancelled
    );
    assert!(runs[0].source_snapshot.is_empty());
}

#[test]
fn manual_save_preserves_freshness_and_date_move_marks_old_day() {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let entry = repo.record_entry(&request()).unwrap();
    let mut daily = SaveReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Daily,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        expected_revision: None,
        body_markdown: "Original notes".into(),
    };
    let saved = repo.save_report(&daily).unwrap();
    assert!(!repo.get_report(&saved.entity_id).unwrap().report.stale);
    daily.request_id = uuid::Uuid::new_v4().to_string();
    daily.expected_revision = Some(1);
    repo.save_report(&daily).unwrap();
    assert!(!repo.get_report(&saved.entity_id).unwrap().report.stale);
    repo.update_entry(&UpdateEntry {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: entry.entity_id,
        expected_revision: 1,
        business_date: "2026-09-08".into(),
        project: None,
        text: "Moved work item".into(),
        status: EntryStatus::Done,
    })
    .unwrap();
    assert!(repo.get_report(&saved.entity_id).unwrap().report.stale);
}

#[test]
fn explicit_retry_rebinds_model_and_retains_attempt_fence() {
    use super::super::contract_runtime::*;
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let saved = repo
        .generate_report(&GenerateReport {
            request_id: uuid::Uuid::new_v4().to_string(),
            kind: ReportKind::Daily,
            period_start: "2026-09-07".into(),
            period_end: "2026-09-07".into(),
            model_id: "old/model".into(),
        })
        .unwrap();
    repo.store
        .with_transaction(|db| {
            db.execute(
                "UPDATE report_runs SET state='failed',attempt=3 WHERE id=?1",
                [&saved.entity_id],
            )?;
            Ok(())
        })
        .unwrap();
    let request = RetryRun {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: saved.entity_id,
    };
    repo.retry_run(&request, "new/model").unwrap();
    let run = repo.list_runs().unwrap().remove(0);
    assert_eq!(run.attempt, 3);
    assert_eq!(run.model_id, "new/model");
    assert_eq!(run.state, RunState::Queued);
    assert_eq!(
        repo.retry_run(&request, "other/model").unwrap().entity_id,
        run.id
    );
}

#[test]
#[ignore = "Prints synthetic SQLite reopen evidence"]
fn manual_sqlite_reopen_evidence() {
    let dir = std::env::temp_dir().join(format!("worklog-manual-{}", uuid::Uuid::new_v4()));
    let path = dir.join("journal.db");
    println!("SURFACE: independent SQLite file in temporary directory; user data never accessed");
    {
        let repo = Repository::new(WorklogStore::open(&path).unwrap());
        let saved = repo.record_entry(&request()).unwrap();
        println!(
            "COMMITTED operation={} entry={} revision={}",
            saved.operation_id, saved.entity_id, saved.revision
        );
    }
    {
        let repo = Repository::new(WorklogStore::open(&path).unwrap());
        let entries = repo
            .query_entries(&DateQuery {
                start: "2026-09-07".into(),
                end: "2026-09-08".into(),
                project: None,
            })
            .unwrap();
        assert_eq!(entries.len(), 1);
        let item = &entries[0];
        assert_eq!(item.text, "Finished release checks");
        println!(
            "REOPEN date={} project={:?} sourceSession={:?} sourceMessage={:?} body={}",
            item.business_date,
            item.project,
            item.source_session_id,
            item.source_message_id,
            item.text
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
    println!("CLEANUP: temporary SQLite directory removed; 2 persistence assertions passed");
}
