use super::{active, fixture, permission_snapshot, request_for_tool, terminal};
use crate::{
    agent::{
        collector::{collect_once_with, CollectorActions, SnapshotRead},
        process_current_reply,
        record_store::{NativeMessage, RunOutcome, RunRecord},
        test_support::TestResult,
        AgentReply,
    },
    tool_permissions::runtime::{PermissionRequest, Reply},
};
use std::{cell::Cell, fs};

#[test]
fn rejected_permission_waits_for_native_result_and_model_reply() -> TestResult<()> {
    let (root, workspace) = fixture("permission-reject")?;
    let (runs, permissions) = active(&root, &workspace)?;
    runs.reconcile("msg_run", &permission_snapshot())?;
    permissions.accept(
        "msg_run",
        request_for_tool("per_reject", "ses_run", "msg_native", "call_bash")?,
    )?;
    process_current_reply(
        &runs,
        &permissions,
        "msg_run",
        "per_reject",
        AgentReply::Reject,
    )?;
    assert_eq!(
        runs.read()?
            .active
            .and_then(|record| record.pending_outcome),
        None
    );

    let archived = Cell::new(false);
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(terminal("msg_run"))),
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, messages: &[NativeMessage]| {
                assert_eq!(
                    messages[0].parts[0].text.as_deref(),
                    Some("finished without renderer polling")
                );
                archived.set(true);
                Ok(())
            },
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )?;
    assert!(archived.get());
    let listing = runs.read()?;
    assert!(listing.active.is_none());
    assert_eq!(listing.recent[0].outcome, Some(RunOutcome::Completed));
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn permission_reply_rejects_previous_turn_tool_on_the_same_session() -> TestResult<()> {
    let (root, workspace) = fixture("permission-reply-provenance")?;
    let (runs, permissions) = active(&root, &workspace)?;
    runs.reconcile("msg_run", &permission_snapshot())?;

    let stale = request_for_tool("per_a", "ses_run", "msg_a", "call_a")?;
    permissions.accept("msg_run", stale)?;
    assert_eq!(
        process_current_reply(&runs, &permissions, "msg_run", "per_a", AgentReply::Once)
            .expect_err("stale previous-turn permission"),
        "agent_permission_stale"
    );

    let current = request_for_tool("per_b", "ses_run", "msg_native", "call_bash")?;
    permissions.accept("msg_run", current)?;
    assert!(
        process_current_reply(&runs, &permissions, "msg_run", "per_b", AgentReply::Once,).is_ok()
    );
    fs::remove_dir_all(root)?;
    Ok(())
}
