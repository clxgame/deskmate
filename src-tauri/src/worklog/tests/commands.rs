use super::*;
#[test]
fn disabled_state_returns_explicit_error() {
    let state = WorklogState(Mutex::new(None));
    assert_eq!(
        state
            .with_repository(|repo| repo.list_runs())
            .unwrap_err()
            .code,
        "WORKLOG_DISABLED"
    );
}
#[test]
fn state_service_preserves_committed_result() {
    let state = WorklogState(Mutex::new(Some(Arc::new(Repository::new(
        WorklogStore::memory().unwrap(),
    )))));
    let request = SaveReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Daily,
        period_start: "2026-09-07".into(),
        period_end: "2026-09-07".into(),
        expected_revision: None,
        body_markdown: "Original complete daily notes".into(),
    };
    let saved = state
        .with_repository(|repo| repo.save_report(&request))
        .unwrap();
    assert_eq!(
        state
            .with_repository(|repo| repo.operation(&request.request_id))
            .unwrap()
            .unwrap()
            .entity_id,
        saved.entity_id
    );
    assert_eq!(
        state
            .with_repository(|repo| repo.get_report(&saved.entity_id))
            .unwrap()
            .versions[0]
            .body_markdown,
        request.body_markdown
    );
}
