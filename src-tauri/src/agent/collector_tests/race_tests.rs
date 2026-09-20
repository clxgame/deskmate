use super::{active, fixture, terminal};
use crate::{
    agent::{
        collector::{collect_once_with, CollectorActions, SnapshotRead},
        record_store::{NativeMessage, RunOutcome, RunRecord},
        test_support::{Checked, TestResult},
        AgentRunState, RunStore,
    },
    tool_permissions::runtime::{PermissionRequest, Reply},
};
use std::fs;

#[test]
fn stale_snapshot_cannot_finish_a_newer_run() -> TestResult<()> {
    let (root, workspace) = fixture("stale")?;
    let (runs, permissions) = active(&root, &workspace)?;
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| {
                runs.fail_active("msg_run", "replaced")?;
                runs.begin("msg_new", &workspace, "new")?;
                runs.bind_session("msg_new", "ses_new")?;
                runs.confirm_submission("msg_new")?;
                Ok(SnapshotRead::Messages(terminal("msg_run")))
            },
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, _: &[NativeMessage]| panic!("stale snapshot archived"),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| {
                panic!("stale permissions replied")
            },
        },
    )?;
    assert_eq!(runs.read()?.active.checked("new active")?.run_id, "msg_new");
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn stale_finish_never_removes_the_newer_active_run() -> TestResult<()> {
    let (root, workspace) = fixture("stale-finish")?;
    let runs = AgentRunState::new(RunStore::new(root.join("runs")));
    runs.begin("msg_new", &workspace, "new")?;
    assert_eq!(
        runs.fail_active("msg_old", "stale"),
        Err("agent_run_unknown".to_owned())
    );
    assert_eq!(
        runs.read()?.active.checked("new active retained")?.run_id,
        "msg_new"
    );
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn cancellation_requested_during_snapshot_wins_without_relabeling() -> TestResult<()> {
    let (root, workspace) = fixture("cancel-race")?;
    let (runs, permissions) = active(&root, &workspace)?;
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| {
                runs.request_finish("msg_run", RunOutcome::Cancelled, None)?;
                Ok(SnapshotRead::Messages(terminal("msg_run")))
            },
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )?;
    assert_eq!(runs.read()?.recent[0].outcome, Some(RunOutcome::Cancelled));
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn pending_cancel_survives_reload_until_final_text_is_archived() -> TestResult<()> {
    let (root, workspace) = fixture("cancel-resume")?;
    let store = RunStore::new(root.join("runs"));
    {
        let runs = AgentRunState::new(store.clone());
        runs.begin("msg_run", &workspace, "input")?;
        runs.bind_session("msg_run", "ses_run")?;
        runs.confirm_submission("msg_run")?;
        runs.request_finish("msg_run", RunOutcome::Cancelled, None)?;
    }
    let recovered = AgentRunState::load(store)?;
    collect_once_with(
        &recovered,
        &crate::agent::AgentPermissionState::default(),
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(terminal("msg_run"))),
            pending: |_: &RunRecord| panic!("pending cancellation does not collect permissions"),
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )?;
    assert_eq!(
        recovered.read()?.recent[0].outcome,
        Some(RunOutcome::Cancelled)
    );
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn repeated_restart_interruption_keeps_the_exact_reason() -> TestResult<()> {
    let (root, workspace) = fixture("restart")?;
    let (runs, permissions) = active(&root, &workspace)?;
    for _ in 0..2 {
        runs.request_finish(
            "msg_run",
            RunOutcome::Interrupted,
            Some("sidecar_restarted".to_owned()),
        )?;
    }
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::SidecarLost),
            pending: |_: &RunRecord| panic!("interruption does not collect permissions"),
            archive: |_: &RunRecord, _: &[NativeMessage]| panic!("lost sidecar has no snapshot"),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )?;
    let record = &runs.read()?.recent[0];
    assert_eq!(record.outcome, Some(RunOutcome::Interrupted));
    assert_eq!(record.error_summary.as_deref(), Some("sidecar_restarted"));
    fs::remove_dir_all(root)?;
    Ok(())
}
