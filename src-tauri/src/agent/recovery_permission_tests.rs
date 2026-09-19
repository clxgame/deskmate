use super::{
    lifecycle::AgentRunState,
    permissions::AgentPermissionState,
    record_store::RunStore,
    test_support::{Checked, TestResult},
};
use std::fs;

fn persisted_active() -> TestResult<(std::path::PathBuf, std::path::PathBuf, RunStore)> {
    let root = std::env::temp_dir().join(format!(
        "yume-agent-recovered-permission-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace).checked("create recovered workspace")?;
    let store = RunStore::new(root.join("agent-runs"));
    let state = AgentRunState::new(store.clone());
    state
        .begin("msg_recovered", &workspace, "input")
        .checked("begin persisted run")?;
    state
        .bind_session("msg_recovered", "ses_recovered")
        .checked("persist session")?;
    state
        .confirm_submission("msg_recovered")
        .checked("confirm persisted run")?;
    Ok((root, workspace, store))
}

#[test]
fn recovered_active_session_blocks_all_legacy_permission_commands() -> TestResult<()> {
    let (root, _, store) = persisted_active()?;
    let recovered = AgentRunState::load(store).checked("load active run")?;
    let permissions = AgentPermissionState::default();
    recovered
        .restore_permission_ownership(&permissions)
        .checked("restore permission ownership")?;

    for _legacy_command in ["pending", "reply", "cancel"] {
        assert_eq!(
            permissions.reject_legacy_session("ses_recovered"),
            Err("permission_agent_session_scoped".to_owned())
        );
    }
    fs::remove_dir_all(root).checked("remove recovered fixture")?;
    Ok(())
}

#[test]
fn invalid_recovered_workspace_is_interrupted_but_session_stays_blocked() -> TestResult<()> {
    let (root, workspace, store) = persisted_active()?;
    fs::remove_dir_all(workspace).checked("remove recovered workspace")?;
    let recovered = AgentRunState::load(store).checked("load invalid active run")?;
    let permissions = AgentPermissionState::default();
    recovered
        .restore_permission_ownership(&permissions)
        .checked("fail closed recovered ownership")?;

    let listing = recovered.read().checked("read interrupted run")?;
    assert!(listing.active.is_none());
    assert_eq!(
        listing.recent[0].error_summary.as_deref(),
        Some("workspace_invalid_path")
    );
    assert_eq!(
        permissions.reject_legacy_session("ses_recovered"),
        Err("permission_agent_session_scoped".to_owned())
    );
    fs::remove_dir_all(root).checked("remove invalid fixture")?;
    Ok(())
}

#[test]
fn snapshot_failure_interrupts_run_and_releases_the_active_slot() -> TestResult<()> {
    let (root, workspace, store) = persisted_active()?;
    let state = AgentRunState::load(store).checked("load active run")?;
    let permissions = AgentPermissionState::default();
    state
        .restore_permission_ownership(&permissions)
        .checked("restore ownership")?;

    super::run_commands::reconcile_read_snapshot(
        &state,
        &permissions,
        "msg_recovered",
        Err("agent_transport_failure".to_owned()),
    )
    .checked("interrupt failed snapshot")?;
    let listing = state.read().checked("read interrupted snapshot")?;
    assert!(listing.active.is_none());
    assert_eq!(
        listing.recent[0].error_summary.as_deref(),
        Some("agent_transport_failure")
    );
    state
        .begin("msg_after_failure", &workspace, "new input")
        .checked("active slot released")?;
    fs::remove_dir_all(root).checked("remove snapshot fixture")?;
    Ok(())
}
