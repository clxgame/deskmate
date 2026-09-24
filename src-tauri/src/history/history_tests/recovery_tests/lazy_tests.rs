use super::{
    super::{agent, temp_file},
    record, text_message,
};
use crate::history::recovery::{
    apply_lazy_snapshot, details_for, prepare_lazy_read, AgentHistorySource, AgentHistoryStatus,
    DetailAvailability, LazyReadPlan, LazySnapshot,
};
use crate::history::HistoryMessage;
use std::fs;

#[test]
fn lazy_read_uses_only_the_recorded_origin_workspace_and_session() -> Result<(), String> {
    let path = temp_file("recovery-lazy-plan");
    let workspace = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(workspace).map_err(|error| error.to_string())?;
    let list = vec![agent("ses_exact")];
    let records = vec![record(
        "msg_origin",
        Some("ses_exact"),
        workspace,
        "2026-01-01T00:00:00Z",
    )];

    let plan = prepare_lazy_read(&list, &records, "ses_exact")?;
    assert!(matches!(plan, LazyReadPlan::Fetch { .. }));
    let LazyReadPlan::Fetch { target, .. } = plan else {
        return Err("missing fetch target".to_owned());
    };
    assert_eq!(target.workspace_path, workspace);
    assert_eq!(target.session_id, "ses_exact");
    assert_eq!(target.run_id, "msg_origin");
    assert_eq!(
        prepare_lazy_read(&list, &records, "ses_other"),
        Ok(LazyReadPlan::Absent)
    );
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn same_named_and_moved_workspaces_never_borrow_another_path() -> Result<(), String> {
    let path = temp_file("recovery-workspace-identity");
    let root = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    let first = root.join("first").join("shared");
    let second = root.join("second").join("shared");
    fs::create_dir_all(&first).map_err(|error| error.to_string())?;
    fs::create_dir_all(&second).map_err(|error| error.to_string())?;
    let records = vec![
        record(
            "msg_first",
            Some("ses_first"),
            &first,
            "2026-01-01T00:00:00Z",
        ),
        record(
            "msg_second",
            Some("ses_second"),
            &second,
            "2026-01-01T00:01:00Z",
        ),
    ];
    let list = vec![
        crate::history::HistorySession {
            local_link: None,
            id: "ses_first".to_owned(),
            origin_run_id: Some("msg_first".to_owned()),
            ..agent("ses_first")
        },
        crate::history::HistorySession {
            local_link: None,
            id: "ses_second".to_owned(),
            origin_run_id: Some("msg_second".to_owned()),
            ..agent("ses_second")
        },
    ];
    let LazyReadPlan::Fetch { target } = prepare_lazy_read(&list, &records, "ses_first")? else {
        return Err("expected first fetch".to_owned());
    };
    assert_eq!(target.workspace_path, first);
    fs::remove_dir_all(&first).map_err(|error| error.to_string())?;
    assert_eq!(
        prepare_lazy_read(&list, &records, "ses_first")?,
        LazyReadPlan::WorkspaceMissing
    );
    fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn lazy_success_fills_native_text_and_first_question_title() -> Result<(), String> {
    let path = temp_file("recovery-lazy-success");
    let workspace = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(workspace).map_err(|error| error.to_string())?;
    let mut list = vec![agent("ses_exact")];
    let target = match prepare_lazy_read(
        &list,
        &[record(
            "msg_origin",
            Some("ses_exact"),
            workspace,
            "2026-01-01T00:00:00Z",
        )],
        "ses_exact",
    )? {
        LazyReadPlan::Fetch { target } => target,
        _ => return Err("expected fetch".to_owned()),
    };
    let messages = [
        text_message("msg_user", "user", "Original request", 10),
        text_message("msg_reply", "assistant", "Recovered answer", 20),
    ];

    let loaded = apply_lazy_snapshot(
        &path,
        &mut list,
        LazySnapshot {
            target: &target,
            messages: &messages,
        },
    )?;

    assert_eq!(loaded.title, "Original request");
    assert_eq!(loaded.messages.len(), 2);
    assert_eq!(loaded.messages[1].text, "Recovered answer");
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn existing_text_skips_lazy_fetch_and_late_result_cannot_revive_delete() -> Result<(), String> {
    let path = temp_file("recovery-late-delete");
    let workspace = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(workspace).map_err(|error| error.to_string())?;
    let records = [record(
        "msg_origin",
        Some("ses_exact"),
        workspace,
        "2026-01-01T00:00:00Z",
    )];
    let mut with_text = vec![agent("ses_exact")];
    with_text[0].messages.push(HistoryMessage {
        local_only: false,
        role: "assistant".to_owned(),
        text: "kept".to_owned(),
        time: 1,
        message_id: Some("msg_kept".to_owned()),
        part_id: Some("prt_kept".to_owned()),
    });
    assert_eq!(
        prepare_lazy_read(&with_text, &records, "ses_exact")?,
        LazyReadPlan::Ready
    );

    let mut deleted = vec![agent("ses_exact")];
    let target = match prepare_lazy_read(&deleted, &records, "ses_exact")? {
        LazyReadPlan::Fetch { target } => target,
        _ => return Err("expected fetch".to_owned()),
    };
    deleted[0].deleted = true;
    deleted[0].messages.clear();
    assert_eq!(
        apply_lazy_snapshot(
            &path,
            &mut deleted,
            LazySnapshot {
                target: &target,
                messages: &[text_message("msg_reply", "assistant", "late", 2)],
            },
        ),
        Err("history_deleted".to_owned())
    );
    assert!(deleted[0].messages.is_empty());
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn recovered_metadata_marks_scheduled_source_and_missing_details() -> Result<(), String> {
    let path = temp_file("recovery-metadata");
    let workspace = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(workspace).map_err(|error| error.to_string())?;
    let records = [record(
        "msg_schedule_due",
        Some("ses_scheduled"),
        workspace,
        "2026-01-01T00:00:00Z",
    )];
    let details = details_for(&records, "ses_scheduled", DetailAvailability::Missing)
        .ok_or_else(|| "missing metadata".to_owned())?;
    assert_eq!(details.workspace_path, workspace);
    assert_eq!(details.status, AgentHistoryStatus::Completed);
    assert_eq!(details.source, AgentHistorySource::Scheduled);
    assert!(matches!(details.availability, DetailAvailability::Missing));
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())?;
    Ok(())
}



