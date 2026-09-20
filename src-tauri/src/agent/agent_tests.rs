use super::test_support::{Checked, TestResult};
use super::{collector::cached_permissions, process_current_reply, process_reply, AgentReply};
use crate::{
    agent::{AgentPermissionState, AgentRunState, RunStore},
    tool_permissions::runtime::PermissionRequest,
};
use std::fs;

fn process_fixture_pending(
    state: &AgentPermissionState,
    run_id: &str,
    requests: Vec<PermissionRequest>,
) -> Result<Vec<(PermissionRequest, crate::tool_permissions::runtime::Reply)>, String> {
    super::process_pending(
        state,
        run_id,
        &["msg_fixture".to_owned()],
        &["call_bash".to_owned()],
        requests,
    )
}

fn real_bash_request(id: &str, session_id: &str) -> TestResult<PermissionRequest> {
    Ok(serde_json::from_value(serde_json::json!({
        "id": id,
        "sessionID": session_id,
        "permission": "bash",
        "patterns": ["bun -e \"await Bun.write('command.exit','0')\""],
        "always": ["bun *"],
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

    let batch = process_fixture_pending(
        &state,
        "run-a",
        vec![real_bash_request("permission-a", "session-a")?],
    )
    .checked("process host-observed request")?;
    assert!(batch.is_empty());
    let waiting = cached_permissions(&state, "run-a")?;
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].request_id, "permission-a");
    assert_eq!(waiting[0].always, vec!["bun *"]);
    assert_eq!(
        waiting[0].command.as_deref(),
        Some("bun -e \"await Bun.write('command.exit','0')\"")
    );
    assert_eq!(
        waiting[0].cwd,
        root.canonicalize()
            .checked("canonical fixture")?
            .to_string_lossy()
    );
    assert!(process_reply(&state, "run-b", "permission-a", super::AgentReply::Once).is_err());
    assert!(process_reply(&state, "run-a", "permission-a", super::AgentReply::Once).is_ok());
    assert!(process_reply(&state, "run-a", "permission-a", super::AgentReply::Reject).is_err());

    process_fixture_pending(
        &state,
        "run-a",
        vec![real_bash_request("permission-always", "session-a")?],
    )?;
    assert_eq!(
        process_reply(
            &state,
            "run-a",
            "permission-always",
            super::AgentReply::Always,
        )?
        .1,
        AgentReply::Always
    );

    let old = real_bash_request("permission-old", "session-a")?;
    process_fixture_pending(&state, "run-a", vec![old]).checked("store old request")?;
    state
        .register_run("run-a", "session-new", &root)
        .checked("replace host-owned run")?;
    assert!(process_reply(&state, "run-a", "permission-old", super::AgentReply::Once).is_err());

    let cancelled = real_bash_request("permission-cancelled", "session-new")?;
    process_fixture_pending(&state, "run-a", vec![cancelled]).checked("store pending request")?;
    state.cancel_run("run-a").checked("cancel run")?;
    assert!(process_reply(
        &state,
        "run-a",
        "permission-cancelled",
        super::AgentReply::Once
    )
    .is_err());
    assert!(process_fixture_pending(
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

#[test]
fn permission_reply_rejects_a_run_terminalized_by_collection() -> TestResult<()> {
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
    process_fixture_pending(
        &permissions,
        "msg_aborted",
        vec![real_bash_request("per_aborted", "ses_aborted")?],
    )
    .checked("queue lingering request")?;
    runs.reconcile(
        "msg_aborted",
        &[crate::agent::record_store::NativeMessage {
            role: None,
            created: None,
            id: "assistant_aborted".into(),
            parent_id: Some("msg_aborted".into()),
            completed: true,
            finish: None,
            error: Some("MessageAbortedError".into()),
            parts: Vec::new(),
        }],
    )?;
    let error = process_current_reply(
        &runs,
        &permissions,
        "msg_aborted",
        "per_aborted",
        AgentReply::Once,
    )
    .err()
    .checked("aborted run is stale")?;
    assert_eq!(error, "agent_permission_stale");
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
    runs.reconcile(
        "msg_current",
        &[crate::agent::record_store::NativeMessage {
            role: Some("assistant".into()),
            created: Some(1),
            id: "msg_fixture".into(),
            parent_id: Some("msg_current".into()),
            completed: false,
            finish: None,
            error: None,
            parts: vec![crate::agent::record_store::NativePart {
                id: "part_bash".into(),
                kind: Some("tool".into()),
                text: None,
                call_id: Some("call_bash".into()),
                tool: Some("bash".into()),
                state: None,
            }],
        }],
    )?;
    let current = real_bash_request("per_current", "ses_current")?;
    process_fixture_pending(&permissions, "msg_current", vec![current.clone()])
        .checked("queue current request")?;

    let (request, _, workspace_path) = process_current_reply(
        &runs,
        &permissions,
        "msg_current",
        "per_current",
        AgentReply::Once,
    )?;
    assert_eq!(request.id, current.id);
    assert_eq!(request.session_id, current.session_id);
    assert_eq!(workspace_path, workspace.canonicalize()?);
    assert_eq!(
        process_current_reply(
            &runs,
            &permissions,
            "msg_current",
            "per_current",
            AgentReply::Once,
        )
        .err()
        .checked("repeated reply is stale")?,
        "agent_permission_stale"
    );
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}
