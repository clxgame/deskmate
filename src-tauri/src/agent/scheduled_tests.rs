use super::scheduled::{run_id, submit_with, ScheduledAdmission};
use crate::agent::{
    record_store::RunStore,
    test_support::{Checked, TestResult},
    AgentPermissionState, AgentRunState,
};
use std::fs;

fn fixture() -> TestResult<(std::path::PathBuf, std::path::PathBuf)> {
    let root = std::env::temp_dir().join(format!("yume-agent-schedule-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("private-scheduled-workspace");
    fs::create_dir_all(&workspace).checked("create scheduled fixture")?;
    Ok((root, workspace))
}

#[test]
fn occurrence_identity_is_stable_and_task_scoped() {
    assert_eq!(
        run_id("a", "2026-09-17 09:00"),
        run_id("a", "2026-09-17 09:00")
    );
    assert_ne!(
        run_id("a", "2026-09-17 09:00"),
        run_id("b", "2026-09-17 09:00")
    );
}

#[test]
fn busy_occurrence_records_one_terminal_receipt_and_never_queues() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let state = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    state
        .begin("msg_interactive", &workspace, "interactive")
        .checked("begin interactive")?;
    assert!(matches!(
        state.begin_scheduled("msg_schedule_due", &workspace, "remind"),
        Ok(ScheduledAdmission::BusyReceipt)
    ));
    assert!(matches!(
        state.begin_scheduled("msg_schedule_due", &workspace, "remind"),
        Ok(ScheduledAdmission::Duplicate)
    ));
    let listing = state.read().checked("read receipts")?;
    assert_eq!(
        listing.active.checked("interactive remains")?.run_id,
        "msg_interactive"
    );
    assert_eq!(listing.recent.len(), 1);
    assert_eq!(
        listing.recent[0].error_summary.as_deref(),
        Some("scheduled_agent_busy")
    );
    fs::remove_dir_all(root).checked("remove scheduled fixture")?;
    Ok(())
}

#[test]
fn scheduled_failure_is_terminal_and_private_workspace_is_immutable() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let state = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    assert!(matches!(
        state.begin_scheduled("msg_schedule_due", &workspace, "remind"),
        Ok(ScheduledAdmission::Started)
    ));
    state
        .fail_active("msg_schedule_due", "sidecar_not_ready")
        .checked("record failure")?;
    let listing = state.read().checked("read failed receipt")?;
    assert!(listing.active.is_none());
    assert_eq!(
        listing.recent[0].workspace_path,
        workspace.canonicalize().checked("canonical workspace")?
    );
    assert_eq!(
        listing.recent[0].error_summary.as_deref(),
        Some("sidecar_not_ready")
    );
    assert!(matches!(
        state.begin_scheduled("msg_schedule_due", &workspace, "remind"),
        Ok(ScheduledAdmission::Duplicate)
    ));
    fs::remove_dir_all(root).checked("remove scheduled fixture")?;
    Ok(())
}

#[test]
fn host_submission_runs_once_without_a_chat_observer() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let state = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    let permissions = AgentPermissionState::default();
    let calls = std::cell::Cell::new(0_u8);
    let admission = submit_with(
        &state,
        "msg_schedule_direct",
        &workspace,
        "remind",
        |state, id| {
            calls.set(calls.get() + 1);
            state.bind_session_with(id, "ses_schedule", || {
                permissions.register_run(id, "ses_schedule", &workspace)
            })?;
            state.confirm_submission(id)
        },
    )
    .checked("submit directly")?;
    assert!(matches!(admission, ScheduledAdmission::Started));
    assert_eq!(calls.get(), 1);
    assert_eq!(
        permissions.reject_legacy_session("ses_schedule"),
        Err("permission_agent_session_scoped".to_owned())
    );
    let duplicate = submit_with(
        &state,
        "msg_schedule_direct",
        &workspace,
        "remind",
        |_, _| {
            calls.set(calls.get() + 1);
            Ok(())
        },
    )
    .checked("deduplicate direct submit")?;
    assert!(matches!(duplicate, ScheduledAdmission::Duplicate));
    assert_eq!(calls.get(), 1);
    fs::remove_dir_all(root).checked("remove scheduled fixture")?;
    Ok(())
}

#[test]
fn transport_failure_is_persisted_and_not_retried() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let state = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    let calls = std::cell::Cell::new(0_u8);
    assert!(submit_with(
        &state,
        "msg_schedule_failure",
        &workspace,
        "remind",
        |_, _| {
            calls.set(calls.get() + 1);
            Err("sidecar_not_ready".into())
        }
    )
    .is_err());
    assert!(matches!(
        submit_with(
            &state,
            "msg_schedule_failure",
            &workspace,
            "remind",
            |_, _| {
                calls.set(calls.get() + 1);
                Ok(())
            }
        ),
        Ok(ScheduledAdmission::Duplicate)
    ));
    assert_eq!(calls.get(), 1);
    assert_eq!(
        state.read().checked("read failure")?.recent[0]
            .error_summary
            .as_deref(),
        Some("scheduled_submission_failed")
    );
    fs::remove_dir_all(root).checked("remove scheduled fixture")?;
    Ok(())
}

#[test]
fn uncertain_submission_keeps_pending_failure_owned_until_settlement() -> TestResult<()> {
    // Given: prompt submission may have reached the sidecar despite transport failure.
    let (root, workspace) = fixture()?;
    let store = RunStore::new(root.join("agent-runs"));
    let state = AgentRunState::new(store.clone());

    // When: the callback records required settlement before returning the transport error.
    let result = submit_with(
        &state,
        "msg_uncertain",
        &workspace,
        "remind",
        |state, id| {
            state.bind_session(id, "ses_uncertain")?;
            state.confirm_submission(id)?;
            state.request_finish(
                id,
                super::RunOutcome::Failed,
                Some("agent_transport_failure".into()),
            )?;
            Err("agent_transport_failure".into())
        },
    );

    // Then: persisted ownership and the busy admission barrier remain until settlement.
    assert!(matches!(result, Err(ref error) if error == "agent_transport_failure"));
    for active in [
        state.active_record("msg_uncertain")?,
        AgentRunState::load(store)?.active_record("msg_uncertain")?,
    ] {
        assert_eq!(active.outcome, None);
        assert_eq!(active.pending_outcome, Some(super::RunOutcome::Failed));
        assert_eq!(
            active.pending_error_summary.as_deref(),
            Some("agent_transport_failure")
        );
        assert!(active.initial_input.is_none());
    }
    let next = submit_with(&state, "msg_next", &workspace, "next", |_, _| {
        panic!("busy scheduled task must not submit another prompt")
    })?;
    assert!(matches!(next, ScheduledAdmission::BusyReceipt));
    assert_eq!(
        state.active_record("msg_uncertain")?.session_id.as_deref(),
        Some("ses_uncertain")
    );
    fs::remove_dir_all(root)?;
    Ok(())
}
