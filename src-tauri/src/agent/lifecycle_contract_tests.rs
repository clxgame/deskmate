use super::test_support::{Checked, TestResult};
use super::{
    lifecycle::AgentRunState,
    record_store::{RunOutcome, RunStore},
};
use std::fs;

fn fixture() -> TestResult<(std::path::PathBuf, std::path::PathBuf)> {
    let root = std::env::temp_dir().join(format!(
        "yume-agent-lifecycle-contract-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace).checked("create lifecycle fixture")?;
    Ok((root, workspace))
}

#[test]
fn start_validates_and_persists_only_the_canonical_workspace_contract() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let store_root = root.join("agent-runs");
    let state = AgentRunState::new(RunStore::new(store_root.clone()));
    let file = root.join("not-a-directory");
    fs::write(&file, b"file").checked("write file root")?;
    assert_eq!(
        state
            .begin("msg_file", &file, "input")
            .expect_err("file rejected"),
        "workspace_not_directory"
    );
    assert_eq!(
        state
            .begin("msg_missing", &root.join("missing"), "input")
            .expect_err("missing rejected"),
        "workspace_invalid_path"
    );

    state
        .begin("msg_run", &workspace.join("."), "transient input")
        .checked("begin canonical run")?;
    state
        .bind_session("msg_run", "ses_run")
        .checked("bind session")?;
    state
        .confirm_submission("msg_run")
        .checked("confirm submission")?;
    let record = state.read().checked("read")?.active.checked("active")?;
    assert_eq!(
        record.workspace_path,
        workspace.canonicalize().checked("canonical workspace")?
    );
    let other = root.join("other");
    fs::create_dir(&other).checked("create other workspace")?;
    assert_eq!(
        state
            .begin("msg_other", &other, "replacement")
            .expect_err("busy binding immutable"),
        "agent_run_busy"
    );

    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(store_root.join("msg_run.json")).checked("read record")?)
            .checked("parse record")?;
    let object = value.as_object().checked("record object")?;
    assert!(object.get("initialInput").is_none());
    assert!(
        object.get("transcript").is_none()
            && object.get("plan").is_none()
            && object.get("steps").is_none()
    );
    assert_eq!(
        object
            .get("workspacePath")
            .and_then(serde_json::Value::as_str),
        workspace.canonicalize().checked("canonical")?.to_str()
    );
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn submission_failure_is_terminal_and_reloadable() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let store = RunStore::new(root.join("agent-runs"));
    let state = AgentRunState::new(store.clone());
    state
        .begin("msg_failed", &workspace, "transient input")
        .checked("begin")?;
    state
        .fail_active("msg_failed", "submission_failed")
        .checked("record failure")?;
    let recovered = AgentRunState::load(store)
        .checked("reload")?
        .read()
        .checked("read")?;
    assert!(recovered.active.is_none());
    assert_eq!(recovered.recent[0].outcome, Some(RunOutcome::Failed));
    assert_eq!(
        recovered.recent[0].error_summary.as_deref(),
        Some("submission_failed")
    );
    assert!(recovered.recent[0].initial_input.is_none());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn host_boundary_failure_injection_is_observable() -> TestResult<()> {
    assert_ne!(
        std::env::var("YUME_AGENT_HOST_BOUNDARY_FAIL").as_deref(),
        Ok("1"),
        "injected host-boundary failure"
    );
    Ok(())
}
