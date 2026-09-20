use super::{pending_projection, process_pending, AgentPermissionState, AgentRunState, RunStore};
use crate::{
    agent::test_support::{Checked, TestResult},
    tool_permissions::runtime::PermissionRequest,
};
use std::fs;

fn write_request(id: &str, session_id: &str) -> TestResult<PermissionRequest> {
    Ok(serde_json::from_value(serde_json::json!({
        "id": id,
        "sessionID": session_id,
        "permission": "bash",
        "patterns": ["bun test"],
        "metadata": {"command": "bun test"},
        "tool": {"messageID": "msg_fixture", "callID": "call_bash"}
    }))
    .checked("deserialize write request")?)
}

#[test]
fn active_preparation_projects_empty_permissions_but_unknown_stays_closed() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!(
        "yume-agent-pending-projection-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace)?;
    let runs = AgentRunState::new(RunStore::new(root.join("runs")));
    let permissions = AgentPermissionState::default();
    runs.begin("msg_preparing", &workspace, "retryable")?;

    assert!(pending_projection(&runs, &permissions, "msg_preparing")?.is_empty());
    assert_eq!(
        pending_projection(&runs, &permissions, "msg_unknown")
            .err()
            .checked("unknown run rejected")?,
        "agent_run_unknown"
    );
    fs::remove_dir_all(root)?;
    Ok(())
}

#[test]
fn confirmed_registered_run_projects_its_cached_permissions() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!(
        "yume-agent-pending-confirmed-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace)?;
    let runs = AgentRunState::new(RunStore::new(root.join("runs")));
    let permissions = AgentPermissionState::default();
    runs.begin("msg_confirmed", &workspace, "input")?;
    runs.bind_session_with("msg_confirmed", "ses_confirmed", || {
        permissions.register_run("msg_confirmed", "ses_confirmed", &workspace)
    })?;
    runs.confirm_submission("msg_confirmed")?;
    process_pending(
        &permissions,
        "msg_confirmed",
        &["msg_fixture".to_owned()],
        &["call_bash".to_owned()],
        vec![write_request("per_write", "ses_confirmed")?],
    )?;

    let waiting = pending_projection(&runs, &permissions, "msg_confirmed")?;
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].request_id, "per_write");
    fs::remove_dir_all(root)?;
    Ok(())
}
