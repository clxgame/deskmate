use super::{
    artifacts::{collect, current, locate_with, ArtifactKind},
    record_store::{NativeMessage, NativePart, NativeToolState, RunRecord},
    test_support::{Checked, TestResult},
};
use std::{fs, path::PathBuf};

fn fixture() -> TestResult<(PathBuf, RunRecord)> {
    let root = std::env::temp_dir().join(format!("yume-agent-artifact-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).checked("create root")?;
    Ok((
        root.clone(),
        RunRecord {
            run_id: "run_one".into(),
            session_id: Some("session_one".into()),
            workspace_path: root,
            created_at: "now".into(),
            ended_at: None,
            outcome: None,
            error_summary: None,
            pending_outcome: None,
            pending_error_summary: None,
            message_ids: Vec::new(),
            part_ids: Vec::new(),
            call_ids: Vec::new(),
            initial_input: None,
        },
    ))
}

fn message(tool: &str, status: &str, input: serde_json::Value) -> NativeMessage {
    NativeMessage {
        role: None,
        created: None,
        id: "message_one".into(),
        parent_id: Some("run_one".into()),
        completed: true,
        finish: Some("stop".into()),
        error: None,
        parts: vec![NativePart {
            kind: None,
            text: None,
            id: "part_one".into(),
            call_id: Some("call_one".into()),
            tool: Some(tool.into()),
            state: Some(NativeToolState {
                status: status.into(),
                input,
                output: serde_json::Value::Null,
                metadata: serde_json::Value::Null,
            }),
        }],
    }
}

#[test]
fn file_artifact_requires_completed_tool_and_current_inside_file() -> TestResult<()> {
    let (root, record) = fixture()?;
    let file = root.join("summary.md");
    fs::write(&file, "summary").checked("write summary")?;
    let completed = collect(
        &record,
        &[message(
            "write",
            "completed",
            serde_json::json!({"filePath":file}),
        )],
    );
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].kind, ArtifactKind::File);
    assert!(completed[0].verified);
    fs::remove_file(&file).checked("remove summary")?;
    assert!(!current(completed[0].clone()).verified);
    assert_eq!(
        locate_with(&completed, "run_one", &completed[0].reference, |_| Ok(())),
        Err("agent_artifact_missing".into())
    );
    let failed = collect(
        &record,
        &[message(
            "write",
            "error",
            serde_json::json!({"filePath":root.join("missing.md")}),
        )],
    );
    assert!(!failed[0].verified);
    fs::remove_dir_all(root).checked("remove root")?;
    Ok(())
}

#[test]
fn spoofed_cross_run_outside_and_script_execution_fail_closed() -> TestResult<()> {
    let (root, record) = fixture()?;
    let outside = root
        .parent()
        .checked("parent")?
        .join(format!("outside-{}", uuid::Uuid::new_v4()));
    fs::write(&outside, "outside").checked("write outside")?;
    let escaped = collect(
        &record,
        &[message(
            "write",
            "completed",
            serde_json::json!({"filePath":outside}),
        )],
    );
    assert!(!escaped[0].verified);
    assert_eq!(
        locate_with(&escaped, "run_other", &escaped[0].reference, |_| Ok(())),
        Err("agent_artifact_unknown".into())
    );
    let script = root.join("sum.ts");
    fs::write(&script, "export const sum = () => 5;").checked("write script")?;
    let canonical_script = script.canonicalize().checked("canonical script")?;
    let script_artifact = collect(
        &record,
        &[message(
            "edit",
            "completed",
            serde_json::json!({"filePath":"sum.ts"}),
        )],
    );
    let mut located_script = false;
    locate_with(
        &script_artifact,
        "run_one",
        &script_artifact[0].reference,
        |path| {
            located_script = path == canonical_script;
            Ok(())
        },
    )?;
    assert!(located_script);
    let failed_command = collect(
        &record,
        &[message(
            "bash",
            "completed",
            serde_json::json!({"command":"bun sum.test.ts"}),
        )],
    );
    assert!(!failed_command[0].verified);
    let mut successful_message = message(
        "bash",
        "completed",
        serde_json::json!({"command":"bun sum.test.ts"}),
    );
    let Some(state) = successful_message.parts[0].state.as_mut() else {
        return Err("missing tool state".to_owned().into());
    };
    state.metadata = serde_json::json!({"exit":0});
    let command = collect(&record, &[successful_message]);
    assert!(command[0].verified);
    let mut called = false;
    assert_eq!(
        locate_with(&command, "run_one", &command[0].reference, |_| {
            called = true;
            Ok(())
        }),
        Err("agent_artifact_not_file".into())
    );
    assert!(!called);
    fs::remove_file(outside).checked("remove outside")?;
    fs::remove_dir_all(root).checked("remove root")?;
    Ok(())
}
