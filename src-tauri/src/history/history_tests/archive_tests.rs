use super::{agent, temp_file};
use crate::{
    agent::{NativeMessage, NativePart},
    history::{upsert_agent_snapshot, AgentHistorySnapshot},
};
use std::fs;

fn text_message(id: &str, role: &str, created: Option<u64>) -> NativeMessage {
    NativeMessage {
        id: id.to_owned(),
        role: Some(role.to_owned()),
        created,
        parent_id: Some("msg-run".to_owned()),
        completed: true,
        finish: Some("stop".to_owned()),
        error: None,
        parts: vec![NativePart {
            id: format!("prt-{id}"),
            kind: Some("text".to_owned()),
            text: Some(format!("text-{id}")),
            call_id: None,
            tool: None,
            state: None,
        }],
    }
}

#[test]
fn native_snapshots_upsert_by_ids_in_stable_time_order() -> Result<(), String> {
    let path = temp_file("snapshot");
    let mut list = vec![agent("ses-agent")];
    let later = text_message("msg-two", "assistant", Some(20));
    let mut earlier = text_message("msg-one", "user", Some(10));
    earlier.parent_id = None;
    earlier.finish = None;
    upsert_agent_snapshot(
        &path,
        &mut list,
        AgentHistorySnapshot {
            session_id: "ses-agent",
            messages: &[later.clone(), earlier.clone(), later],
        },
    )?;
    upsert_agent_snapshot(
        &path,
        &mut list,
        AgentHistorySnapshot {
            session_id: "ses-agent",
            messages: &[earlier],
        },
    )?;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].messages.len(), 2);
    assert_eq!(list[0].messages[0].message_id.as_deref(), Some("msg-one"));
    assert_eq!(list[0].messages[1].part_id.as_deref(), Some("prt-msg-two"));
    assert_eq!(list[0].updated, 20);
    fs::remove_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn later_run_snapshot_keeps_first_trusted_origin() -> Result<(), String> {
    let path = temp_file("continued-session");
    let mut list = vec![agent("ses-agent")];
    let mut reply = text_message("msg-reply", "assistant", Some(20));
    reply.parent_id = Some("msg-second-run".to_owned());
    upsert_agent_snapshot(
        &path,
        &mut list,
        AgentHistorySnapshot {
            session_id: "ses-agent",
            messages: &[reply],
        },
    )?;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].origin_run_id.as_deref(), Some("msg_origin"));
    assert_eq!(list[0].messages.len(), 1);
    fs::remove_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn malformed_native_text_does_not_mutate_history() {
    let path = temp_file("malformed-snapshot");
    let mut list = vec![agent("ses-agent")];
    let malformed = text_message("msg-reply", "assistant", None);
    assert_eq!(
        upsert_agent_snapshot(
            &path,
            &mut list,
            AgentHistorySnapshot {
                session_id: "ses-agent",
                messages: &[malformed],
            },
        ),
        Err("history_snapshot_invalid".to_owned())
    );
    assert!(list[0].messages.is_empty());
    assert!(!path.exists());
}

#[test]
fn unchanged_snapshot_does_not_touch_storage() -> Result<(), String> {
    let path = temp_file("unchanged-snapshot");
    let mut list = vec![agent("ses-agent")];
    let reply = text_message("msg-reply", "assistant", Some(20));
    upsert_agent_snapshot(
        &path,
        &mut list,
        AgentHistorySnapshot {
            session_id: "ses-agent",
            messages: &[reply.clone()],
        },
    )?;
    fs::remove_file(&path).map_err(|error| error.to_string())?;
    fs::create_dir(&path).map_err(|error| error.to_string())?;
    upsert_agent_snapshot(
        &path,
        &mut list,
        AgentHistorySnapshot {
            session_id: "ses-agent",
            messages: &[reply],
        },
    )?;
    assert_eq!(list[0].messages.len(), 1);
    fs::remove_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}
