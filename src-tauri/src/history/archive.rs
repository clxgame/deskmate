use std::path::Path;

use super::{save_to_path, AgentHistorySnapshot, HistoryMessage, HistorySession};

pub(super) fn upsert_message(messages: &mut Vec<HistoryMessage>, incoming: HistoryMessage) {
    if let Some(id) = incoming.message_id.as_deref() {
        messages.retain(|message| {
            if message.message_id.as_deref() != Some(id) {
                return true;
            }
            match incoming.part_id.as_deref() {
                Some(part_id) => message.part_id.as_deref().is_some_and(|old| old != part_id),
                None => false,
            }
        });
    }
    messages.push(incoming);
    messages.sort_by(|left, right| {
        left.time
            .cmp(&right.time)
            .then_with(|| left.message_id.cmp(&right.message_id))
            .then_with(|| left.part_id.cmp(&right.part_id))
    });
}

pub(super) fn upsert_agent_snapshot(
    path: &Path,
    list: &mut Vec<HistorySession>,
    snapshot: AgentHistorySnapshot<'_>,
) -> Result<(), String> {
    let mut session = list
        .iter()
        .find(|session| session.id == snapshot.session_id)
        .cloned()
        .ok_or_else(|| "history_not_found".to_owned())?;
    let original = session.clone();
    if session.deleted {
        return Err("history_deleted".to_owned());
    }
    if session.origin_run_id.is_none() {
        return Err("history_agent_owned".to_owned());
    }
    merge_agent_messages(&mut session, snapshot.messages)?;
    if session == original {
        return Ok(());
    }
    save_to_path(path, list, session)
}

pub(super) fn merge_agent_messages(
    session: &mut HistorySession,
    messages: &[crate::agent::NativeMessage],
) -> Result<(), String> {
    for message in messages {
        let Some(role) = message
            .role
            .as_deref()
            .filter(|role| matches!(*role, "user" | "assistant"))
        else {
            continue;
        };
        let created = message
            .created
            .ok_or_else(|| "history_snapshot_invalid".to_owned())?;
        if message.id.is_empty() {
            return Err("history_snapshot_invalid".to_owned());
        }
        for part in message
            .parts
            .iter()
            .filter(|part| part.kind.as_deref() == Some("text"))
        {
            let text = part
                .text
                .as_deref()
                .ok_or_else(|| "history_snapshot_invalid".to_owned())?;
            if part.id.is_empty() {
                return Err("history_snapshot_invalid".to_owned());
            }
            upsert_message(
                &mut session.messages,
                HistoryMessage {
                    local_only: false,
                    role: role.to_owned(),
                    text: text.to_owned(),
                    time: created,
                    message_id: Some(message.id.clone()),
                    part_id: Some(part.id.clone()),
                },
            );
        }
    }
    session.updated = session
        .messages
        .last()
        .map_or(session.updated, |message| message.time);
    Ok(())
}


