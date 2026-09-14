use super::*;
use crate::worklog::{bridge::auth, storage::WorklogStore};

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

fn conditional_entry() -> Request {
    request(
        json!({"mode":"if_missing","businessDate":"2026-09-09","text":"完成登录联调","status":"done"}),
    )
}

fn conditional_query() -> Request {
    query_request(json!({"start":"2026-09-09","end":"2026-09-09"}))
}

#[test]
fn semantic_query_accepts_context_dates_without_a_keyword_or_date_in_current_text() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    for text in ["看一下，可能没记过", "你瞅瞅", "核实下之前那件事"] {
        let grant = fixed_query_grant(text);
        let result = execute(
            &repo,
            &query_request(json!({"start":"2026-09-08"})),
            &grant,
            "msg_user",
            "model",
        )
        .expect("semantic query");
        assert_eq!(result, json!({"entries":[],"reports":[]}));
    }
}

#[test]
fn semantic_direct_record_uses_explicit_mode_and_preserves_host_source() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("把刚才那件事记下来");
    let request = request(
        json!({"mode":"direct","businessDate":"2026-09-08","text":"合成任务：完成登录联调","status":"done"}),
    );
    let result = execute(&repo, &request, &grant, "msg_user", "model").expect("direct record");
    assert_eq!(result["receipt"]["status"], "committed");
    let entries = repo
        .query_entries(&DateQuery {
            start: "2026-09-08".into(),
            end: "2026-09-08".into(),
            project: None,
        })
        .expect("readback");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].original_text, "把刚才那件事记下来");
}

#[test]
fn record_modes_cannot_bypass_a_failed_query_or_use_a_receipt_lookup_to_clear_it() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("没有的话补上");
    assert!(execute(
        &repo,
        &query_request(json!({"start":"invalid"})),
        &grant,
        "msg_user",
        "model"
    )
    .is_err());
    execute(
        &repo,
        &query_request(json!({"operationId":uuid::Uuid::new_v4().to_string()})),
        &grant,
        "msg_user",
        "model",
    )
    .expect("receipt lookup");
    for mode in ["direct", "if_missing"] {
        let mut entry = conditional_entry();
        entry.args["mode"] = json!(mode);
        assert_eq!(
            execute(&repo, &entry, &grant, "msg_user", "model")
                .expect_err("failed query blocks both modes")
                .code,
            "QUERY_REQUIRED"
        );
    }
    let query = execute(&repo, &conditional_query(), &grant, "msg_user", "model")
        .expect("successful retry");
    assert_eq!(query["entries"], json!([]));
    assert_eq!(
        execute(&repo, &conditional_entry(), &grant, "msg_user", "model").expect("retry record")
            ["receipt"]["status"],
        "committed"
    );
}

#[test]
fn record_requires_a_valid_explicit_mode() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("记下来");
    for mode in [
        None,
        Some(json!("read")),
        Some(json!(true)),
        Some(Value::Null),
    ] {
        let mut args = json!({"businessDate":"2026-09-09","text":"fixture","status":"done"});
        if let Some(mode) = mode {
            args["mode"] = mode;
        }
        assert_eq!(
            execute(&repo, &request(args), &grant, "msg_user", "model")
                .expect_err("invalid mode")
                .code,
            "VALIDATION_FAILED"
        );
    }
    assert_eq!(
        execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("readback")
            ["entries"],
        json!([])
    );
}

#[test]
fn failed_receipt_lookup_blocks_later_writes() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("查一下再记");
    execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("first query");
    repo.store
        .with_connection(|db| {
            db.execute_batch("ALTER TABLE worklog_operations RENAME TO unavailable_operations")?;
            Ok(())
        })
        .expect("inject failure");
    assert!(execute(
        &repo,
        &query_request(json!({"operationId":uuid::Uuid::new_v4().to_string()})),
        &grant,
        "msg_user",
        "model"
    )
    .is_err());
    repo.store
        .with_connection(|db| {
            db.execute_batch("ALTER TABLE unavailable_operations RENAME TO worklog_operations")?;
            Ok(())
        })
        .expect("restore");
    let mut entry = conditional_entry();
    entry.args["mode"] = json!("direct");
    assert_eq!(
        execute(&repo, &entry, &grant, "msg_user", "model")
            .expect_err("lookup failure")
            .code,
        "QUERY_REQUIRED"
    );
}

#[test]
fn failed_conditional_recheck_blocks_switching_to_direct_record() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("没有就帮我补上");
    execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("first query");
    repo.store
        .with_connection(|db| {
            db.execute_batch("ALTER TABLE reports RENAME TO unavailable_reports")?;
            Ok(())
        })
        .expect("inject failure");
    assert!(execute(&repo, &conditional_entry(), &grant, "msg_user", "model").is_err());
    repo.store
        .with_connection(|db| {
            db.execute_batch("ALTER TABLE unavailable_reports RENAME TO reports")?;
            Ok(())
        })
        .expect("restore");
    let mut entry = conditional_entry();
    entry.args["mode"] = json!("direct");
    assert_eq!(
        execute(&repo, &entry, &grant, "msg_user", "model")
            .expect_err("recheck failed")
            .code,
        "QUERY_REQUIRED"
    );
}

