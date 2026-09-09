use super::*;
use crate::worklog::{bridge::auth, storage::WorklogStore};
use std::collections::BTreeSet;

fn request(args: Value) -> Request {
    Request {
        version: 1,
        request_id: uuid::Uuid::new_v4().to_string(),
        session_id: "ses_fixture".into(),
        message_id: "msg_assistant".into(),
        call_id: "call_fixture".into(),
        action: "record".into(),
        args,
    }
}

fn query_request(args: Value) -> Request {
    let mut request = request(args);
    request.action = "query".into();
    request
}

fn fixed_query_grant(text: &str) -> Grant {
    let mut grant = auth::grant(text).expect("grant");
    grant.received_date = chrono::NaiveDate::from_ymd_opt(2026, 9, 9).expect("fixed date");
    grant
}

#[test]
fn query_returns_yesterday_entries_and_daily_reports_when_natural_recall_scope_matches() {
    assert_yesterday_query("昨天我做了什么");
}

#[test]
fn query_returns_yesterday_records_when_subject_precedes_date() {
    assert_yesterday_query("我昨天做了什么");
}

fn assert_yesterday_query(text: &str) {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let yesterday = "2026-09-08";
    let today = "2026-09-09";
    repo.record_entry(&RecordEntry {
        request_id: "00000000-0000-4000-8000-000000000101".into(),
        business_date: yesterday.into(),
        project: Some("deskmate".into()),
        original_text: "昨天完成工作日志召回".into(),
        text: "修复工作日志自然查询召回".into(),
        status: EntryStatus::Done,
        source_session_id: Some("ses_fixture".into()),
        source_message_id: Some("msg_user".into()),
    })
    .expect("yesterday entry");
    repo.record_entry(&RecordEntry {
        request_id: "00000000-0000-4000-8000-000000000102".into(),
        business_date: today.into(),
        project: Some("deskmate".into()),
        original_text: "今天继续验证".into(),
        text: "今天的条目不应出现在昨天查询".into(),
        status: EntryStatus::Done,
        source_session_id: Some("ses_fixture".into()),
        source_message_id: Some("msg_user".into()),
    })
    .expect("today entry");
    let body = "# 2026-09-08 日报\n\n- 完成自然召回桥接测试\n- 保留完整正文";
    repo.save_report(&SaveReport {
        request_id: "00000000-0000-4000-8000-000000000103".into(),
        kind: ReportKind::Daily,
        period_start: yesterday.into(),
        period_end: yesterday.into(),
        expected_revision: None,
        body_markdown: body.into(),
    })
    .expect("yesterday report");
    let grant = fixed_query_grant(text);
    assert_eq!(grant.actions, BTreeSet::from(["query".to_owned()]));
    let response = execute(
        &repo,
        &query_request(json!({"start":yesterday,"end":yesterday})),
        &grant,
        "msg_user",
        "model",
    )
    .expect("query");
    assert_eq!(response["entries"].as_array().expect("entries").len(), 1);
    assert_eq!(response["entries"][0]["businessDate"], yesterday);
    assert_eq!(response["entries"][0]["text"], "修复工作日志自然查询召回");
    assert_eq!(response["reports"].as_array().expect("reports").len(), 1);
    assert_eq!(response["reports"][0]["report"]["periodStart"], yesterday);
    assert_eq!(response["reports"][0]["versions"][0]["bodyMarkdown"], body);
    assert!(!response["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .any(|entry| entry["businessDate"] == today));
}

#[test]
fn query_returns_empty_collections_when_authorized_day_has_no_data() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("昨天我做了什么");
    let response = execute(
        &repo,
        &query_request(json!({"start":"2026-09-08","end":"2026-09-08"})),
        &grant,
        "msg_user",
        "model",
    )
    .expect("query");
    assert_eq!(response["entries"].as_array().expect("entries").len(), 0);
    assert_eq!(response["reports"].as_array().expect("reports").len(), 0);
}

#[test]
fn query_rejects_dates_outside_the_natural_recall_scope() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("昨天我做了什么");
    let error = execute(
        &repo,
        &query_request(json!({"start":"2026-09-07","end":"2026-09-07"})),
        &grant,
        "msg_user",
        "model",
    )
    .expect_err("wrong date");
    assert_eq!(error.code, "NEEDS_EXPLICIT_REQUEST");
    assert!(repo
        .query_entries(&DateQuery {
            start: "2026-09-07".into(),
            end: "2026-09-07".into(),
            project: None,
        })
        .expect("entries")
        .is_empty());
}

#[test]
fn query_can_read_the_authorized_operation_lookup_without_rescoping_dates() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let operation_id = "00000000-0000-4000-8000-000000000104";
    repo.record_entry(&RecordEntry {
        request_id: operation_id.into(),
        business_date: "2026-09-08".into(),
        project: None,
        original_text: "昨天完成操作查询覆盖".into(),
        text: "操作回放查询保持可用".into(),
        status: EntryStatus::Done,
        source_session_id: None,
        source_message_id: None,
    })
    .expect("entry");
    let grant = fixed_query_grant("昨天我做了什么");
    let response = execute(
        &repo,
        &query_request(json!({"operationId":operation_id})),
        &grant,
        "msg_user",
        "model",
    )
    .expect("operation");
    assert_eq!(response["operation"]["operationId"], operation_id);
    assert_eq!(response["operation"]["status"], "committed");
}
