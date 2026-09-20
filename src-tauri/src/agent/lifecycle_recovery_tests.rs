use super::permissions::{AgentPermissionState, PendingDecision};
use super::test_support::{Checked, TestResult};
use super::{
    lifecycle::AgentRunState,
    record_store::{NativeMessage, NativePart, NativeToolState, RunOutcome, RunStore},
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
fn snapshot_recovery_deduplicates_native_references_and_never_replays() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let store = RunStore::new(root.join("agent-runs"));
    let state = AgentRunState::new(store.clone());
    state
        .begin("msg_run", &workspace, "input")
        .checked("begin")?;
    state.bind_session("msg_run", "ses_run").checked("bind")?;
    state.confirm_submission("msg_run").checked("confirm")?;
    let duplicate = NativeMessage {
        role: None,
        created: None,
        id: "msg_assistant".into(),
        parent_id: Some("msg_run".into()),
        completed: true,
        finish: Some("stop".into()),
        error: None,
        parts: vec![
            NativePart {
                kind: None,
                text: None,
                id: "part_one".into(),
                call_id: Some("call_one".into()),
                tool: None,
                state: None,
            },
            NativePart {
                kind: None,
                text: None,
                id: "part_one".into(),
                call_id: Some("call_one".into()),
                tool: None,
                state: None,
            },
        ],
    };
    state
        .reconcile("msg_run", &[duplicate.clone(), duplicate])
        .checked("reconcile")?;
    let completed = state.read().checked("read")?.recent[0].clone();
    assert_eq!(completed.outcome, Some(RunOutcome::Completed));
    assert_eq!(completed.part_ids, ["part_one"]);
    assert_eq!(completed.call_ids, ["call_one"]);
    let recovered = AgentRunState::load(store).checked("reload")?;
    assert_eq!(
        recovered.read().checked("read reload")?.recent[0].run_id,
        "msg_run"
    );
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn intermediate_tool_calls_keep_run_active_until_explicit_terminal_message() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let state = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    let permissions = AgentPermissionState::default();
    fs::write(workspace.join("same.txt"), "ORIGINAL_A").checked("write fixture file")?;
    state
        .begin("msg_run", &workspace, "QA_READ_EDIT")
        .checked("begin")?;
    state
        .bind_session_with("msg_run", "ses_run", || {
            permissions.register_run("msg_run", "ses_run", &workspace)
        })
        .checked("bind session")?;
    state.confirm_submission("msg_run").checked("confirm")?;

    let read_round = NativeMessage {
        role: None,
        created: None,
        id: "msg_read".into(),
        parent_id: Some("msg_run".into()),
        completed: true,
        finish: Some("tool-calls".into()),
        error: None,
        parts: vec![NativePart {
            kind: None,
            text: None,
            id: "part_read".into(),
            call_id: Some("call_read".into()),
            tool: Some("read".into()),
            state: Some(NativeToolState {
                status: "completed".into(),
                input: serde_json::json!({"filePath": "same.txt"}),
                output: serde_json::json!("ORIGINAL_A"),
                metadata: serde_json::json!({}),
            }),
        }],
    };
    let edit_round = NativeMessage {
        role: None,
        created: None,
        id: "msg_edit".into(),
        parent_id: Some("msg_run".into()),
        completed: false,
        finish: None,
        error: None,
        parts: vec![NativePart {
            kind: None,
            text: None,
            id: "part_edit".into(),
            call_id: Some("call_edit".into()),
            tool: Some("edit".into()),
            state: Some(NativeToolState {
                status: "running".into(),
                input: serde_json::json!({
                    "filePath": "same.txt",
                    "oldString": "ORIGINAL_A",
                    "newString": "UPDATED_A"
                }),
                output: serde_json::Value::Null,
                metadata: serde_json::json!({}),
            }),
        }],
    };
    state
        .reconcile("msg_run", &[read_round, edit_round.clone()])
        .checked("reconcile intermediate tool rounds")?;
    assert_eq!(
        state
            .read()
            .checked("read active")?
            .active
            .checked("active")?
            .run_id,
        "msg_run"
    );
    assert!(matches!(
        permissions
            .accept(
                "msg_run",
                PermissionRequest {
                    id: "per_edit".into(),
                    session_id: "ses_run".into(),
                    permission: "edit".into(),
                    patterns: vec![workspace.join("same.txt").to_string_lossy().into_owned()],
                    always: Vec::new(),
                    metadata: serde_json::json!({
                        "filepath": workspace.join("same.txt").to_string_lossy()
                    }),
                    tool: None,
                },
            )
            .checked("queue edit approval")?,
        PendingDecision::Ask(_)
    ));

    let final_round = NativeMessage {
        role: None,
        created: None,
        id: "msg_final".into(),
        parent_id: Some("msg_run".into()),
        completed: true,
        finish: Some("stop".into()),
        error: None,
        parts: vec![NativePart {
            kind: None,
            text: None,
            id: "part_text".into(),
            call_id: None,
            tool: None,
            state: None,
        }],
    };
    state
        .reconcile("msg_run", &[edit_round, final_round])
        .checked("reconcile final message")?;
    assert_eq!(
        state.read().checked("read completed")?.recent[0].outcome,
        Some(RunOutcome::Completed)
    );

    state
        .begin("msg_error_run", &workspace, "QA_ERROR")
        .checked("begin error run")?;
    state
        .bind_session("msg_error_run", "ses_error")
        .checked("bind error session")?;
    state
        .confirm_submission("msg_error_run")
        .checked("confirm error run")?;
    state
        .reconcile(
            "msg_error_run",
            &[NativeMessage {
                role: None,
                created: None,
                id: "msg_error".into(),
                parent_id: Some("msg_error_run".into()),
                completed: true,
                finish: None,
                error: Some("ProviderError".into()),
                parts: Vec::new(),
            }],
        )
        .checked("reconcile explicit error")?;
    let failed = &state.read().checked("read failed")?.recent[0];
    assert_eq!(failed.outcome, Some(RunOutcome::Failed));
    assert_eq!(failed.error_summary.as_deref(), Some("ProviderError"));

    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}
