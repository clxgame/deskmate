use super::{
    super::{agent, ordinary, temp_file},
    record,
};
use crate::{
    agent::{AgentRunState, RunStore},
    history::recovery::{index_agent_records, AgentHistoryStatus},
};
use std::fs;

#[test]
fn list_summary_derives_agent_workspace_and_status_from_run_records() -> Result<(), String> {
    let workspace = std::env::temp_dir().join("summary-workspace");
    let records = vec![record(
        "msg_origin",
        Some("ses_agent"),
        &workspace,
        "2026-01-01T00:00:00Z",
    )];
    let summaries = crate::history::view::history_summaries(
        &[agent("ses_agent"), ordinary("ordinary")],
        &records,
    )?;
    let agent_summary = summaries
        .iter()
        .find(|item| item.id == "ses_agent")
        .ok_or("missing agent")?;
    let details = agent_summary
        .agent_details
        .as_ref()
        .ok_or("missing details")?;
    assert_eq!(details.workspace_path, workspace);
    assert_eq!(details.status, AgentHistoryStatus::Completed);
    assert!(summaries
        .iter()
        .find(|item| item.id == "ordinary")
        .ok_or("missing ordinary")?
        .agent_details
        .is_none());
    Ok(())
}

#[test]
fn startup_indexes_every_session_and_is_idempotent() -> Result<(), String> {
    let path = temp_file("recovery-index");
    let workspace = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(workspace).map_err(|error| error.to_string())?;
    let mut records = (0..25)
        .map(|index| {
            record(
                &format!("msg_{index:02}"),
                Some(&format!("ses_{index:02}")),
                workspace,
                &format!("2026-01-01T00:{index:02}:00Z"),
            )
        })
        .collect::<Vec<_>>();
    records.push(record(
        "msg_later",
        Some("ses_00"),
        workspace,
        "2026-01-02T00:00:00Z",
    ));
    let mut list = vec![ordinary("ordinary")];

    index_agent_records(&path, &mut list, &records)?;
    let first = fs::read(&path).map_err(|error| error.to_string())?;
    index_agent_records(&path, &mut list, &records)?;

    assert_eq!(
        list.iter()
            .filter(|item| item.origin_run_id.is_some())
            .count(),
        25
    );
    let merged = list
        .iter()
        .find(|item| item.id == "ses_00")
        .ok_or_else(|| "missing merged session".to_owned())?;
    assert_eq!(merged.origin_run_id.as_deref(), Some("msg_00"));
    assert!(merged.messages.is_empty());
    assert_eq!(fs::read(&path).map_err(|error| error.to_string())?, first);
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn startup_source_reads_all_run_files_including_multiple_unfinished_records() -> Result<(), String>
{
    let path = temp_file("recovery-all-run-files");
    let root = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    let workspace = root.join("workspace");
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    let store = RunStore::new(root.join("agent-runs"));
    for index in 0..22 {
        let mut item = record(
            &format!("msg_unfinished_{index:02}"),
            Some(&format!("ses_unfinished_{index:02}")),
            &workspace,
            &format!("2026-01-01T00:{index:02}:00Z"),
        );
        item.outcome = None;
        item.ended_at = None;
        store.write(&item)?;
    }
    let runs = AgentRunState::load(store)?;
    let records = runs.all_records()?;
    let mut list = Vec::new();
    index_agent_records(&path, &mut list, &records)?;
    assert_eq!(records.len(), 22);
    assert_eq!(list.len(), 22);
    fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn startup_never_resurrects_tombstones_or_fabricates_no_session_chats() -> Result<(), String> {
    let path = temp_file("recovery-tombstone");
    let workspace = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(workspace).map_err(|error| error.to_string())?;
    let mut deleted = agent("ses_deleted");
    deleted.deleted = true;
    deleted.title.clear();
    deleted.messages.clear();
    let mut list = vec![deleted];
    let records = vec![
        record(
            "msg_deleted",
            Some("ses_deleted"),
            workspace,
            "2026-01-01T00:00:00Z",
        ),
        record("msg_receipt", None, workspace, "2026-01-01T00:01:00Z"),
    ];

    index_agent_records(&path, &mut list, &records)?;

    assert_eq!(list.len(), 1);
    assert!(list[0].deleted);
    assert!(list[0].messages.is_empty());
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn startup_index_write_failure_keeps_memory_unchanged() -> Result<(), String> {
    let path = temp_file("recovery-write-failure");
    let workspace = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(workspace).map_err(|error| error.to_string())?;
    fs::create_dir(&path).map_err(|error| error.to_string())?;
    let mut list = vec![ordinary("ordinary")];
    let original = list.clone();
    assert_eq!(
        index_agent_records(
            &path,
            &mut list,
            &[record(
                "msg_origin",
                Some("ses_new"),
                workspace,
                "2026-01-01T00:00:00Z",
            )],
        ),
        Err("history_storage_unavailable".to_owned())
    );
    assert_eq!(list, original);
    fs::remove_dir_all(workspace).map_err(|error| error.to_string())?;
    Ok(())
}
