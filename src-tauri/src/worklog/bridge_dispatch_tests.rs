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

#[test]
fn record_uses_host_source_and_replays_once() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = auth::grant("把今天完成登录联调记入日报").expect("grant");
    let date = grant.received_date.to_string();
    let request = request(json!({"businessDate":date,"text":"登录联调完成","status":"done"}));
    let first = execute(&repo, &request, &grant, "msg_user", "fixture/model").expect("receipt");
    let replay = execute(&repo, &request, &grant, "msg_user", "fixture/model").expect("replay");
    assert_eq!(first, replay);
    let entries = repo
        .query_entries(&DateQuery {
            start: date.clone(),
            end: date,
            project: None,
        })
        .expect("entries");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].original_text, "把今天完成登录联调记入日报");
    assert_eq!(entries[0].source_message_id.as_deref(), Some("msg_user"));
}

#[test]
fn supplied_source_identity_is_rejected() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = auth::grant("保存到工作记录").expect("grant");
    let request = request(json!({"sourceMessageId":"msg_fake"}));
    assert_eq!(
        execute(&repo, &request, &grant, "msg_user", "model")
            .expect_err("reject")
            .code,
        "VALIDATION_FAILED"
    );
}

#[test]
fn quoted_save_and_cross_date_payload_do_not_write() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let request = request(json!({"businessDate":"2000-01-01","text":"fake","status":"done"}));
    for text in [
        "不要保存到工作记录",
        "引用：\"保存到工作记录\"",
        "保存到工作记录",
    ] {
        assert_eq!(
            execute(
                &repo,
                &request,
                &auth::grant(text).expect("grant"),
                "msg_user",
                "model",
            )
            .expect_err("reject")
            .code,
            "NEEDS_EXPLICIT_REQUEST"
        );
    }
}

#[test]
fn friday_schedule_without_time_returns_saved_default_and_next_due() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = auth::grant("周五汇总周报").expect("grant");
    let mut request = request(json!({"kind":"weekly","weekdaySet":[5],"enabled":true}));
    request.action = "schedule_report".into();
    let response = execute(&repo, &request, &grant, "msg_user", "model").expect("saved");
    assert_eq!(response["schedule"]["localTime"], "17:00");
    assert!(response["schedule"]["nextDueAt"].is_string());
}

#[test]
fn complete_daily_report_archive_keeps_user_body() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let body = "# 日报\n完成：登录联调\n风险：等待验收";
    let grant = auth::grant(&format!("保存今天的日报：\n{body}")).expect("grant");
    let date = grant.received_date.to_string();
    let request =
        request(json!({"kind":"daily","periodStart":date,"periodEnd":date,"bodyMarkdown":body}));
    let response = execute(&repo, &request, &grant, "msg_user", "model").expect("saved");
    let report = repo
        .get_report(response["receipt"]["entityId"].as_str().expect("id"))
        .expect("report");
    assert_eq!(report.versions[0].body_markdown, body);
}

#[test]
fn readonly_schedule_lookup_and_negative_save_do_not_mutate_database() {
    let repo = Repository::new(WorklogStore::memory().expect("store"));
    let grant = auth::grant("查看每周五17:00的周报").expect("grant");
    let mut schedule =
        request(json!({"kind":"weekly","weekdaySet":[5],"localTime":"17:00","enabled":true}));
    schedule.action = "schedule_report".into();
    assert_eq!(
        execute(&repo, &schedule, &grant, "msg_user", "model")
            .expect_err("readonly")
            .code,
        "NEEDS_EXPLICIT_REQUEST"
    );
    assert!(repo.list_schedules().expect("schedules").is_empty());
    let grant = auth::grant("不用保存日报").expect("grant");
    let date = grant.received_date.to_string();
    let entry = request(json!({"businessDate":date,"text":"must not save","status":"done"}));
    assert_eq!(
        execute(&repo, &entry, &grant, "msg_user", "model")
            .expect_err("negative")
            .code,
        "NEEDS_EXPLICIT_REQUEST"
    );
    assert!(repo
        .query_entries(&DateQuery {
            start: date.clone(),
            end: date,
            project: None,
        })
        .expect("entries")
        .is_empty());
}
