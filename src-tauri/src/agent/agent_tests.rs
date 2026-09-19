use super::test_support::{Checked, TestResult};
use super::{process_current_reply, process_pending, process_reply, AgentReply};
use crate::{
    agent::{record_store::NativeMessage, AgentPermissionState, AgentRunState, RunStore},
    tool_permissions::runtime::PermissionRequest,
};
use std::{cell::Cell, fs};

fn real_bash_request(id: &str, session_id: &str) -> TestResult<PermissionRequest> {
    Ok(serde_json::from_value(serde_json::json!({
        "id": id,
        "sessionID": session_id,
        "permission": "bash",
        "patterns": ["bun -e \"await Bun.write('command.exit','0')\""],
        "metadata": {"command": "bun -e \"await Bun.write('command.exit','0')\""},
        "tool": {"messageID": "msg_fixture", "callID": "call_bash"}
    }))
    .checked("deserialize real OpenCode permission shape")?)
}

#[test]
fn command_boundary_uses_owned_state_and_renderer_ids_only() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-command-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register host-owned run")?;
    state
        .register_run("run-b", "session-b", &root)
        .checked("register second run")?;

    let batch = process_pending(
        &state,
        "run-a",
        vec![real_bash_request("permission-a", "session-a")?],
    )
    .checked("process host-observed request")?;
    assert!(batch.automatic.is_empty());
    assert_eq!(batch.waiting.len(), 1);
    assert_eq!(batch.waiting[0].request_id, "permission-a");
    assert_eq!(
        batch.waiting[0].command.as_deref(),
        Some("bun -e \"await Bun.write('command.exit','0')\"")
    );
    assert_eq!(
        batch.waiting[0].cwd,
        root.canonicalize()
            .checked("canonical fixture")?
            .to_string_lossy()
    );
    assert!(process_reply(&state, "run-b", "permission-a", super::AgentReply::Once).is_err());
    assert!(process_reply(&state, "run-a", "permission-a", super::AgentReply::Once).is_ok());
    assert!(process_reply(&state, "run-a", "permission-a", super::AgentReply::Reject).is_err());

    let old = real_bash_request("permission-old", "session-a")?;
    process_pending(&state, "run-a", vec![old]).checked("store old request")?;
    state
        .register_run("run-a", "session-new", &root)
        .checked("replace host-owned run")?;
    assert!(process_reply(&state, "run-a", "permission-old", super::AgentReply::Once).is_err());

    let cancelled = real_bash_request("permission-cancelled", "session-new")?;
    process_pending(&state, "run-a", vec![cancelled]).checked("store pending request")?;
    state.cancel_run("run-a").checked("cancel run")?;
    assert!(process_reply(
        &state,
        "run-a",
        "permission-cancelled",
        super::AgentReply::Once
    )
    .is_err());
    assert!(process_pending(
        &state,
        "run-a",
        vec![real_bash_request("permission-stale", "session-new")?]
    )
    .is_err());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn permission_workspace_comes_from_the_active_host_run() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-workspace-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("中文 工作区");
    fs::create_dir_all(&workspace).checked("create workspace")?;
    let state = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    state
        .begin("run-owned", &workspace, "fixture")
        .checked("begin host-owned run")?;

    assert_eq!(
        state
            .active_workspace("run-owned")
            .checked("owned workspace")?,
        workspace.canonicalize().checked("canonical workspace")?
    );
    assert_eq!(
        state.active_workspace("run-renderer").unwrap_err(),
        "agent_run_unknown"
    );

    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

fn live_snapshot(run_id: &str) -> Vec<NativeMessage> {
    vec![NativeMessage {
        id: format!("assistant_{run_id}"),
        parent_id: Some(run_id.to_owned()),
        completed: false,
        finish: None,
        error: None,
        parts: Vec::new(),
    }]
}

