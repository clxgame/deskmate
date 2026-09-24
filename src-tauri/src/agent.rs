pub(crate) mod artifacts;
#[cfg(test)]
mod artifacts_tests;
mod collector;
#[cfg(test)]
mod collector_tests;
mod continuation;
mod lifecycle;
#[cfg(test)]
mod lifecycle_contract_tests;
mod lifecycle_finish;
mod lifecycle_view;
mod opencode;
#[cfg(test)]
mod opencode_tests;
#[cfg(test)]
mod opencode_wire_tests;
mod permission_policy;
mod permission_provenance;
mod permissions;
#[cfg(test)]
mod permissions_escape_tests;
mod record_store;
mod recovery;
#[cfg(test)]
mod recovery_permission_tests;
pub(crate) mod run_commands;
#[cfg(test)]
mod run_commands_tests;
pub(crate) mod scheduled;
#[cfg(test)]
mod scheduled_tests;
mod start_context;
mod supervision;
#[cfg(test)]
mod test_support;
mod workspace;
#[cfg(test)]
mod workspace_tests;

pub(crate) use collector::start_collector;
pub(crate) use lifecycle::AgentRunState;
pub(crate) use permissions::AgentPermissionState;
use permissions::PendingDecision;
#[cfg(test)]
pub(crate) use record_store::NativePart;
pub(crate) use record_store::{NativeMessage, RunOutcome, RunRecord, RunStore};
pub(crate) use recovery::{read_session_snapshot, recover_after_start};
pub(crate) use run_commands::interrupt_owned_run;
use serde::{Deserialize, Serialize};
use tauri::Manager;
pub(crate) use workspace::opencode_wire_directory;

use crate::tool_permissions::runtime::{PermissionRequest, Reply};

pub(crate) fn abort_managed_session(
    app: &tauri::AppHandle,
    directory: &str,
    session_id: &str,
) -> Result<(), String> {
    crate::history::commands::client(app)?
        .get(directory, session_id)
        .map_err(|error| error.to_string())?;
    let workspace = std::path::PathBuf::from(directory);
    opencode::OpenCodeClient::new(opencode::AgentEndpoint {
        base_url: crate::sidecar_url(app),
        provider_id: String::new(),
        model_id: String::new(),
        workspace,
        auth_header: crate::sidecar_auth_header(app),
    })
    .abort_with_interaction_cleanup(session_id)
}

