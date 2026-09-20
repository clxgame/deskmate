use super::{
    collector::{collect_once_with, CollectorActions},
    lifecycle::AgentRunState,
    permissions::AgentPermissionState,
    record_store::{NativeMessage, RunRecord, RunStore},
    test_support::{Checked, TestResult},
};
use crate::tool_permissions::runtime::{PermissionRequest, Reply};
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
        .restore_permission_ownership(&permissions, &[])
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
fn recovered_terminal_agent_sessions_remain_excluded_from_legacy_permissions() -> TestResult<()> {
    let (root, _, store) = persisted_active()?;
    let state = AgentRunState::load(store.clone())?;
    state.fail_active("msg_recovered", "done")?;
    let recovered = AgentRunState::load(store)?;
    let permissions = AgentPermissionState::default();
    recovered.restore_permission_ownership(&permissions, &[])?;
    assert_eq!(
        permissions.reject_legacy_session("ses_recovered"),
        Err("permission_agent_session_scoped".to_owned())
    );
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn invalid_recovered_workspace_is_interrupted_but_session_stays_blocked() -> TestResult<()> {
    let (root, workspace, store) = persisted_active()?;
    fs::remove_dir_all(workspace).checked("remove recovered workspace")?;
    let recovered = AgentRunState::load(store).checked("load invalid active run")?;
    let permissions = AgentPermissionState::default();
    recovered
        .restore_permission_ownership(&permissions, &[])
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
fn recovered_preparation_stays_idle_and_can_be_cancelled_for_retry() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!(
        "yume-agent-recovered-preparation-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace)?;
    let store = RunStore::new(root.join("agent-runs"));
    let state = AgentRunState::new(store.clone());
    state.begin("msg_preparing", &workspace, "retryable input")?;

    let recovered = AgentRunState::load(store)?;
    let permissions = AgentPermissionState::default();
    recovered.restore_permission_ownership(&permissions, &[])?;
    let active = recovered
        .read()?
        .active
        .checked("preparation remains active")?;
    assert_eq!(active.initial_input.as_deref(), Some("retryable input"));
    assert!(active.session_id.is_none());

    collect_once_with(
        &recovered,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| panic!("preparation fetched a snapshot"),
            pending: |_: &RunRecord| panic!("preparation fetched permissions"),
            archive: |_: &RunRecord, _: &[NativeMessage]| panic!("preparation archived"),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| panic!("preparation replied"),
        },
    )?;

    recovered.cancel_preparation("msg_preparing")?;
    recovered.begin("msg_retry", &workspace, "retryable input")?;
    assert_eq!(
        recovered.read()?.active.checked("retry started")?.run_id,
        "msg_retry"
    );
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn snapshot_transport_failure_keeps_run_active_for_retry() -> TestResult<()> {
    let (root, workspace, store) = persisted_active()?;
    let state = AgentRunState::load(store).checked("load active run")?;
    let permissions = AgentPermissionState::default();
    state
        .restore_permission_ownership(&permissions, &[])
        .checked("restore ownership")?;

    let result = collect_once_with(
        &state,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Err("agent_transport_failure".to_owned()),
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    );
    assert_eq!(result, Err("agent_read_failed".to_owned()));
    let listing = state.read().checked("read retryable snapshot")?;
    assert_eq!(
        listing
            .active
            .as_ref()
            .checked("active after transient failure")?
            .error_summary
            .as_deref(),
        Some("agent_read_failed")
    );
    assert_eq!(
        state.begin("msg_after_failure", &workspace, "new input"),
        Err("agent_run_busy".to_owned())
    );
    fs::remove_dir_all(root).checked("remove snapshot fixture")?;
    Ok(())
}
