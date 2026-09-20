use super::{active, fixture, permission_snapshot, request_for_tool};
use crate::{
    agent::{
        collector::{cached_permissions, collect_once_with, CollectorActions, SnapshotRead},
        process_reply,
        record_store::{NativeMessage, RunRecord},
        test_support::{Checked, TestResult},
        AgentReply,
    },
    tool_permissions::runtime::{PermissionRequest, PermissionTool, Reply},
};
use std::{cell::Cell, fs};

fn write_request(id: &str, session_id: &str) -> TestResult<PermissionRequest> {
    Ok(serde_json::from_value(serde_json::json!({
        "id": id,
        "sessionID": session_id,
        "permission": "bash",
        "patterns": ["bun test"],
        "metadata": {"command": "bun test"},
        "tool": {"messageID": "msg_native", "callID": "call_bash"}
    }))
    .checked("deserialize write request")?)
}

fn collect_permissions(
    runs: &crate::agent::AgentRunState,
    permissions: &crate::agent::AgentPermissionState,
    pending: Vec<PermissionRequest>,
) -> Result<(), String> {
    collect_once_with(
        runs,
        permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(permission_snapshot())),
            pending: |_: &RunRecord| Ok(pending),
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )
}

#[test]
fn live_pending_refresh_evicts_missing_and_replaced_requests() -> TestResult<()> {
    let (root, workspace) = fixture("permission-refresh")?;
    let (runs, permissions) = active(&root, &workspace)?;
    collect_permissions(
        &runs,
        &permissions,
        vec![write_request("per_old", "ses_run")?],
    )?;
    assert_eq!(cached_permissions(&permissions, "msg_run")?.len(), 1);

    collect_permissions(&runs, &permissions, Vec::new())?;
    assert!(cached_permissions(&permissions, "msg_run")?.is_empty());
    assert!(process_reply(&permissions, "msg_run", "per_old", AgentReply::Once).is_err());

    collect_permissions(
        &runs,
        &permissions,
        vec![write_request("per_old", "ses_run")?],
    )?;
    collect_permissions(
        &runs,
        &permissions,
        vec![write_request("per_new", "ses_run")?],
    )?;
    let waiting = cached_permissions(&permissions, "msg_run")?;
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].request_id, "per_new");
    assert!(process_reply(&permissions, "msg_run", "per_old", AgentReply::Once).is_err());
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn same_session_continuation_keeps_only_current_run_tool_permissions() -> TestResult<()> {
    let (root, workspace) = fixture("permission-provenance")?;
    let (runs, permissions) = active(&root, &workspace)?;
    collect_permissions(
        &runs,
        &permissions,
        vec![
            request_for_tool("per_old", "ses_run", "msg_old", "call_old")?,
            request_for_tool("per_current", "ses_run", "msg_native", "call_bash")?,
        ],
    )?;

    let waiting = cached_permissions(&permissions, "msg_run")?;
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].request_id, "per_current");
    assert!(process_reply(&permissions, "msg_run", "per_old", AgentReply::Once).is_err());
    assert!(process_reply(&permissions, "msg_run", "per_current", AgentReply::Once).is_ok());
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn collector_auto_allows_reads_but_caches_write_for_user() -> TestResult<()> {
    let (root, workspace) = fixture("permissions")?;
    let (runs, permissions) = active(&root, &workspace)?;
    let file = workspace.join("read.txt");
    fs::write(&file, "fixture")?;
    let read = PermissionRequest {
        id: "per_read".into(),
        session_id: "ses_run".into(),
        permission: "read".into(),
        patterns: vec![file.to_string_lossy().into_owned()],
        always: Vec::new(),
        metadata: serde_json::json!({}),
        tool: Some(PermissionTool {
            message_id: "msg_native".into(),
            call_id: "call_bash".into(),
        }),
    };
    let write = request_for_tool("per_write", "ses_run", "msg_native", "call_bash")?;
    let replies = Cell::new(0);
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(permission_snapshot())),
            pending: |_: &RunRecord| Ok(vec![read, write]),
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, request: &PermissionRequest, _: Reply| {
                assert_eq!(request.id, "per_read");
                replies.set(replies.get() + 1);
                Ok(())
            },
        },
    )?;
    assert_eq!(replies.get(), 1);
    assert!(process_reply(&permissions, "msg_run", "per_write", AgentReply::Once).is_ok());
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn mismatched_live_request_evicts_stale_cached_approval() -> TestResult<()> {
    let (root, workspace) = fixture("permission-mismatch")?;
    let (runs, permissions) = active(&root, &workspace)?;
    collect_permissions(
        &runs,
        &permissions,
        vec![write_request("per_current", "ses_run")?],
    )?;
    let result = collect_permissions(
        &runs,
        &permissions,
        vec![write_request("per_current", "ses_other")?],
    );
    assert_eq!(result, Err("agent_session_mismatch".to_owned()));
    assert!(cached_permissions(&permissions, "msg_run")?.is_empty());
    assert!(process_reply(&permissions, "msg_run", "per_current", AgentReply::Once).is_err());
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn cancel_evicts_cached_approval_and_automatic_reply_runs_without_locks() -> TestResult<()> {
    let (root, workspace) = fixture("permission-cancel")?;
    let (runs, permissions) = active(&root, &workspace)?;
    collect_permissions(
        &runs,
        &permissions,
        vec![write_request("per_cancelled", "ses_run")?],
    )?;
    permissions.cancel_run("msg_run")?;
    assert!(process_reply(&permissions, "msg_run", "per_cancelled", AgentReply::Once).is_err());

    let (other_runs, other_permissions) = active(&root.join("other"), &workspace)?;
    let file = workspace.join("read.txt");
    fs::write(&file, "fixture")?;
    let replied = Cell::new(false);
    collect_once_with(
        &other_runs,
        &other_permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(permission_snapshot())),
            pending: |_: &RunRecord| {
                Ok(vec![PermissionRequest {
                    id: "per_read".into(),
                    session_id: "ses_run".into(),
                    permission: "read".into(),
                    patterns: vec![file.to_string_lossy().into_owned()],
                    always: Vec::new(),
                    metadata: serde_json::json!({}),
                    tool: Some(crate::tool_permissions::runtime::PermissionTool {
                        message_id: "msg_native".into(),
                        call_id: "call_bash".into(),
                    }),
                }])
            },
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| {
                let _operation = other_runs.lock_operation()?;
                assert!(cached_permissions(&other_permissions, "msg_run")?.is_empty());
                replied.set(true);
                Ok(())
            },
        },
    )?;
    assert!(replied.get());
    fs::remove_dir_all(root)?;
    Ok(())
}