#[test]
fn permission_reply_reconciles_terminal_run_before_remote_reply() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-stale-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("中文 工作区");
    fs::create_dir_all(&workspace).checked("create workspace")?;
    let runs = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    let permissions = AgentPermissionState::default();
    runs.begin("msg_aborted", &workspace, "fixture")
        .checked("begin aborted run")?;
    runs.bind_session_with("msg_aborted", "ses_aborted", || {
        permissions.register_run("msg_aborted", "ses_aborted", &workspace)
    })
    .checked("bind aborted run")?;
    runs.confirm_submission("msg_aborted")
        .checked("confirm aborted run")?;
    process_pending(
        &permissions,
        "msg_aborted",
        vec![real_bash_request("per_aborted", "ses_aborted")?],
    )
    .checked("queue lingering request")?;
    let replies = Cell::new(0);
    let pending_fetches = Cell::new(0);
    let error = process_current_reply(
        &runs,
        &permissions,
        "msg_aborted",
        "per_aborted",
        AgentReply::Once,
        |_| {
            Ok(vec![NativeMessage {
                id: "assistant_aborted".into(),
                parent_id: Some("msg_aborted".into()),
                completed: true,
                finish: None,
                error: Some("MessageAbortedError".into()),
                parts: Vec::new(),
            }])
        },
        |_| {
            pending_fetches.set(pending_fetches.get() + 1);
            Ok(Vec::new())
        },
        |_, _, _| {
            replies.set(replies.get() + 1);
            Ok(())
        },
    )
    .expect_err("aborted run is stale");
    assert_eq!(error, "agent_permission_stale");
    assert_eq!(pending_fetches.get(), 0);
    assert_eq!(replies.get(), 0);
    assert_eq!(
        runs.read().checked("read terminal run")?.recent[0]
            .error_summary
            .as_deref(),
        Some("MessageAbortedError")
    );
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn permission_reply_requires_current_exact_scoped_request() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-current-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("中文 工作区");
    fs::create_dir_all(&workspace).checked("create workspace")?;
    let runs = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    let permissions = AgentPermissionState::default();
    runs.begin("msg_current", &workspace, "fixture")
        .checked("begin current run")?;
    runs.bind_session_with("msg_current", "ses_current", || {
        permissions.register_run("msg_current", "ses_current", &workspace)
    })
    .checked("bind current run")?;
    runs.confirm_submission("msg_current")
        .checked("confirm current run")?;
    let current = real_bash_request("per_current", "ses_current")?;
    process_pending(&permissions, "msg_current", vec![current.clone()])
        .checked("queue current request")?;

    let replies = Cell::new(0);
    let missing = process_current_reply(
        &runs,
        &permissions,
        "msg_current",
        "per_current",
        AgentReply::Once,
        |_| Ok(live_snapshot("msg_current")),
        |_| Ok(Vec::new()),
        |_, _, _| {
            replies.set(replies.get() + 1);
            Ok(())
        },
    )
    .expect_err("missing remote request is stale");
    assert_eq!(missing, "agent_permission_stale");
    assert_eq!(replies.get(), 0);

    let mut other_session = current.clone();
    other_session.session_id = "ses_other".into();
    let mismatched = process_current_reply(
        &runs,
        &permissions,
        "msg_current",
        "per_current",
        AgentReply::Once,
        |_| Ok(live_snapshot("msg_current")),
        |_| Ok(vec![other_session]),
        |_, _, _| {
            replies.set(replies.get() + 1);
            Ok(())
        },
    )
    .expect_err("other session request is stale");
    assert_eq!(mismatched, "agent_permission_stale");
    assert_eq!(replies.get(), 0);

    process_current_reply(
        &runs,
        &permissions,
        "msg_current",
        "per_current",
        AgentReply::Once,
        |_| Ok(live_snapshot("msg_current")),
        |_| Ok(vec![current]),
        |request, _, workspace_path| {
            assert_eq!(request.id, "per_current");
            assert_eq!(request.session_id, "ses_current");
            assert_eq!(
                workspace_path,
                workspace
                    .canonicalize()
                    .map_err(|_| "canonical workspace unavailable".to_owned())?
                    .as_path()
            );
            replies.set(replies.get() + 1);
            Ok(())
        },
    )
    .checked("reply to exact live request")?;
    assert_eq!(replies.get(), 1);
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}
