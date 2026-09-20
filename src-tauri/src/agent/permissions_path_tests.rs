use super::super::test_support::{Checked, TestResult};
use super::{AgentPermissionState, PendingDecision};
use crate::{agent::opencode_wire_directory, tool_permissions::runtime::PermissionRequest};
use serde_json::json;
use std::{fs, path::Path};

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
        always: Vec::new(),
        metadata,
        tool: None,
    }
}

#[cfg(windows)]
fn root_stripped(path: &Path) -> TestResult<String> {
    let canonical = if path.exists() {
        path.canonicalize().checked("canonical pattern path")?
    } else {
        path.parent()
            .checked("find pattern parent")?
            .canonicalize()
            .checked("canonical pattern parent")?
            .join(path.file_name().checked("find pattern filename")?)
    };
    let ordinary = std::path::PathBuf::from(opencode_wire_directory(&canonical));
    let root = ordinary.ancestors().last().checked("find drive root")?;
    Ok(ordinary
        .strip_prefix(root)
        .checked("strip drive root")?
        .to_string_lossy()
        .into_owned())
}

#[cfg(windows)]
#[test]
fn resolves_root_stripped_read_patterns_and_rejects_outside_or_mixed_paths() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    let outside = std::env::temp_dir().join(format!("yume-agent-outside-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    fs::write(root.join("inside.txt"), "inside").checked("write inside fixture")?;
    fs::write(&outside, "outside").checked("write outside fixture")?;
    let inside_pattern = root_stripped(&root.join("inside.txt"))?;
    let outside_pattern = root_stripped(&outside)?;
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register run")?;

    assert_eq!(
        state
            .accept(
                "run-a",
                request("p-read", "session-a", "read", &[&inside_pattern], json!({}))
            )
            .checked("accept root-stripped read")?,
        PendingDecision::AllowOnce
    );
    assert_eq!(
        state
            .accept(
                "run-a",
                request("p-out", "session-a", "read", &[&outside_pattern], json!({}))
            )
            .checked("reject root-stripped outside read")?,
        PendingDecision::Reject
    );
    assert_eq!(
        state
            .accept(
                "run-a",
                request(
                    "p-mixed",
                    "session-a",
                    "read",
                    &[&inside_pattern, &outside_pattern],
                    json!({})
                )
            )
            .checked("reject mixed read patterns")?,
        PendingDecision::Reject
    );

    fs::remove_dir_all(root).checked("remove fixture")?;
    fs::remove_file(outside).checked("remove outside fixture")?;
    Ok(())
}

#[cfg(windows)]
#[test]
fn asks_for_host_observed_existing_and_new_edit_targets() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    let existing = root.join("existing.txt");
    let new_file = root.join("new.txt");
    fs::write(&existing, "existing").checked("write existing fixture")?;
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register run")?;
    let expected = super::ApprovalDetail {
        command: None,
        cwd: root.canonicalize().checked("canonical fixture")?,
    };

    for (id, path) in [("p-existing", &existing), ("p-new", &new_file)] {
        let pattern = root_stripped(path)?;
        let filepath = opencode_wire_directory(path);
        assert_eq!(
            state
                .accept(
                    "run-a",
                    request(
                        id,
                        "session-a",
                        "edit",
                        &[&pattern],
                        json!({"filepath": filepath})
                    )
                )
                .checked("accept host-observed edit")?,
            PendingDecision::Ask(expected.clone())
        );
    }

    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}
