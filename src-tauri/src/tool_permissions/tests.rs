use super::runtime::{pending_scoped, reply_current, resolve_pending, respond_scoped, Reply};
use super::{Mode, ToolPermissions};
use crate::agent::AgentPermissionState;
use serde_json::json;
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
};

fn engine(responses: Vec<serde_json::Value>) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fixture");
    let base = format!("http://{}", listener.local_addr().expect("address"));
    let thread = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for response in responses {
            let (mut stream, _) = listener.accept().expect("accept");
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .expect("timeout");
            let mut reader = BufReader::new(stream.try_clone().expect("clone"));
            let mut request = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("header");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().expect("length");
                }
                request.push_str(&line);
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).expect("body");
            request.push_str(&String::from_utf8(body).expect("utf8"));
            requests.push(request);
            let body = response.to_string();
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).expect("response");
        }
        requests
    });
    (base, thread)
}
fn request(id: &str, tool: &str, session: &str) -> serde_json::Value {
    json!({"id":id,"sessionID":session,"permission":tool,"patterns":["example"],"metadata":{"command":"echo fixture"}})
}
#[test]
fn old_settings_receive_safe_defaults_and_invalid_modes_are_rejected() {
    let old: crate::settings::Settings =
        serde_json::from_value(json!({"yolo":true})).expect("old settings");
    assert_eq!(old.tool_permissions, ToolPermissions::default());
    assert_eq!(old.tool_permissions.shell, Mode::Ask);
    assert!(serde_json::from_value::<ToolPermissions>(json!({"shell":"always"})).is_err());
    let policy = ToolPermissions {
        worklog_read: Mode::Deny,
        ..Default::default()
    };
    assert_eq!(
        serde_json::from_str::<ToolPermissions>(
            &serde_json::to_string(&policy).expect("serialize")
        )
        .expect("deserialize"),
        policy
    );
}
#[test]
fn policy_covers_only_supported_tools() {
    let policy = ToolPermissions::default();
    for tool in [
        "worklog_record",
        "worklog_update",
        "worklog_generate_report",
        "worklog_schedule_report",
    ] {
        assert_eq!(policy.mode(tool), Mode::Allow);
    }
    assert_eq!(policy.mode("webfetch"), Mode::Allow);
    assert_eq!(policy.mode("websearch"), Mode::Allow);
    for tool in ["write", "external_directory", "unknown", "worklog_delete"] {
        assert_eq!(policy.mode(tool), Mode::Deny);
    }
}
#[test]
fn auto_allow_and_deny_reply_once_while_ask_remains_pending() {
    let (base, server) = engine(vec![
        json!([
            request("p1", "worklog_query", "ses_a"),
            request("p2", "webfetch", "ses_a"),
            request("p3", "websearch", "ses_a"),
            request("p4", "bash", "ses_a"),
            request("p5", "worklog_query", "ses_other")
        ]),
        json!(true),
        json!(true),
        json!(true),
    ]);
    let waiting = resolve_pending(
        &base,
        "ses_a",
        &ToolPermissions {
            web: Mode::Deny,
            ..Default::default()
        },
    )
    .expect("resolve");
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].id, "p4");
    let calls = server.join().expect("fixture finished");
    assert!(calls[1].starts_with("POST /permission/p1/reply"));
    assert!(calls[1].contains("\"reply\":\"once\""));
    assert!(calls[2].contains("\"reply\":\"reject\""));
    assert!(calls[3].contains("\"reply\":\"reject\""));
}
#[test]
fn changed_deny_policy_overrides_a_late_allow_click() {
    let (base, server) = engine(vec![json!([request("p1", "bash", "ses_a")]), json!(true)]);
    reply_current(
        &base,
        "ses_a",
        "p1",
        Reply::Once,
        &ToolPermissions {
            shell: Mode::Deny,
            ..Default::default()
        },
    )
    .expect("reject stale allow");
    assert!(server.join().expect("finished")[1].contains("\"reply\":\"reject\""));
}
#[test]
fn approval_cannot_target_another_session_or_expired_request() {
    for (session, id) in [("ses_other", "p1"), ("ses_a", "gone")] {
        let (base, server) = engine(vec![json!([request("p1", "bash", "ses_a")])]);
        assert_eq!(
            reply_current(&base, session, id, Reply::Once, &ToolPermissions::default())
                .expect_err("reject"),
            "permission_expired"
        );
        assert_eq!(server.join().expect("finished").len(), 1);
    }
}
#[test]
fn allow_once_and_cancel_use_only_the_selected_request() {
    for (reply, expected) in [(Reply::Once, "once"), (Reply::Reject, "reject")] {
        let (base, server) = engine(vec![json!([request("p1", "bash", "ses_a")]), json!(true)]);
        reply_current(&base, "ses_a", "p1", reply, &ToolPermissions::default()).expect("reply");
        let calls = server.join().expect("finished");
        assert!(calls[1].contains(&format!("\"reply\":\"{expected}\"")));
    }
}

#[test]
fn agent_permission_requests_use_the_exact_workspace_query_while_legacy_stays_unscoped() {
    let (base, server) = engine(vec![
        json!([request("p1", "read", "ses_a")]),
        json!(true),
        json!([]),
    ]);
    let workspace = std::path::Path::new(r"\\?\E:\中文 工作区\保留#?&%");
    let pending = pending_scoped(&base, workspace).expect("scoped pending");
    assert_eq!(pending.len(), 1);
    respond_scoped(&base, &pending[0], Reply::Once, workspace).expect("scoped reply");
    assert!(resolve_pending(&base, "ses_a", &ToolPermissions::default())
        .expect("legacy pending")
        .is_empty());

    let calls = server.join().expect("fixture finished");
    for call in &calls[..2] {
        let target = call.split_whitespace().nth(1).expect("request target");
        let url =
            url::Url::parse(&format!("http://127.0.0.1{target}")).expect("scoped request URL");
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "directory")
                .map(|(_, value)| value.into_owned()),
            Some(r"E:\中文 工作区\保留#?&%".to_owned())
        );
    }
    assert!(calls[1].starts_with("POST /permission/p1/reply?"));
    assert!(calls[2].starts_with("GET /permission HTTP/1.1"));
}

#[test]
fn legacy_permission_commands_reject_agent_owned_scheduled_sessions() {
    let root = std::env::temp_dir().join(format!(
        "yume-agent-legacy-permission-{}",
        uuid::Uuid::new_v4()
    ));
    assert!(std::fs::create_dir_all(&root).is_ok());
    let permissions = AgentPermissionState::default();
    assert!(permissions
        .register_run("msg_schedule_fixture", "ses_schedule_fixture", &root)
        .is_ok());
    assert_eq!(
        permissions.reject_legacy_session("ses_schedule_fixture"),
        Err("permission_agent_session_scoped".to_owned())
    );
    assert!(std::fs::remove_dir_all(root).is_ok());
}
