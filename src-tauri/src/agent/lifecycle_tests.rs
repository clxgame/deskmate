use super::test_support::{Checked, TestResult};
use super::{
    lifecycle::AgentRunState,
    record_store::{NativeMessage, NativePart, NativeToolState, RunOutcome, RunStore},
};
use std::{
    fs,
    sync::{mpsc, Arc, Barrier},
    thread,
    time::Duration,
};

fn fixture() -> TestResult<(std::path::PathBuf, std::path::PathBuf)> {
    let root = std::env::temp_dir().join(format!("yume-agent-lifecycle-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace).checked("create lifecycle fixture")?;
    Ok((root, workspace))
}

#[test]
fn atomic_double_start_accepts_exactly_one() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let state = Arc::new(AgentRunState::new(RunStore::new(root.join("agent-runs"))));
    let barrier = Arc::new(Barrier::new(3));
    let handles: Vec<_> = ["msg_run_a", "msg_run_b"]
        .into_iter()
        .map(|id| {
            let state = Arc::clone(&state);
            let barrier = Arc::clone(&barrier);
            let workspace = workspace.clone();
            thread::spawn(move || {
                barrier.wait();
                state.begin(id, &workspace, "synthetic input")
            })
        })
        .collect();
    barrier.wait();
    let accepted = handles
        .into_iter()
        .map(|handle| handle.join().checked("join starter"))
        .collect::<TestResult<Vec<_>>>()?
        .into_iter()
        .filter(Result::is_ok)
        .count();
    assert_eq!(accepted, 1);
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn persistence_failure_never_leaves_running_state() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let blocked = root.join("blocked");
    fs::write(&blocked, "not a directory").checked("write blocker")?;
    let state = AgentRunState::new(RunStore::new(blocked));
    assert!(state.begin("msg_run", &workspace, "input").is_err());
    assert!(state.read().checked("read state")?.active.is_none());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn cancel_only_commits_after_confirmed_abort() -> TestResult<()> {
    let (root, workspace) = fixture()?;
    let state = AgentRunState::new(RunStore::new(root.join("agent-runs")));
    state
        .begin("msg_run", &workspace, "input")
        .checked("begin")?;
    state.bind_session("msg_run", "ses_run").checked("bind")?;
    assert!(state
        .cancel_with("msg_run", |_| Err("abort_http_failed".into()))
        .is_err());
    assert_eq!(
        state
            .read()
            .checked("read")?
            .active
            .checked("active")?
            .outcome,
        None
    );
    state
        .cancel_with("msg_run", |_| Ok(true))
        .checked("cancel")?;
    assert_eq!(
        state.read().checked("read")?.recent[0].outcome,
        Some(RunOutcome::Cancelled)
    );
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn cancel_and_permission_reply_share_one_operation_boundary() -> TestResult<()> {
    let (root, _workspace) = fixture()?;
    let state = Arc::new(AgentRunState::new(RunStore::new(root.join("agent-runs"))));
    let guard = state.lock_operation().checked("hold cancel boundary")?;
    let (started_tx, started_rx) = mpsc::channel();
    let (acquired_tx, acquired_rx) = mpsc::channel();
    let contender = Arc::clone(&state);
    let handle = thread::spawn(move || -> TestResult<()> {
        started_tx.send(()).checked("signal reply started")?;
        let _guard = contender
            .lock_operation()
            .checked("acquire reply boundary")?;
        acquired_tx.send(()).checked("signal reply acquired")?;
        Ok(())
    });
    started_rx
        .recv_timeout(Duration::from_secs(1))
        .checked("reply reached boundary")?;
    assert!(matches!(
        acquired_rx.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    drop(guard);
    acquired_rx
        .recv_timeout(Duration::from_secs(1))
        .checked("reply proceeds after cancel boundary")?;
    handle.join().checked("join boundary contender")??;
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

fn terminal_message_with_unresolved_tool(
    tool_in_latest: bool,
    error: Option<String>,
) -> TestResult<()> {
    // Given: an owned tool is still running when a later message looks terminal.
    let (root, workspace) = fixture()?;
    let store = RunStore::new(root.join("agent-runs"));
    let state = AgentRunState::new(store.clone());
    state.begin("msg_run", &workspace, "input")?;
    state.bind_session("msg_run", "ses_run")?;
    state.confirm_submission("msg_run")?;
    let mut earlier = NativeMessage {
        id: "msg_earlier".into(),
        role: Some("assistant".into()),
        created: Some(1),
        parent_id: Some("msg_run".into()),
        completed: true,
        finish: Some("tool-calls".into()),
        error: None,
        parts: vec![NativePart {
            id: "part_tool".into(),
            kind: Some("tool".into()),
            text: None,
            call_id: Some("call_tool".into()),
            tool: Some("bash".into()),
            state: Some(NativeToolState {
                status: "running".into(),
                input: serde_json::json!({"command":"Get-Location"}),
                output: serde_json::Value::Null,
                metadata: serde_json::Value::Null,
            }),
        }],
    };
    let mut latest = NativeMessage {
        id: "msg_latest".into(),
        created: Some(2),
        finish: Some("stop".into()),
        error: error.clone(),
        parts: Vec::new(),
        ..earlier.clone()
    };
    if tool_in_latest {
        latest.parts = std::mem::take(&mut earlier.parts);
    }
    let messages = vec![earlier, latest];

    // When: reconciliation observes a stop or error before tool settlement.
    state.reconcile("msg_run", &messages)?;

    // Then: neither memory nor disk releases ownership of the unfinished tool.
    assert!(
        state.read()?.active.is_some(),
        "unfinished tool must retain the busy slot"
    );
    let reloaded = AgentRunState::load(store)?;
    assert_eq!(
        reloaded.active_record("msg_run")?.call_ids,
        vec!["call_tool"]
    );
    assert_eq!(
        reloaded.begin("msg_next", &workspace, "next"),
        Err("agent_run_busy".into())
    );
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn unresolved_tool_in_earlier_round_prevents_later_stop_from_finishing() -> TestResult<()> {
    terminal_message_with_unresolved_tool(false, None)
}

#[test]
fn unresolved_tool_in_latest_error_prevents_premature_failure() -> TestResult<()> {
    terminal_message_with_unresolved_tool(true, Some("provider_failed".into()))
}
