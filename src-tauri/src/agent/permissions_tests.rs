use super::super::test_support::{Checked, TestResult};
use super::{AgentPermissionState, PendingDecision};
use crate::tool_permissions::runtime::PermissionRequest;
use serde_json::json;
use std::fs;

fn request(
    id: &str,
    session: &str,
    permission: &str,
    patterns: &[&str],
    metadata: serde_json::Value,
) -> PermissionRequest {
    PermissionRequest {
        id: id.into(),
        session_id: session.into(),
        permission: permission.into(),
        patterns: patterns.iter().map(|value| (*value).into()).collect(),
        metadata,
    }
}

#[test]
fn binds_pending_requests_to_owned_run_session_and_workspace() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    fs::write(root.join("a.txt"), "inside").checked("write fixture")?;
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register run")?;
    assert_eq!(
        state
            .accept(
                "run-a",
                request(
                    "p-read",
                    "session-a",
                    "read",
                    &[root.join("a.txt").to_string_lossy().as_ref()],
                    json!({})
                )
            )
            .checked("accept read")?,
        PendingDecision::AllowOnce
    );
    assert!(state
        .accept(
            "run-a",
            request(
                "p-cross",
                "session-b",
                "read",
                &[root.join("a.txt").to_string_lossy().as_ref()],
                json!({})
            )
        )
        .is_err());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn asks_for_write_and_shell_with_host_derived_cwd() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register run")?;
    assert_eq!(
        state
            .accept(
                "run-a",
                request(
                    "p-edit",
                    "session-a",
                    "edit",
                    &[root.join("new.txt").to_string_lossy().as_ref()],
                    json!({})
                )
            )
            .checked("accept edit")?,
        PendingDecision::Ask(super::ApprovalDetail {
            command: None,
            cwd: root.canonicalize().checked("canonical fixture")?,
        })
    );
    let decision = state
        .accept(
            "run-a",
            request(
                "p-bash",
                "session-a",
                "bash",
                &[],
                json!({"command":"bun test"}),
            ),
        )
        .checked("accept real OpenCode bash shape")?;
    let PendingDecision::Ask(detail) = decision else {
        return Err(std::io::Error::other("bash should require approval").into());
    };
    assert_eq!(detail.command.as_deref(), Some("bun test"));
    assert_eq!(
        detail.cwd,
        root.canonicalize().checked("canonical fixture")?
    );
    let spoofed = state
        .accept(
            "run-a",
            request(
                "p-bash-spoofed-cwd",
                "session-a",
                "bash",
                &[],
                json!({"command":"bun test","cwd":root.join("../outside")}),
            ),
        )
        .checked("ignore caller supplied cwd")?;
    let PendingDecision::Ask(spoofed_detail) = spoofed else {
        return Err(std::io::Error::other("bash should require approval").into());
    };
    assert_eq!(
        spoofed_detail.cwd,
        root.canonicalize().checked("canonical fixture")?
    );
    assert!(state
        .accept(
            "run-a",
            request("p-no-path", "session-a", "edit", &[], json!({}))
        )
        .is_err());
    assert!(state
        .accept(
            "run-a",
            request("p-missing", "session-a", "bash", &[], json!({}))
        )
        .is_err());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}

#[test]
fn denies_unknown_external_stale_cross_run_and_repeated_replies() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    let outside = root.parent().checked("temp parent")?.join("outside.txt");
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register run")?;
    state
        .register_run("run-b", "session-b", &root)
        .checked("register run")?;
    assert_eq!(
        state
            .accept(
                "run-a",
                request("p-unknown", "session-a", "mystery", &[], json!({}))
            )
            .checked("deny unknown")?,
        PendingDecision::Reject
    );
    assert_eq!(
        state
            .accept(
                "run-a",
                request(
                    "p-out",
                    "session-a",
                    "edit",
                    &[outside.to_string_lossy().as_ref()],
                    json!({})
                )
            )
            .checked("deny outside")?,
        PendingDecision::Reject
    );
    assert_eq!(
        state
            .accept(
                "run-a",
                request(
                    "p-edit",
                    "session-a",
                    "edit",
                    &[root.join("new.txt").to_string_lossy().as_ref()],
                    json!({})
                )
            )
            .checked("ask edit")?,
        PendingDecision::Ask(super::ApprovalDetail {
            command: None,
            cwd: root.canonicalize().checked("canonical fixture")?,
        })
    );
    assert!(state.take_reply("run-b", "p-edit").is_err());
    assert!(state.take_reply("run-a", "p-edit").is_ok());
    assert!(state.take_reply("run-a", "p-edit").is_err());
    state.cancel_run("run-a").checked("cancel run")?;
    assert!(state.take_reply("run-a", "p-missing").is_err());
    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}
