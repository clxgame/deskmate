use super::{archive::merge_agent_messages, save_to_path, storage::persist_path, HistorySession};
use crate::agent::{NativeMessage, RunOutcome, RunRecord};
use std::{collections::BTreeMap, path::Path};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct LazyReadTarget {
    pub(super) run_id: String,
    pub(super) session_id: String,
    pub(super) workspace_path: std::path::PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum LazyReadPlan {
    Absent,
    Ready,
    WorkspaceMissing,
    Fetch { target: LazyReadTarget },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DetailAvailability {
    Ready,
    Retryable,
    Missing,
    WorkspaceMissing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentHistoryStatus {
    Active,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentHistorySource {
    Interactive,
    Scheduled,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentHistoryDetails {
    pub(crate) workspace_path: std::path::PathBuf,
    pub(crate) status: AgentHistoryStatus,
    pub(crate) source: AgentHistorySource,
    pub(crate) availability: DetailAvailability,
}

pub(super) struct LazySnapshot<'a> {
    pub(super) target: &'a LazyReadTarget,
    pub(super) messages: &'a [NativeMessage],
}

fn time_millis(value: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .and_then(|time| u64::try_from(time.timestamp_millis()).ok())
        .unwrap_or_default()
}

fn placeholder_title(record: &RunRecord) -> String {
    let workspace = record
        .workspace_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Workspace");
    format!("{workspace} · {}", record.created_at)
}

pub(super) fn index_agent_records(
    path: &Path,
    list: &mut Vec<HistorySession>,
    records: &[RunRecord],
) -> Result<(), String> {
    let mut next = list.clone();
    let mut grouped: BTreeMap<&str, Vec<&RunRecord>> = BTreeMap::new();
    for record in records {
        let Some(session_id) = record.session_id.as_deref() else {
            continue;
        };
        if !crate::worklog::bridge::safe_id(session_id)
            || !crate::worklog::bridge::safe_id(&record.run_id)
        {
            continue;
        }
        grouped.entry(session_id).or_default().push(record);
    }

    for (session_id, group) in grouped {
        let Some(origin) = group.iter().min_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.run_id.cmp(&right.run_id))
        }) else {
            continue;
        };
        if let Some(existing) = next.iter_mut().find(|item| item.id == session_id) {
            if !existing.deleted {
                existing.origin_run_id = Some(origin.run_id.clone());
            }
            continue;
        }
        let created = time_millis(&origin.created_at);
        let updated = group
            .iter()
            .map(|record| time_millis(record.ended_at.as_deref().unwrap_or(&record.created_at)))
            .max()
            .unwrap_or(created);
        next.push(HistorySession {
            id: session_id.to_owned(),
            title: placeholder_title(origin),
            created,
            updated,
            messages: Vec::new(),
            origin_run_id: Some(origin.run_id.clone()),
            deleted: false,
        });
    }
    next.sort_by(|left, right| right.updated.cmp(&left.updated));
    if next == *list {
        return Ok(());
    }
    persist_path(path, &next)?;
    *list = next;
    Ok(())
}

pub(super) fn prepare_lazy_read(
    list: &[HistorySession],
    records: &[RunRecord],
    id: &str,
) -> Result<LazyReadPlan, String> {
    let Some(session) = list
        .iter()
        .find(|session| session.id == id && !session.deleted)
    else {
        return Ok(LazyReadPlan::Absent);
    };
    let Some(origin_run_id) = session.origin_run_id.as_deref() else {
        return Ok(LazyReadPlan::Ready);
    };
    if !session.messages.is_empty() {
        return Ok(LazyReadPlan::Ready);
    }
    let Some(record) = records
        .iter()
        .find(|record| record.run_id == origin_run_id && record.session_id.as_deref() == Some(id))
    else {
        return Ok(LazyReadPlan::Ready);
    };
    if !record.workspace_path.is_dir() {
        return Ok(LazyReadPlan::WorkspaceMissing);
    }
    Ok(LazyReadPlan::Fetch {
        target: LazyReadTarget {
            run_id: record.run_id.clone(),
            session_id: id.to_owned(),
            workspace_path: record.workspace_path.clone(),
        },
    })
}

pub(super) fn apply_lazy_snapshot(
    path: &Path,
    list: &mut Vec<HistorySession>,
    snapshot: LazySnapshot<'_>,
) -> Result<HistorySession, String> {
    let mut session = list
        .iter()
        .find(|session| session.id == snapshot.target.session_id)
        .cloned()
        .ok_or_else(|| "history_not_found".to_owned())?;
    if session.deleted {
        return Err("history_deleted".to_owned());
    }
    if session.origin_run_id.as_deref() != Some(&snapshot.target.run_id) {
        return Err("history_agent_origin_changed".to_owned());
    }
    let original = session.clone();
    merge_agent_messages(&mut session, snapshot.messages)?;
    if let Some(first_user) = session
        .messages
        .iter()
        .find(|message| message.role == "user" && !message.text.trim().is_empty())
    {
        session.title = first_user.text.chars().take(40).collect();
    }
    if session != original {
        save_to_path(path, list, session.clone())?;
    }
    Ok(session)
}

pub(super) fn details_for(
    records: &[RunRecord],
    session_id: &str,
    availability: DetailAvailability,
) -> Option<AgentHistoryDetails> {
    let latest = records
        .iter()
        .filter(|record| record.session_id.as_deref() == Some(session_id))
        .max_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.run_id.cmp(&right.run_id))
        })?;
    let status = match latest.outcome {
        None => AgentHistoryStatus::Active,
        Some(RunOutcome::Completed) => AgentHistoryStatus::Completed,
        Some(RunOutcome::Failed) => AgentHistoryStatus::Failed,
        Some(RunOutcome::Cancelled) => AgentHistoryStatus::Cancelled,
        Some(RunOutcome::Interrupted) => AgentHistoryStatus::Interrupted,
    };
    Some(AgentHistoryDetails {
        workspace_path: latest.workspace_path.clone(),
        status,
        source: if latest.run_id.starts_with("msg_schedule_") {
            AgentHistorySource::Scheduled
        } else {
            AgentHistorySource::Interactive
        },
        availability,
    })
}
