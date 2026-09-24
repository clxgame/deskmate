use super::{AgentEndpoint, OpenCodeClient};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    thread::JoinHandle,
};

fn fixture(responses: Vec<Value>) -> (OpenCodeClient, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = OpenCodeClient::new(AgentEndpoint {
        base_url: format!("http://{}", listener.local_addr().unwrap()),
        provider_id: "provider".into(),
        model_id: "model".into(),
        workspace: PathBuf::from(r"\\?\C:\工作 目录\a&b"),
        auth_header: String::new(),
    });
    let server = std::thread::spawn(move || {
        responses.into_iter().map(|response| {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0; 4096];
            let count = stream.read(&mut chunk).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&chunk[..count]);
            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]);
                let length = headers.lines().find_map(|line| line.to_ascii_lowercase()
                    .strip_prefix("content-length:").and_then(|value| value.trim().parse::<usize>().ok())).unwrap_or(0);
                if bytes.len() >= end + 4 + length { break; }
            }
        }
        let body = response.to_string();
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        String::from_utf8(bytes).unwrap()
    }).collect()
    });
    (client, server)
}

fn message(parts: Vec<Value>) -> Value {
    json!({"info":{"id":"assistant", "role":"assistant", "parentID":"run", "time":{"created":1}}, "parts":parts})
}

fn tool(id: &str, status: &str) -> Value {
    json!({"id":id,"sessionID":"session","messageID":"assistant","type":"tool","callID":format!("call-{id}"),"tool":"bash","state":{"status":status,"input":{"command":"Get-Location"},"time":{"start":1},"error":"interrupted"}})
}

#[test]
fn error_output_is_visible_when_native_tool_has_error() {
    // Given a native error result.
    let (client, server) = fixture(vec![json!([message(vec![tool("part", "error")])])]);
    // When the history snapshot is read.
    let snapshot = client.snapshot("session").unwrap();
    // Then the tool error is preserved for history and UI.
    assert_eq!(
        snapshot[0].parts[0].state.as_ref().unwrap().output,
        "interrupted"
    );
    server.join().unwrap();
}

