use super::permissions::{AgentPermissionState, PendingDecision};
use super::test_support::{Checked, TestResult};
use super::{
    lifecycle::AgentRunState,
    record_store::{RunOutcome, RunStore},
};
use crate::tool_permissions::runtime::PermissionRequest;
use std::fs;

fn fixture() -> TestResult<(std::path::PathBuf, std::path::PathBuf)> {
    let root = std::env::temp_dir().join(format!("yume-agent-lifecycle-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace).checked("create lifecycle fixture")?;
    Ok((root, workspace))
}

#[test]
fn unknown_restart_marks_interrupted_and_clears_initial_input() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let store = RunStore::new(root.join("agent-runs"));
    let state = AgentRunState::new(store.clone());
    state
        .begin("msg_run", &workspace, "must not replay")
        .checked("begin")?;
    state.bind_session("msg_run", "ses_run").checked("bind")?;
    let recovered = AgentRunState::load(store).checked("load")?;
    recovered
        .interrupt_active("native_state_unknown")
        .checked("interrupt")?;
    let record = &recovered.read().checked("read")?.recent[0];
    assert_eq!(record.outcome, Some(RunOutcome::Interrupted));
    assert!(record.initial_input.is_none());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn lifecycle_registration_and_completion_clear_permission_ownership() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let runs = root.join("agent-runs");
    let unrelated = root.join("worklog.db");
    fs::write(&unrelated, b"unchanged").checked("write unrelated fixture")?;
    let state = AgentRunState::new(RunStore::new(runs));
    let permissions = AgentPermissionState::default();
    state
        .begin("msg_run", &workspace, "input")
        .checked("begin")?;
    state
        .bind_session_with("msg_run", "ses_run", || {
            permissions.register_run("msg_run", "ses_run", &workspace)
        })
        .checked("register")?;
    let request = PermissionRequest {
        id: "req_read".into(),
        session_id: "ses_run".into(),
        permission: "read".into(),
        patterns: vec![workspace.join("file.txt").to_string_lossy().into_owned()],
        metadata: serde_json::json!({}),
        tool: None,
    };
    fs::write(workspace.join("file.txt"), b"fixture").checked("write file")?;
    assert_eq!(
        permissions
            .accept("msg_run", request.clone())
            .checked("accept")?,
        PendingDecision::AllowOnce
    );
    permissions
        .cancel_run("msg_run")
        .checked("clear ownership")?;
    assert_eq!(
        permissions
            .accept("msg_run", request)
            .expect_err("expired ownership"),
        "agent_run_unknown"
    );
    assert_eq!(
        fs::read(&unrelated).checked("read unrelated")?,
        b"unchanged"
    );
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}