#[test]
fn conditional_record_adds_missing_work_after_successful_query() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("我应该是记过了，你看看，没记过就记一下");
    let query = execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("query");
    assert_eq!(query, json!({"entries":[],"reports":[]}));
    let result = execute(&repo, &conditional_entry(), &grant, "msg_user", "model").expect("record");
    assert_eq!(result["receipt"]["status"], "committed");
    let result =
        execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("readback");
    assert_eq!(result["entries"].as_array().expect("entries").len(), 1);
    assert_eq!(result["entries"][0]["text"], "完成登录联调");
}

#[test]
fn conditional_record_returns_existing_entry_without_duplication() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let direct = fixed_query_grant("把今天完成登录联调记入工作日志");
    let mut seed = conditional_entry();
    seed.args["mode"] = json!("direct");
    execute(&repo, &seed, &direct, "msg_previous", "model").expect("seed");
    let grant = fixed_query_grant("我应该是记过了，你看看，没记过就记一下");
    execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("query");
    let result =
        execute(&repo, &conditional_entry(), &grant, "msg_user", "model").expect("existing");
    assert_eq!(result["alreadyRecorded"], true);
    assert!(result.get("receipt").is_none());
    let result =
        execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("readback");
    assert_eq!(result["entries"].as_array().expect("entries").len(), 1);
}

#[test]
fn conditional_record_detects_work_in_current_daily_report() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    repo.save_report(&SaveReport {
        request_id: uuid::Uuid::new_v4().to_string(),
        kind: ReportKind::Daily,
        period_start: "2026-09-09".into(),
        period_end: "2026-09-09".into(),
        expected_revision: None,
        body_markdown: "# 今日完成\n- 完成登录联调".into(),
    })
    .expect("seed daily");
    let grant = fixed_query_grant("你看看，没记过就记一下");
    execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("query");
    let result =
        execute(&repo, &conditional_entry(), &grant, "msg_user", "model").expect("existing");
    assert_eq!(result["alreadyRecorded"], true);
    let result =
        execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("readback");
    assert_eq!(result["entries"], json!([]));
}

#[test]
fn conditional_record_requires_successful_query_and_revokes_it_after_failure() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("你看看，没记过就记一下");
    assert_eq!(
        execute(&repo, &conditional_entry(), &grant, "msg_user", "model")
            .expect_err("query first")
            .code,
        "QUERY_REQUIRED"
    );
    execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("first query");
    repo.store
        .with_connection(|db| {
            db.execute_batch("ALTER TABLE work_entries RENAME TO unavailable_entries")?;
            Ok(())
        })
        .expect("inject failure");
    assert!(execute(&repo, &conditional_query(), &grant, "msg_user", "model").is_err());
    repo.store
        .with_connection(|db| {
            db.execute_batch("ALTER TABLE unavailable_entries RENAME TO work_entries")?;
            Ok(())
        })
        .expect("restore table");
    assert_eq!(
        execute(&repo, &conditional_entry(), &grant, "msg_user", "model")
            .expect_err("failed query is not empty")
            .code,
        "QUERY_REQUIRED"
    );
    let result =
        execute(&repo, &conditional_query(), &grant, "msg_user", "model").expect("readback");
    assert_eq!(result["entries"], json!([]));
}

#[test]
fn conditional_record_cannot_use_project_filtered_or_wrong_date_query() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("你看看，没记过就记一下");
    execute(
        &repo,
        &query_request(json!({"start":"2026-09-09","project":"unrelated"})),
        &grant,
        "msg_user",
        "model",
    )
    .expect("filtered query");
    assert_eq!(
        execute(&repo, &conditional_entry(), &grant, "msg_user", "model")
            .expect_err("incomplete coverage")
            .code,
        "QUERY_REQUIRED"
    );
    execute(
        &repo,
        &query_request(json!({"start":"2026-09-08"})),
        &grant,
        "msg_user",
        "model",
    )
    .expect("query other date");
    assert_eq!(
        execute(&repo, &conditional_entry(), &grant, "msg_user", "model")
            .expect_err("wrong date")
            .code,
        "QUERY_REQUIRED"
    );
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
    assert!(grant.actions.is_empty());
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
fn query_rejects_an_invalid_calendar_date() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = fixed_query_grant("昨天我做了什么");
    let error = execute(
        &repo,
        &query_request(json!({"start":"2026-02-30","end":"2026-02-30"})),
        &grant,
        "msg_user",
        "model",
    )
    .expect_err("wrong date");
    assert_eq!(error.code, "VALIDATION_FAILED");
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
