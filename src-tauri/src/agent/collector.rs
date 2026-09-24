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
        if current.pending_outcome != candidate.pending_outcome {
            return Ok(());
        }
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
            Err(error) => {
                eprintln!("agent snapshot {}: {error}", candidate.run_id);
                let summary = match error.as_str() {
                    "agent_tool_timeout" | "agent_tools_unsettled" => error.as_str(),
                    _ => "agent_read_failed",
                };
                state.set_collection_error(&candidate.run_id, Some(summary))?;
                reported_error = Some(summary.to_owned());
            }
            Ok(SnapshotRead::Messages(messages)) => {
                if current.pending_outcome.is_some()
                    && messages.iter().any(|message| {
                        message.parent_id.as_deref() == Some(&current.run_id)
                            && super::supervision::in_flight(message)
                    })
                {
                    return Err("agent_tools_unsettled".into());
                }
                if let Err(error) = (actions.archive)(&current, &messages) {
                    eprintln!("agent archive {}: {error}", candidate.run_id);
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
                        if current.pending_outcome != candidate.pending_outcome {
                            return Ok(());
                        }
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
                            Err(error) => {
                                state.set_collection_error(&candidate.run_id, Some(&error))?;
                                reported_error = Some(error);
                            }
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
            if let Err(error) = (actions.respond)(&candidate, &request, reply) {
                if error != "permission_expired" {
                    return Err(error);
                }
                eprintln!("agent permission {} already settled", request.id);
            }
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
    let candidate = state.read()?.active;
    let result = collect_once_with(
        &state,
        &permissions,
        CollectorActions {
            snapshot: |record: &RunRecord| {
                if !crate::sidecar_owned_running(app)? {
                    let _operation = state.lock_operation()?;
                    if !state.matches_active(record)? {
                        return Ok(SnapshotRead::Messages(Vec::new()));
                    }
                    let current = state.active_record(&record.run_id)?;
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
                    let messages = super::supervision::settle(
                        app,
                        &current,
                        error.as_deref().unwrap_or("agent_cancelled"),
                    )?;
                    state.request_finish(&current.run_id, outcome, error)?;
                    return Ok(SnapshotRead::Messages(messages));
                }
                let settings = super::run_commands::current_start_settings(app)?;
                super::supervision::snapshot(
                    &super::run_commands::lifecycle_client(app, &settings, &record.workspace_path),
                    &state,
                    record,
                )
                .map(SnapshotRead::Messages)
            },
            pending: |record: &RunRecord| {
                if mode == CollectionMode::Recovery {
                    Ok(Vec::new())
                } else {
                    let session = record
                        .session_id
                        .as_deref()
                        .ok_or_else(|| "agent_session_unknown".to_owned())?;
                    crate::tool_permissions::runtime::pending_scoped_live(
                        app,
                        &record.workspace_path,
                        session,
                    )
                }
            },
            archive: |record: &RunRecord, messages: &[NativeMessage]| {
                let session = record
                    .session_id
                    .as_deref()
                    .ok_or_else(|| "agent_session_unknown".to_owned())?;
                crate::history::save_agent_snapshot(
                    app,
                    &record.workspace_path,
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
    );
    if let Err(ref error) = result {
        if let Some(candidate) = candidate {
            super::supervision::collection_failed(app, &candidate, error)?;
        }
    } else {
        *state
            .collection_failure
            .lock()
            .map_err(|_| "agent_state_unavailable")? = None;
    }
    result
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

