use super::super::test_support::TestResult;
use super::{AgentPermissionState, PendingDecision};
use crate::tool_permissions::runtime::{PermissionRequest, PermissionTool};
use serde_json::json;
use std::time::{Duration, Instant};

fn poll(
    state: &AgentPermissionState,
    requests: Vec<PermissionRequest>,
    now: Instant,
) -> TestResult<Vec<(PermissionRequest, PendingDecision)>> {
    Ok(state.sync_pending_at(
        "run-a",
        requests,
        &["message-a".into()],
        &["call-a".into()],
        now,
    )?)
}

fn request(id: &str) -> PermissionRequest {
    PermissionRequest {
        id: id.into(),
        session_id: "session-a".into(),
        permission: "bash".into(),
        patterns: vec![],
        always: vec![],
        metadata: json!({"command": "Get-Location"}),
        tool: Some(PermissionTool {
            message_id: "message-a".into(),
            call_id: "call-a".into(),
        }),
    }
}

#[test]
fn malformed_metadata_rejects_only_its_request() -> TestResult<()> {
    // Given: two current tool requests, one missing its shell command.
    let state = AgentPermissionState::default();
    state.register_run("run-a", "session-a", std::env::temp_dir())?;
    let mut malformed = request("permission-bad");
    malformed.metadata = json!({});

    // When: the whole batch is synchronized.
    let decisions = state.sync_pending(
        "run-a",
        vec![malformed, request("permission-good")],
        &["message-a".into()],
        &["call-a".into()],
    )?;

    // Then: the malformed request is denied without stranding the valid approval.
    assert_eq!(decisions.len(), 2);
    assert_eq!(
        decisions[0].1,
        PendingDecision::RejectWithReason(super::APPROVAL_INVALID)
    );
    assert!(matches!(decisions[1].1, PendingDecision::Ask(_)));
    assert_eq!(state.waiting("run-a")?.len(), 1);
    Ok(())
}

#[test]
fn repeated_polls_keep_the_original_approval_deadline() -> TestResult<()> {
    // Given: an approval has waited through several polls.
    let state = AgentPermissionState::default();
    state.register_run("run-a", "session-a", std::env::temp_dir())?;
    let start = Instant::now();
    poll(&state, vec![request("permission-a")], start)?;
    poll(
        &state,
        vec![request("permission-a")],
        start + Duration::from_secs(299),
    )?;

    // When: the original five minute deadline arrives.
    let expired = poll(
        &state,
        vec![request("permission-a")],
        start + super::APPROVAL_TIMEOUT,
    )?;
    let repeated = poll(
        &state,
        vec![request("permission-a")],
        start + Duration::from_secs(301),
    )?;

    // Then: it stays rejected and disappears from actionable approvals.
    assert_eq!(
        expired[0].1,
        PendingDecision::RejectWithReason(super::APPROVAL_EXPIRED)
    );
    assert_eq!(
        repeated[0].1,
        PendingDecision::RejectWithReason(super::APPROVAL_EXPIRED)
    );
    assert!(state.waiting("run-a")?.is_empty());
    Ok(())
}

#[test]
fn multiple_approvals_have_independent_deadlines() -> TestResult<()> {
    // Given: a second approval arrived one minute after the first.
    let state = AgentPermissionState::default();
    state.register_run("run-a", "session-a", std::env::temp_dir())?;
    let start = Instant::now();
    poll(&state, vec![request("permission-a")], start)?;
    poll(
        &state,
        vec![request("permission-a"), request("permission-b")],
        start + Duration::from_secs(60),
    )?;

    // When: only the first approval reaches its deadline.
    let decisions = poll(
        &state,
        vec![request("permission-a"), request("permission-b")],
        start + super::APPROVAL_TIMEOUT,
    )?;

    // Then: the second approval remains actionable.
    assert_eq!(
        decisions[0].1,
        PendingDecision::RejectWithReason(super::APPROVAL_EXPIRED)
    );
    assert!(matches!(decisions[1].1, PendingDecision::Ask(_)));
    assert_eq!(state.waiting("run-a")?[0].request.id, "permission-b");
    Ok(())
}

#[test]
fn a_late_reply_cannot_approve_an_expired_request() -> TestResult<()> {
    // Given: an approval expired between collector polls.
    let state = AgentPermissionState::default();
    state.register_run("run-a", "session-a", std::env::temp_dir())?;
    let start = Instant::now();
    poll(&state, vec![request("permission-a")], start)?;

    // When: the UI submits its reply at the deadline.
    let reply = state.take_reply_at("run-a", "permission-a", start + super::APPROVAL_TIMEOUT);

    // Then: approval is refused and polling can still send native rejection.
    assert_eq!(reply.err().as_deref(), Some("agent_permission_expired"));
    assert_eq!(
        poll(
            &state,
            vec![request("permission-a")],
            start + super::APPROVAL_TIMEOUT
        )?[0]
            .1,
        PendingDecision::RejectWithReason(super::APPROVAL_EXPIRED)
    );
    Ok(())
}

#[test]
fn timely_reply_is_consumed_only_once() -> TestResult<()> {
    // Given: an unexpired permission belongs to this run.
    let state = AgentPermissionState::default();
    state.register_run("run-a", "session-a", std::env::temp_dir())?;
    let start = Instant::now();
    poll(&state, vec![request("permission-a")], start)?;

    // When: the user answers before expiry, then repeats the answer.
    let first = state.take_reply_at("run-a", "permission-a", start + Duration::from_secs(299))?;
    let repeated = state.take_reply_at("run-a", "permission-a", start + Duration::from_secs(299));

    // Then: only the first response can be sent to the runtime.
    assert_eq!(first.id, "permission-a");
    assert_eq!(repeated.err().as_deref(), Some("agent_permission_expired"));
    Ok(())
}

#[test]
fn cancel_clears_deadlines_before_a_new_run() -> TestResult<()> {
    // Given: a cancelled run previously owned an approval deadline.
    let state = AgentPermissionState::default();
    state.register_run("run-a", "session-a", std::env::temp_dir())?;
    let start = Instant::now();
    poll(&state, vec![request("permission-a")], start)?;
    state.cancel_run("run-a")?;

    // When: a new run is registered after the old deadline.
    state.register_run("run-a", "session-a", std::env::temp_dir())?;
    let fresh = poll(
        &state,
        vec![request("permission-a")],
        start + Duration::from_secs(600),
    )?;

    // Then: the old deadline cannot reject the new run's approval.
    assert!(matches!(fresh[0].1, PendingDecision::Ask(_)));
    assert_eq!(state.waiting("run-a")?.len(), 1);
    Ok(())
}
