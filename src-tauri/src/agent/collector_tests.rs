use super::{
    collector::{collect_once_with, CollectorActions, SnapshotRead},
    record_store::{NativeMessage, NativePart, RunOutcome, RunRecord},
    test_support::{Checked, TestResult},
    AgentPermissionState, AgentRunState, RunStore,
};
use crate::tool_permissions::runtime::{PermissionRequest, Reply};
use std::{cell::Cell, fs};

mod permission_tests;
mod race_tests;
mod reply_tests;

fn fixture(name: &str) -> TestResult<(std::path::PathBuf, std::path::PathBuf)> {
    let root = std::env::temp_dir().join(format!(
        "yume-host-collector-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace).checked("create collector fixture")?;
    Ok((root, workspace))
}

fn active(
    root: &std::path::Path,
    workspace: &std::path::Path,
) -> TestResult<(AgentRunState, AgentPermissionState)> {
    let runs = AgentRunState::new(RunStore::new(root.join("runs")));
    let permissions = AgentPermissionState::default();
    runs.begin("msg_run", workspace, "input").checked("begin")?;
    runs.bind_session_with("msg_run", "ses_run", || {
        permissions.register_run("msg_run", "ses_run", workspace)
    })
    .checked("bind")?;
    runs.confirm_submission("msg_run").checked("confirm")?;
    Ok((runs, permissions))
}

fn terminal(run_id: &str) -> Vec<NativeMessage> {
    vec![NativeMessage {
        id: "msg_reply".into(),
        role: Some("assistant".into()),
        created: Some(2),
        parent_id: Some(run_id.into()),
        completed: true,
        finish: Some("stop".into()),
        error: None,
        parts: vec![NativePart {
            id: "prt_reply".into(),
            kind: Some("text".into()),
            text: Some("finished without renderer polling".into()),
            call_id: None,
            tool: None,
            state: None,
        }],
    }]
}

fn request_for_tool(
    id: &str,
    session_id: &str,
    message_id: &str,
    call_id: &str,
) -> TestResult<PermissionRequest> {
    Ok(serde_json::from_value(serde_json::json!({
        "id": id,
        "sessionID": session_id,
        "permission": "bash",
        "patterns": ["bun test"],
        "metadata": {"command": "bun test"},
        "tool": {"messageID": message_id, "callID": call_id}
    }))
    .checked("deserialize permission provenance")?)
}

fn permission_snapshot() -> Vec<NativeMessage> {
    vec![NativeMessage {
        id: "msg_native".into(),
        role: Some("assistant".into()),
        created: Some(1),
        parent_id: Some("msg_run".into()),
        completed: false,
        finish: None,
        error: None,
        parts: vec![NativePart {
            id: "part_tool".into(),
            kind: Some("tool".into()),
            text: None,
            call_id: Some("call_bash".into()),
            tool: Some("bash".into()),
            state: None,
        }],
    }]
}

#[test]
fn host_tick_archives_and_finishes_without_renderer_polling() -> TestResult<()> {
    let (root, workspace) = fixture("hidden")?;
    let (runs, permissions) = active(&root, &workspace)?;
    let archives = Cell::new(0);
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(terminal("msg_run"))),
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, messages: &[NativeMessage]| {
                archives.set(archives.get() + 1);
                assert_eq!(
                    messages[0].parts[0].text.as_deref(),
                    Some("finished without renderer polling")
                );
                Ok(())
            },
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )?;
    let listing = runs.read()?;
    assert!(listing.active.is_none());
    assert_eq!(listing.recent[0].outcome, Some(RunOutcome::Completed));
    assert_eq!(archives.get(), 1);
    assert_eq!(
        permissions.cancel_run("msg_run"),
        Err("agent_run_unknown".into())
    );

    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| panic!("idle collector fetched a snapshot"),
            pending: |_: &RunRecord| panic!("idle collector fetched permissions"),
            archive: |_: &RunRecord, _: &[NativeMessage]| panic!("idle collector archived"),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| {
                panic!("idle collector replied")
            },
        },
    )?;
    assert_eq!(archives.get(), 1);
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn transient_read_and_archive_failures_retry_without_terminalizing() -> TestResult<()> {
    let (root, workspace) = fixture("retry")?;
    let (runs, permissions) = active(&root, &workspace)?;
    let result = collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Err("agent_transport_failure".into()),
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, _: &[NativeMessage]| panic!("failed read must not archive"),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    );
    assert_eq!(result, Err("agent_read_failed".into()));
    assert_eq!(
        runs.read()?
            .active
            .checked("active after read failure")?
            .error_summary
            .as_deref(),
        Some("agent_read_failed")
    );

    let result = collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(terminal("msg_run"))),
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, _: &[NativeMessage]| Err("history_storage_failed".into()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    );
    assert_eq!(result, Err("history_storage_failed".into()));
    assert_eq!(
        runs.read()?
            .active
            .checked("active after archive failure")?
            .error_summary
            .as_deref(),
        Some("history_storage_failed")
    );

    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::Messages(terminal("msg_run"))),
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )?;
    assert_eq!(runs.read()?.recent[0].outcome, Some(RunOutcome::Completed));
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn preparation_is_idle_and_confirmed_sidecar_loss_interrupts() -> TestResult<()> {
    let (root, workspace) = fixture("preparation")?;
    let runs = AgentRunState::new(RunStore::new(root.join("runs")));
    let permissions = AgentPermissionState::default();
    runs.begin("msg_run", &workspace, "input")?;
    runs.bind_session_with("msg_run", "ses_run", || {
        permissions.register_run("msg_run", "ses_run", &workspace)
    })?;
    let reads = Cell::new(0);
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| {
                reads.set(reads.get() + 1);
                Ok(SnapshotRead::SidecarLost)
            },
            pending: |_: &RunRecord| Ok(Vec::new()),
            archive: |_: &RunRecord, _: &[NativeMessage]| Ok(()),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| Ok(()),
        },
    )?;
    assert_eq!(reads.get(), 0);
    runs.confirm_submission("msg_run")?;
    collect_once_with(
        &runs,
        &permissions,
        CollectorActions {
            snapshot: |_: &RunRecord| Ok(SnapshotRead::SidecarLost),
            pending: |_: &RunRecord| panic!("lost sidecar has no pending request"),
            archive: |_: &RunRecord, _: &[NativeMessage]| panic!("lost sidecar has no snapshot"),
            respond: |_: &RunRecord, _: &PermissionRequest, _: Reply| {
                panic!("lost sidecar cannot reply")
            },
        },
    )?;
    assert_eq!(
        runs.read()?.recent[0].error_summary.as_deref(),
        Some("sidecar_process_lost")
    );
    fs::remove_dir_all(root)?;
    Ok(())
}
