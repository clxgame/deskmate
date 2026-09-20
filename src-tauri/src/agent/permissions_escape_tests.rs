use super::permissions::{AgentPermissionState, PendingDecision};
use super::test_support::{Checked, TestResult};
use super::workspace::{PathIntent, WorkspaceRoot};
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
fn exact_git_relative_edit_pattern_matches_host_filepath() -> TestResult<()> {
    let repository =
        std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    let workspace =
        repository.join(".omo/evidence/yume-agent-mode-sol/native-read-edit-fixed/中文 工作区");
    fs::create_dir_all(repository.join(".git")).checked("create git marker")?;
    fs::create_dir_all(&workspace).checked("create nested workspace")?;
    let target = workspace.join("same.txt");
    fs::write(&target, "ORIGINAL_A").checked("write exact edit fixture")?;

    let root = WorkspaceRoot::open(&workspace).checked("open exact workspace")?;
    let filepath = opencode_wire_directory(&target);
    let pattern =
        ".omo\\evidence\\yume-agent-mode-sol\\native-read-edit-fixed\\中文 工作区\\same.txt";
    let metadata_target = root
        .resolve_opencode(&filepath, PathIntent::Existing)
        .checked("resolve exact metadata filepath")?;
    let pattern_target = root
        .resolve_opencode(pattern, PathIntent::Existing)
        .checked("resolve exact permission pattern")?;
    assert_eq!(metadata_target, pattern_target);

    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &workspace)
        .checked("register exact workspace")?;
    assert!(matches!(
        state
            .accept(
                "run-a",
                request(
                    "p-exact-edit",
                    "session-a",
                    "edit",
                    &[pattern],
                    json!({"filepath": filepath})
                )
            )
            .checked("accept exact edit permission")?,
        PendingDecision::Ask(_)
    ));

    fs::remove_dir_all(repository).checked("remove exact edit fixture")?;
    Ok(())
}

#[cfg(windows)]
#[test]
fn rejects_host_observed_outside_and_symlink_edit_targets() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    let outside = std::env::temp_dir().join(format!("yume-agent-outside-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    fs::write(&outside, "outside").checked("write outside fixture")?;
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register run")?;
    let outside_pattern = root_stripped(&outside)?;
    assert_eq!(
        state
            .accept(
                "run-a",
                request(
                    "p-outside",
                    "session-a",
                    "edit",
                    &[&outside_pattern],
                    json!({"filepath": opencode_wire_directory(&outside)})
                )
            )
            .checked("reject outside edit")?,
        PendingDecision::Reject
    );

    let link = root.join("link.txt");
    if std::os::windows::fs::symlink_file(&outside, &link).is_ok() {
        let link_pattern = root_stripped(&link)?;
        assert_eq!(
            state
                .accept(
                    "run-a",
                    request(
                        "p-symlink",
                        "session-a",
                        "edit",
                        &[&link_pattern],
                        json!({"filepath": opencode_wire_directory(&link)})
                    )
                )
                .checked("reject symlink edit")?,
            PendingDecision::Reject
        );
        fs::remove_file(link).checked("remove symlink fixture")?;
    }

    fs::remove_dir_all(root).checked("remove fixture")?;
    fs::remove_file(outside).checked("remove outside fixture")?;
    Ok(())
}

#[cfg(windows)]
#[test]
fn reply_returns_only_the_host_observed_request() -> TestResult<()> {
    let root = std::env::temp_dir().join(format!("yume-agent-permission-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create fixture")?;
    let target = root.join("new.txt");
    let pattern = root_stripped(&target)?;
    let filepath = opencode_wire_directory(&target);
    let state = AgentPermissionState::default();
    state
        .register_run("run-a", "session-a", &root)
        .checked("register run")?;
    assert!(matches!(
        state
            .accept(
                "run-a",
                request(
                    "p-edit",
                    "session-a",
                    "edit",
                    &[&pattern],
                    json!({"filepath": filepath})
                )
            )
            .checked("store host-observed request")?,
        PendingDecision::Ask(_)
    ));
    let stored = state
        .take_reply("run-a", "p-edit")
        .checked("take host-observed request")?;
    assert_eq!(
        stored
            .metadata
            .get("filepath")
            .and_then(serde_json::Value::as_str),
        Some(filepath.as_str())
    );

    fs::remove_dir_all(root).checked("remove fixture")?;
    Ok(())
}
