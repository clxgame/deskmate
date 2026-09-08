use super::super::contract_runtime::GenerateReport;
use super::*;
use chrono::Utc;

fn generate(repo: &Repository, kind: ReportKind) -> String {
    repo.generate_report(&GenerateReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        model_id: "fixture/model".into(),
    })
    .unwrap();
    let claim = repo.claim_run(Utc::now()).unwrap().unwrap();
    repo.publish_run(&claim, ("Synthetic sourced report", Utc::now()))
        .unwrap()
        .unwrap()
}
fn chain() -> (Repository, String, String, String) {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    let entry = repo
        .record_entry(&RecordEntry {
            request_id: uuid::Uuid::new_v4().to_string(),
            business_date: "2026-09-07".into(),
            project: Some("Alpha".into()),
            original_text: "Completed synthetic checks".into(),
            text: "Completed synthetic checks".into(),
            status: EntryStatus::Done,
            source_session_id: None,
            source_message_id: None,
        })
        .unwrap();
    let daily = generate(&repo, ReportKind::Daily);
    let weekly = generate(&repo, ReportKind::Weekly);
    (repo, entry.entity_id, daily, weekly)
}
#[test]
fn project_filter_follows_weekly_daily_snapshot_sources() {
    let (repo, _, _, _) = chain();
    let mut query = DateQuery {
        start: "2026-09-07".into(),
        end: "2026-09-11".into(),
        project: Some("Alpha".into()),
    };
    assert_eq!(repo.list_reports(&query).unwrap().len(), 2);
    query.project = Some("Other".into());
    assert!(repo.list_reports(&query).unwrap().is_empty());
}
#[test]
fn apply_candidate_invalidates_previous_current_dependents() {
    let (repo, _, daily, weekly) = chain();
    let original = repo.get_report(&daily).unwrap().versions[0].id.clone();
    repo.save_report(&SaveReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Daily,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        expected_revision: Some(1),
        body_markdown: "Human revised daily".into(),
    })
    .unwrap();
    generate(&repo, ReportKind::Weekly);
    assert!(!repo.get_report(&weekly).unwrap().report.stale);
    repo.apply_version(&ApplyVersion {
        request_id: uuid::Uuid::new_v4().to_string(),
        report_id: daily.clone(),
        version_id: original,
        expected_revision: 2,
    })
    .unwrap();
    assert!(repo.get_report(&weekly).unwrap().report.stale);
    assert!(!repo.get_report(&daily).unwrap().report.stale);
    assert_eq!(
        repo.get_report(&daily).unwrap().versions[0].origin,
        VersionOrigin::Manual
    );
}
#[test]
fn deleting_entry_purges_weekly_daily_snapshot_and_late_run() {
    let (repo, entry, daily, weekly) = chain();
    repo.generate_report(&GenerateReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Weekly,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        model_id: "fixture/model".into(),
    })
    .unwrap();
    let pending = repo.claim_run(Utc::now()).unwrap().unwrap();
    assert!(pending
        .sources
        .iter()
        .any(|s| s.source.kind == "daily_version"));
    repo.delete_entry(&DeleteRecord {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: entry,
        expected_revision: 1,
        delete_linked_reports: false,
    })
    .unwrap();
    for id in [&daily, &weekly] {
        let detail = repo.get_report(id).unwrap();
        assert!(detail.report.source_deleted);
        assert!(detail.report.stale);
        assert!(detail.versions.iter().all(|v| v.source_snapshot.is_empty()));
    }
    assert!(repo
        .publish_run(&pending, ("Late response", Utc::now()))
        .is_err());
    assert!(repo
        .list_runs()
        .unwrap()
        .iter()
        .all(|r| r.source_snapshot.is_empty()));
}
#[test]
fn linked_delete_option_removes_transitive_reports_but_not_other_entries() {
    let (repo, entry, daily, weekly) = chain();
    repo.delete_entry(&DeleteRecord {
        request_id: uuid::Uuid::new_v4().to_string(),
        id: entry,
        expected_revision: 1,
        delete_linked_reports: true,
    })
    .unwrap();
    assert_eq!(repo.get_report(&daily).unwrap_err().code, "NOT_FOUND");
    assert_eq!(repo.get_report(&weekly).unwrap_err().code, "NOT_FOUND");
}
