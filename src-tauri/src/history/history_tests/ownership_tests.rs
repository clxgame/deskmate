use super::{agent, ordinary, temp_file};
use crate::history::{
    continuation_origin, delete_from_path, save_renderer_to_path, upsert_agent_snapshot,
    AgentHistorySnapshot, DeleteHistory, HistoryState, RendererHistorySave,
};
use std::fs;
use std::sync::Mutex;

#[test]
fn renderer_cannot_impersonate_or_overwrite_agent_history() {
    let path = temp_file("ownership");
    let mut list = vec![agent("ses-agent")];
    let mut overwrite = ordinary("ses-agent");
    overwrite.title = "forged".to_owned();
    assert_eq!(
        save_renderer_to_path(
            &path,
            &mut list,
            RendererHistorySave {
                session: overwrite,
                trusted_origin_run_id: None,
            },
        ),
        Err("history_agent_owned".to_owned())
    );
    let mut impersonation = ordinary("ses-new");
    impersonation.origin_run_id = Some("msg_fake".to_owned());
    assert_eq!(
        save_renderer_to_path(
            &path,
            &mut list,
            RendererHistorySave {
                session: impersonation,
                trusted_origin_run_id: None,
            },
        ),
        Err("history_agent_owned".to_owned())
    );
    assert_eq!(list[0].title, "chat");
}

#[test]
fn renderer_cannot_create_history_for_persisted_agent_session() {
    let path = temp_file("trusted-ownership");
    let mut list = Vec::new();
    assert_eq!(
        save_renderer_to_path(
            &path,
            &mut list,
            RendererHistorySave {
                session: ordinary("ses-agent-before-history"),
                trusted_origin_run_id: Some("msg-trusted"),
            },
        ),
        Err("history_agent_owned".to_owned())
    );
    assert!(list.is_empty());
}

#[test]
fn continuation_requires_trusted_live_agent_history() {
    let state = HistoryState(Mutex::new(vec![
        agent("ses-agent"),
        ordinary("ordinary"),
        {
            let mut deleted = agent("ses-deleted");
            deleted.deleted = true;
            deleted
        },
    ]));
    assert_eq!(
        continuation_origin(&state, "ses-agent").as_deref(),
        Ok("msg_origin")
    );
    assert_eq!(
        continuation_origin(&state, "ordinary"),
        Err("history_not_agent_owned".into())
    );
    assert_eq!(
        continuation_origin(&state, "ses-deleted"),
        Err("history_deleted".into())
    );
    assert_eq!(
        continuation_origin(&state, "../spoof"),
        Err("history_id_invalid".into())
    );
}

#[test]
fn agent_delete_tombstone_cannot_be_resurrected_and_active_delete_is_rejected() -> Result<(), String>
{
    let path = temp_file("delete");
    let mut list = vec![agent("ses-agent")];
    let active = DeleteHistory {
        id: "ses-agent",
        trusted_origin_run_id: Some("msg_origin"),
        active: true,
    };
    assert_eq!(
        delete_from_path(&path, &mut list, active),
        Err("history_agent_running".to_owned())
    );
    assert!(!list[0].deleted);
    let stopped = DeleteHistory {
        id: "ses-agent",
        trusted_origin_run_id: Some("msg_origin"),
        active: false,
    };
    delete_from_path(&path, &mut list, stopped)?;
    assert!(list[0].deleted);
    assert!(list[0].title.is_empty());
    assert!(list[0].messages.is_empty());
    assert_eq!(
        upsert_agent_snapshot(
            &path,
            &mut list,
            AgentHistorySnapshot {
                session_id: "ses-agent",
                messages: &[],
            },
        ),
        Err("history_deleted".to_owned())
    );
    delete_from_path(
        &path,
        &mut list,
        DeleteHistory {
            id: "ses-agent",
            trusted_origin_run_id: Some("msg_origin"),
            active: false,
        },
    )?;
    assert!(list[0].deleted);
    fs::remove_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn ordinary_delete_remains_physical() -> Result<(), String> {
    let path = temp_file("ordinary-delete");
    let mut list = vec![ordinary("chat")];
    delete_from_path(
        &path,
        &mut list,
        DeleteHistory {
            id: "chat",
            trusted_origin_run_id: None,
            active: false,
        },
    )?;
    assert!(list.is_empty());
    fs::remove_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn persisted_agent_ownership_turns_legacy_collision_into_tombstone() -> Result<(), String> {
    let path = temp_file("trusted-delete");
    let mut list = vec![ordinary("ses-agent")];
    delete_from_path(
        &path,
        &mut list,
        DeleteHistory {
            id: "ses-agent",
            trusted_origin_run_id: Some("msg-origin"),
            active: false,
        },
    )?;
    assert_eq!(list.len(), 1);
    assert!(list[0].deleted);
    assert_eq!(list[0].origin_run_id.as_deref(), Some("msg-origin"));
    fs::remove_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}
