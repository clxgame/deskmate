use super::{
    lifecycle::AgentRunState,
    permissions::AgentPermissionState,
    record_store::{NativeMessage, RunOutcome, RunRecord},
    AgentPendingPermission,
};
use crate::tool_permissions::runtime::{PermissionRequest, Reply};
use tauri::Manager;

pub(super) enum SnapshotRead {
    Messages(Vec<NativeMessage>),
    SidecarLost,
}

pub(super) struct CollectorActions<S, P, A, R> {
    pub(super) snapshot: S,
    pub(super) pending: P,
    pub(super) archive: A,
    pub(super) respond: R,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollectionMode {
    Live,
    Recovery,
}

pub(super) fn collect_once_with<S, P, A, R>(
    state: &AgentRunState,
    permissions: &AgentPermissionState,
    mut actions: CollectorActions<S, P, A, R>,
) -> Result<(), String>
where
    S: FnOnce(&RunRecord) -> Result<SnapshotRead, String>,
    P: FnOnce(&RunRecord) -> Result<Vec<PermissionRequest>, String>,
    A: FnOnce(&RunRecord, &[NativeMessage]) -> Result<(), String>,
    R: FnMut(&RunRecord, &PermissionRequest, Reply) -> Result<(), String>,
{
    let Some(candidate) = state.read()?.active else {
        return Ok(());
    };
    if candidate.initial_input.is_some() || candidate.session_id.is_none() {
        return Ok(());
    }

    let snapshot = (actions.snapshot)(&candidate);
    let pending = if matches!(snapshot, Ok(SnapshotRead::SidecarLost))
        || candidate.pending_outcome.is_some()
    {
        None
    } else {
        Some((actions.pending)(&candidate))
    };
    let mut automatic = Vec::new();
    let mut reported_error = None;
    {
        let _operation = state.lock_operation()?;
        if !state.matches_active(&candidate)? {
            return Ok(());
        }
        let current = state.active_record(&candidate.run_id)?;
        if matches!(snapshot, Ok(SnapshotRead::SidecarLost)) {
            let (outcome, error) = current
                .pending_outcome
                .clone()
                .map(|outcome| (outcome, current.pending_error_summary.clone()))
                .unwrap_or_else(|| {
                    (
                        RunOutcome::Interrupted,
                        Some("sidecar_process_lost".to_owned()),
                    )
                });
            state.finish(&candidate.run_id, outcome, error)?;
            let _ = permissions.cancel_run(&candidate.run_id);
            return Ok(());
        }

        match snapshot {
            Err(_) => {
                state.set_collection_error(&candidate.run_id, Some("agent_read_failed"))?;
                reported_error = Some("agent_read_failed".to_owned());
            }
            Ok(SnapshotRead::Messages(messages)) => {
                if (actions.archive)(&current, &messages).is_err() {
                    state
                        .set_collection_error(&candidate.run_id, Some("history_storage_failed"))?;
                    reported_error = Some("history_storage_failed".to_owned());
                } else {
                    state.set_collection_error(&candidate.run_id, None)?;
                    if let Some(outcome) = current.pending_outcome.clone() {
                        state.finish(
                            &candidate.run_id,
                            outcome,
                            current.pending_error_summary.clone(),
                        )?;
                    } else {
                        state.reconcile(&candidate.run_id, &messages)?;
                    }
                    if state.active_record(&candidate.run_id).is_err() {
                        let _ = permissions.cancel_run(&candidate.run_id);
                    } else if let Some(pending) = pending {
                        let current = state.active_record(&candidate.run_id)?;
                        match pending.and_then(|requests| {
                            super::process_pending(
                                permissions,
                                &current.run_id,
                                &current.message_ids,
                                &current.call_ids,
                                requests,
                            )
                        }) {
                            Ok(replies) => automatic = replies,
                            Err(error) => reported_error = Some(error),
                        }
                    }
                }
            }
            Ok(SnapshotRead::SidecarLost) => return Ok(()),
        }
    }

    if state.matches_active(&candidate)? {
        for (request, reply) in automatic {
            if !state.matches_active(&candidate)? {
                break;
            }
            (actions.respond)(&candidate, &request, reply)?;
        }
    }
    match reported_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

pub(crate) fn collect_active_run_once(
    app: &tauri::AppHandle,
    mode: CollectionMode,
) -> Result<(), String> {
    let state = app.state::<AgentRunState>();
    let permissions = app.state::<AgentPermissionState>();
    let base = crate::tool_permissions::runtime::endpoint(app);
    collect_once_with(
        &state,
        &permissions,
        CollectorActions {
            snapshot: |record: &RunRecord| {
                if !crate::sidecar_owned_running(app)? {
                    return Ok(SnapshotRead::SidecarLost);
                }
                let session = record
                    .session_id
                    .as_deref()
                    .ok_or_else(|| "agent_session_unknown".to_owned())?;
                let settings = super::run_commands::current_start_settings(app)?;
                super::run_commands::lifecycle_client(app, &settings, &record.workspace_path)
                    .snapshot(session)
                    .map(SnapshotRead::Messages)
            },
            pending: |record: &RunRecord| {
                if mode == CollectionMode::Recovery {
                    Ok(Vec::new())
                } else {
                    crate::tool_permissions::runtime::pending_scoped(&base, &record.workspace_path)
                }
            },
            archive: |record: &RunRecord, messages: &[NativeMessage]| {
                let session = record
                    .session_id
                    .as_deref()
                    .ok_or_else(|| "agent_session_unknown".to_owned())?;
                crate::history::save_agent_snapshot(
                    app,
                    &app.state::<crate::history::HistoryState>(),
                    crate::history::AgentHistorySnapshot {
                        session_id: session,
                        messages,
                    },
                )
            },
            respond: |record: &RunRecord, request: &PermissionRequest, reply: Reply| {
                crate::tool_permissions::runtime::respond_scoped(
                    &base,
                    request,
                    reply,
                    &record.workspace_path,
                )
            },
        },
    )
}

pub(crate) fn start_collector(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(error) = collect_active_run_once(&app, CollectionMode::Live) {
            eprintln!("agent collector: {error}");
        }
    });
}

pub(super) fn cached_permissions(
    permissions: &AgentPermissionState,
    run_id: &str,
) -> Result<Vec<AgentPendingPermission>, String> {
    permissions
        .waiting(run_id)?
        .into_iter()
        .map(|waiting| {
            Ok(AgentPendingPermission {
                always: crate::tool_permissions::rememberable_agent_patterns(&waiting.request)
                    .unwrap_or_default()
                    .to_vec(),
                request_id: waiting.request.id,
                permission: waiting.request.permission,
                patterns: waiting.request.patterns,
                metadata: waiting.request.metadata,
                command: waiting.detail.command,
                cwd: waiting.detail.cwd.to_string_lossy().into_owned(),
            })
        })
        .collect()
}