pub(crate) fn managed_session_busy(
    app: &tauri::AppHandle,
    directory: &str,
    session_id: &str,
) -> Result<bool, String> {
    crate::history::commands::client(app)?
        .get(directory, session_id)
        .map_err(|error| error.to_string())?;
    let workspace = std::path::PathBuf::from(directory);
    opencode::OpenCodeClient::new(opencode::AgentEndpoint {
        base_url: crate::sidecar_url(app),
        provider_id: String::new(),
        model_id: String::new(),
        workspace,
        auth_header: crate::sidecar_auth_header(app),
    })
    .is_busy(session_id)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentReply {
    Once,
    Always,
    Reject,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPendingPermission {
    request_id: String,
    permission: String,
    patterns: Vec<String>,
    always: Vec<String>,
    metadata: serde_json::Value,
    command: Option<String>,
    cwd: String,
}

fn process_pending(
    state: &AgentPermissionState,
    run_id: &str,
    message_ids: &[String],
    call_ids: &[String],
    requests: Vec<PermissionRequest>,
) -> Result<Vec<(PermissionRequest, Reply)>, String> {
    let mut automatic = Vec::new();
    for (request, decision) in state.sync_pending(run_id, requests, message_ids, call_ids)? {
        match decision {
            PendingDecision::AllowOnce => automatic.push((request, Reply::Once)),
            PendingDecision::Reject => automatic.push((request, Reply::Reject)),
            PendingDecision::RejectWithReason(reason) => {
                automatic.push((request, Reply::RejectWithReason(reason)))
            }
            PendingDecision::Ask(_) => {}
        }
    }
    Ok(automatic)
}

fn process_reply(
    state: &AgentPermissionState,
    run_id: &str,
    request_id: &str,
    reply: AgentReply,
) -> Result<(PermissionRequest, AgentReply), String> {
    let request = state.take_reply(run_id, request_id)?;
    Ok((request, reply))
}

const STALE_PERMISSION: &str = "agent_permission_stale";

fn process_current_reply(
    run_state: &AgentRunState,
    permission_state: &AgentPermissionState,
    run_id: &str,
    request_id: &str,
    reply: AgentReply,
) -> Result<(PermissionRequest, AgentReply, std::path::PathBuf), String> {
    let record = run_state
        .active_record(run_id)
        .map_err(|_| STALE_PERMISSION.to_owned())?;
    let expected_session = record
        .session_id
        .clone()
        .ok_or_else(|| STALE_PERMISSION.to_owned())?;
    let (owned, reply) = process_reply(permission_state, run_id, request_id, reply)
        .map_err(|_| STALE_PERMISSION.to_owned())?;
    if owned.session_id != expected_session
        || !permission_provenance::matches_current_tool(
            &owned,
            &record.message_ids,
            &record.call_ids,
        )
    {
        return Err(STALE_PERMISSION.to_owned());
    }
    Ok((owned, reply, record.workspace_path))
}

fn pending_projection(
    runs: &AgentRunState,
    permissions: &AgentPermissionState,
    run_id: &str,
) -> Result<Vec<AgentPendingPermission>, String> {
    let record = runs.active_record(run_id)?;
    match collector::cached_permissions(permissions, run_id) {
        Ok(waiting) => Ok(waiting),
        Err(error)
            if error == "agent_run_unknown"
                && (record.initial_input.is_some() || record.session_id.is_none()) =>
        {
            Ok(Vec::new())
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn agent_permission_pending(
    window: tauri::WebviewWindow,
    runs: tauri::State<'_, AgentRunState>,
    permissions: tauri::State<'_, AgentPermissionState>,
    run_id: String,
) -> Result<Vec<AgentPendingPermission>, String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    pending_projection(&runs, &permissions, &run_id)
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
        collector::collect_active_run_once(&app, collector::CollectionMode::Live)
            .map_err(|_| STALE_PERMISSION.to_owned())?;
        let state = app.state::<AgentRunState>();
        let base = crate::tool_permissions::runtime::endpoint(&app);
        let (request, decision, workspace) = {
            let _operation = state.lock_operation()?;
            process_current_reply(
                &state,
                &app.state::<AgentPermissionState>(),
                &run_id,
                &request_id,
                reply,
            )?
        };
        if matches!(decision, AgentReply::Always) {
            crate::settings::remember_agent_permission(&app, &workspace, &request)?;
            app.state::<AgentPermissionState>()
                .remember_approval(&run_id, &request)?;
        }
        let engine_reply = match decision {
            AgentReply::Once | AgentReply::Always => Reply::Once,
            AgentReply::Reject => Reply::Reject,
        };
        crate::tool_permissions::runtime::respond_scoped(
            &base,
            &request,
            engine_reply,
            &workspace,
        )?;
        if matches!(decision, AgentReply::Reject) {
            collector::collect_active_run_once(&app, collector::CollectionMode::Live)?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "agent_permission_unavailable".to_owned())?
}

#[cfg(test)]
#[path = "agent/pending_projection_tests.rs"]
mod pending_projection_tests;
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

#[cfg(test)]
#[path = "agent/tool_lifecycle_live_tests.rs"]
mod tool_lifecycle_live_tests;



pub(crate) fn managed_sidecar_ready(app: &tauri::AppHandle) -> Result<bool, String> {
    let workspace = std::path::PathBuf::from(crate::history::commands::workspace(app)?);
    Ok(opencode::OpenCodeClient::new(opencode::AgentEndpoint {
        base_url: crate::sidecar_url(app), provider_id: String::new(), model_id: String::new(),
        workspace, auth_header: crate::sidecar_auth_header(app),
    }).wait_ready(opencode::READY_TIMEOUT))
}