#[test]
fn settles_each_orphan_once_when_abort_confirms_idle() {
    // Given pending/running tools from this run, terminal tools, and another run.
    let parts = vec![
        tool("pending", "pending"),
        tool("running", "running"),
        tool("done", "completed"),
        tool("failed", "error"),
    ];
    let mut other = message(vec![tool("other", "running")]);
    other["info"]["parentID"] = json!("another-run");
    let before = json!([message(parts.clone()), other]);
    let settled = json!([message(vec![
        tool("pending", "error"),
        tool("running", "error"),
        parts[2].clone(),
        parts[3].clone()
    ])]);
    let (client, server) = fixture(vec![
        json!(true),
        json!({}),
        before,
        json!({}),
        json!({}),
        settled.clone(),
        json!(true),
        json!({}),
        settled.clone(),
        settled,
    ]);
    // When settlement is repeated after the first successful write.
    let first = client
        .settle_tools("session", "run", "interrupted")
        .unwrap();
    let second = client
        .settle_tools("session", "run", "interrupted")
        .unwrap();
    let requests = server.join().unwrap();
    // Then every accepted orphan has one terminal write and stable identity/input.
    assert_eq!(first[0].parts.len(), second[0].parts.len());
    let patches: Vec<_> = requests
        .iter()
        .filter(|request| request.starts_with("PATCH "))
        .collect();
    assert_eq!(patches.len(), 2);
    for (patch, original) in patches.iter().zip(parts.iter()) {
        let payload: Value = serde_json::from_str(patch.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(payload["id"], original["id"]);
        assert_eq!(payload["callID"], original["callID"]);
        assert_eq!(payload["state"]["input"], original["state"]["input"]);
        assert_eq!(payload["state"]["status"], "error");
        assert_eq!(payload["state"]["error"], "interrupted");
        assert!(payload["state"]["time"]["end"].as_i64().unwrap() >= 1);
    }
    for request in requests {
        let path = request.split_whitespace().nth(1).unwrap();
        let url = url::Url::parse(&format!("http://localhost{path}")).unwrap();
        assert_eq!(
            url.query_pairs().collect::<Vec<_>>(),
            vec![("directory".into(), r"C:\工作 目录\a&b".into())]
        );
    }
}

#[test]
fn skips_patch_when_native_abort_already_settled_the_tool() {
    // Given a native terminal result produced during abort.
    let snapshot = json!([message(vec![tool("part", "error")])]);
    let (client, server) = fixture(vec![json!(true), json!({}), snapshot.clone(), snapshot]);
    // When settling the stopped run.
    let result = client.settle_tools("session", "run", "cancelled").unwrap();
    // Then the original native result survives without any PATCH.
    assert_eq!(
        result[0].parts[0].state.as_ref().unwrap().output,
        "interrupted"
    );
    assert!(server
        .join()
        .unwrap()
        .iter()
        .all(|request| !request.starts_with("PATCH ")));
}

#[test]
fn refuses_settlement_when_abort_is_unconfirmed() {
    // Given an abort that did not confirm cancellation.
    let (client, server) = fixture(vec![json!(false)]);
    // When settlement is requested.
    let result = client.settle_tools("session", "run", "cancelled");
    // Then no snapshot is mutated while execution may remain active.
    assert_eq!(result.unwrap_err(), "agent_abort_unconfirmed");
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn refuses_settlement_when_aborted_session_remains_busy_or_retrying() {
    for status in ["busy", "retry"] {
        // Given a session still active after abort.
        let (client, server) = fixture(vec![json!(true), json!({"session":{"type":status}})]);
        // When settlement is requested.
        let result = client.settle_tools("session", "run", "cancelled");
        // Then late execution cannot race a synthetic tool result.
        assert_eq!(result.unwrap_err(), "agent_abort_still_running");
        assert_eq!(server.join().unwrap().len(), 2);
    }
}

#[test]
fn confirms_abort_only_after_native_status_is_idle() {
    // Given an accepted abort followed by an idle status.
    let (client, server) = fixture(vec![json!(true), json!({})]);
    // When the shared cancellation gate verifies the session.
    let result = client.abort_confirmed("session");
    // Then cancellation succeeds only after both native requests complete.
    assert_eq!(result, Ok(()));
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn confirmed_abort_rejects_stale_permission_and_question_requests() {
    let (client, server) = fixture(vec![
        json!(true),
        json!({}),
        json!([{"id":"permission_one","sessionID":"session"}]),
        json!(true),
        json!([]),
        json!([{"id":"question_one","sessionID":"session"}]),
        json!(true),
        json!([]),
        json!({}),
    ]);
    assert_eq!(client.abort_with_interaction_cleanup("session"), Ok(()));
    let requests = server.join().unwrap();
    assert!(requests[3].starts_with("POST /permission/permission_one/reply?"));
    assert!(requests[6].starts_with("POST /question/question_one/reject?"));
}

#[test]
fn rejects_verified_abort_when_native_status_remains_active() {
    for status in ["busy", "retry"] {
        // Given an accepted abort whose session remains active.
        let (client, server) = fixture(vec![json!(true), json!({"session":{"type":status}})]);
        // When the shared cancellation gate verifies the session.
        let result = client.abort_confirmed("session");
        // Then the caller receives no false stop confirmation.
        assert_eq!(result.unwrap_err(), "agent_abort_still_running");
        assert_eq!(server.join().unwrap().len(), 2);
    }
}

#[test]
fn busy_expired_or_cancelled_tools_require_host_isolation_before_finishing() {
    use crate::agent::{record_store::RunStore, AgentRunState, RunOutcome};
    for cancelled in [false, true] {
        let root = std::env::temp_dir().join(format!("agent-supervision-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let state = AgentRunState::new(RunStore::new(root.join("runs")));
        state.begin("run", &root, "test").unwrap();
        state.bind_session("run", "session").unwrap();
        state.confirm_submission("run").unwrap();
        if cancelled {
            state
                .request_finish("run", RunOutcome::Cancelled, None)
                .unwrap();
        }
        let (client, server) = fixture(vec![
            json!([message(vec![tool("part", "running")])]),
            json!({"session":{"type":"busy"}}),
        ]);
        let error = crate::agent::supervision::snapshot(
            &client,
            &state,
            &state.active_record("run").unwrap(),
        )
        .unwrap_err();
        assert_eq!(
            error,
            if cancelled {
                "agent_tools_unsettled"
            } else {
                "agent_tool_timeout"
            }
        );
        assert!(state.read().unwrap().active.is_some());
        assert!(server
            .join()
            .unwrap()
            .iter()
            .all(|request| request.starts_with("GET ")));
        std::fs::remove_dir_all(root).unwrap();
    }
}
