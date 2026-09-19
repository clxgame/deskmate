pub(crate) mod artifacts;
#[cfg(test)]
mod artifacts_tests;
mod lifecycle;
#[cfg(test)]
mod lifecycle_contract_tests;
mod lifecycle_view;
mod opencode;
#[cfg(test)]
mod opencode_tests;
mod permissions;
#[cfg(test)]
mod permissions_escape_tests;
mod record_store;
#[cfg(test)]
mod recovery_permission_tests;
pub(crate) mod run_commands;
#[cfg(test)]
mod run_commands_tests;
pub(crate) mod scheduled;
#[cfg(test)]
mod scheduled_tests;
mod start_context;
#[cfg(test)]
mod test_support;
mod workspace;
#[cfg(test)]
mod workspace_tests;

pub(crate) use lifecycle::AgentRunState;
pub(crate) use permissions::AgentPermissionState;
use permissions::{AgentReply, PendingDecision};
pub(crate) use record_store::RunStore;
pub(crate) use run_commands::{interrupt_owned_run, recover_after_start};
use serde::Serialize;
use std::path::Path;
use tauri::Manager;
pub(crate) use workspace::opencode_wire_directory;

use crate::tool_permissions::runtime::{PermissionRequest, Reply};
use record_store::{NativeMessage, RunRecord};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPendingPermission {
    request_id: String,
    permission: String,
    patterns: Vec<String>,
    metadata: serde_json::Value,
    command: Option<String>,
    cwd: String,
}

struct PendingBatch {
    automatic: Vec<(PermissionRequest, Reply)>,
    waiting: Vec<AgentPendingPermission>,
}

fn process_pending(
    state: &AgentPermissionState,
    run_id: &str,
    requests: Vec<PermissionRequest>,
) -> Result<PendingBatch, String> {
    let mut batch = PendingBatch {
        automatic: Vec::new(),
        waiting: Vec::new(),
    };
    for request in requests {
        match state.accept(run_id, request.clone())? {
            PendingDecision::AllowOnce => batch.automatic.push((request, Reply::Once)),
            PendingDecision::Reject => batch.automatic.push((request, Reply::Reject)),
            PendingDecision::Ask(detail) => batch.waiting.push(AgentPendingPermission {
                request_id: request.id,
                permission: request.permission,
                patterns: request.patterns,
                metadata: request.metadata,
                command: detail.command,
                cwd: detail.cwd.to_string_lossy().into_owned(),
            }),
        }
    }
    Ok(batch)
}

fn process_reply(
    state: &AgentPermissionState,
    run_id: &str,
    request_id: &str,
    reply: AgentReply,
) -> Result<(PermissionRequest, Reply), String> {
    let request = state.take_reply(run_id, request_id)?;
    let reply = match reply {
        AgentReply::Once => Reply::Once,
        AgentReply::Reject => Reply::Reject,
    };
    Ok((request, reply))
}

const STALE_PERMISSION: &str = "agent_permission_stale";

fn process_current_reply(
    run_state: &AgentRunState,
    permission_state: &AgentPermissionState,
    run_id: &str,
    request_id: &str,
    reply: AgentReply,
    snapshot: impl FnOnce(&RunRecord) -> Result<Vec<NativeMessage>, String>,
    pending: impl FnOnce(&Path) -> Result<Vec<PermissionRequest>, String>,
    respond: impl FnOnce(&PermissionRequest, Reply, &Path) -> Result<(), String>,
) -> Result<(), String> {
    let record = run_state
        .active_record(run_id)
        .map_err(|_| STALE_PERMISSION.to_owned())?;
    let expected_session = record
        .session_id
        .clone()
        .ok_or_else(|| STALE_PERMISSION.to_owned())?;
    let messages = snapshot(&record)?;
    if run_state.reconcile(run_id, &messages).is_err() {
        let _ = permission_state.cancel_run(run_id);
        return Err(STALE_PERMISSION.to_owned());
    }
    let current = match run_state.active_record(run_id) {
        Ok(current) if current.session_id.as_deref() == Some(expected_session.as_str()) => current,
        _ => {
            let _ = permission_state.cancel_run(run_id);
            return Err(STALE_PERMISSION.to_owned());
        }
    };
    let request = pending(&current.workspace_path)?
        .into_iter()
        .find(|request| request.id == request_id && request.session_id == expected_session)
        .ok_or_else(|| STALE_PERMISSION.to_owned())?;
    let (owned, reply) = process_reply(permission_state, run_id, request_id, reply)
        .map_err(|_| STALE_PERMISSION.to_owned())?;
    if owned.id != request.id || owned.session_id != request.session_id {
        return Err(STALE_PERMISSION.to_owned());
    }
    respond(&request, reply, &current.workspace_path)
}

#[tauri::command]
pub(crate) async fn agent_permission_pending(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    run_id: String,
) -> Result<Vec<AgentPendingPermission>, String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let base = crate::tool_permissions::runtime::endpoint(&app);
        let workspace = app.state::<AgentRunState>().active_workspace(&run_id)?;
        let requests = crate::tool_permissions::runtime::pending_scoped(&base, &workspace)?;
        let batch = process_pending(&app.state::<AgentPermissionState>(), &run_id, requests)?;
        for (request, reply) in batch.automatic {
            crate::tool_permissions::runtime::respond_scoped(&base, &request, reply, &workspace)?;
        }
        Ok(batch.waiting)
    })
    .await
    .map_err(|_| "agent_permission_unavailable".to_owned())?
}

#[tauri::command]
pub(crate) async fn agent_permission_reply(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    run_id: String,
    request_id: String,
    reply: AgentReply,
) -> Result<(), String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AgentRunState>();
        let _operation = state.lock_operation()?;
        let settings = crate::agent::run_commands::current_start_settings(&app)?;
        let base = crate::tool_permissions::runtime::endpoint(&app);
        process_current_reply(
            &state,
            &app.state::<AgentPermissionState>(),
            &run_id,
            &request_id,
            reply,
            |record| {
                let session = record
                    .session_id
                    .as_deref()
                    .ok_or_else(|| STALE_PERMISSION.to_owned())?;
                crate::agent::run_commands::lifecycle_client(
                    &app,
                    &settings,
                    &record.workspace_path,
                )
                .snapshot(session)
            },
            |workspace| crate::tool_permissions::runtime::pending_scoped(&base, workspace),
            |request, reply, workspace| {
                crate::tool_permissions::runtime::respond_scoped(&base, request, reply, workspace)
            },
        )
    })
    .await
    .map_err(|_| "agent_permission_unavailable".to_owned())?
}

#[cfg(test)]
#[path = "agent/agent_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "agent/lifecycle_recovery_tests.rs"]
mod lifecycle_recovery_tests;
#[cfg(test)]
#[path = "agent/lifecycle_restart_tests.rs"]
mod lifecycle_restart_tests;
#[cfg(test)]
#[path = "agent/lifecycle_tests.rs"]
mod lifecycle_tests;
