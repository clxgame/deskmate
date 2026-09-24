use super::{
    lifecycle::AgentRunState,
    permissions::AgentPermissionState,
    record_store::{RunListing, RunOutcome, RunRecord},
};
use serde::Deserialize;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStartInput {
    pub(super) workspace_path: Option<std::path::PathBuf>,
    pub(super) history_id: Option<String>,
    pub(super) catalog_key: Option<String>,
    pub(super) input: String,
}

pub(super) use super::start_context::{current_start_settings, lifecycle_client, StartSettings};

#[tauri::command]
pub(crate) async fn agent_run_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: AgentStartInput,
) -> Result<RunRecord, String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let run_id = format!("msg_agent_{}", uuid::Uuid::new_v4().simple());
        let state = app.state::<AgentRunState>();
        let operation = state.lock_operation()?;
        if crate::updater::installation_in_progress() {
            return Err("agent_update_installing".to_owned());
        }
        let history = app.state::<crate::history::HistoryState>();
        let target = match request.catalog_key.as_deref() {
            Some(key) => {
                let entry = crate::history::commands::store(&app)?.get(key)?;
                let target = super::continuation::catalog_start_target(&request, &entry, &history, &state)?;
                if let crate::history::catalog_model::CatalogIdentity::Native { directory, session_id, .. } = &entry.identity {
                    let client = crate::history::commands::client(&app)?;
                    client.get(directory, session_id).map_err(|error| error.to_string())?;
                    let statuses = client.statuses(directory).map_err(|error| error.to_string())?;
                    if statuses.get(session_id).is_some_and(|status| !matches!(status, crate::history::native_api::NativeStatus::Idle)) {
                        return Err("agent_history_busy".into());
                    }
                    if app.state::<crate::workbench::WorkbenchOwnership>().is_owned(directory, session_id)? {
                        return Err("session_owned_by_workbench".into());
                    }
                }
                target
            }
            None => super::continuation::start_target(&request, &history, &state)?,
        };
        state.begin(&run_id, &target.workspace, &request.input)?;
        drop(operation);
        let workspace = state
            .read()?
            .active
            .ok_or_else(|| "agent_run_unknown".to_owned())?
            .workspace_path;
        let prepared = (|| {
            let settings = app
                .state::<crate::settings::SettingsState>()
                .0
                .lock()
                .map_err(|_| "agent_settings_unavailable")?
                .clone();
            let snapshot = StartSettings::from(&settings);
            let (persona, _, skills) = crate::packs::persona_files(&app, &snapshot.persona_id)?;
            let memory = app
                .state::<crate::memory::MemoryState>()
                .0
                .lock()
                .map_err(|_| "agent_memory_unavailable")?
                .as_ref()
                .map(|repository| {
                    crate::memory::retrieval::context_for_turn(
                        repository,
                        &snapshot.persona_id,
                        &request.input,
                        snapshot.memory_ai_use,
                    )
                })
                .transpose()
                .map_err(|_| "agent_memory_unavailable")?
                .map(|context| context.prompt_block)
                .filter(|block| !block.is_empty());
            Ok::<_, String>((
                std::iter::once(persona)
                    .chain(skills)
                    .chain(memory)
                    .collect::<Vec<_>>()
                    .join("\n\n"),
                snapshot,
                settings.agent_permission_approvals.clone(),
            ))
        })();
        let (system, settings, approvals) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                let _ = state.fail_active(&run_id, &error);
                return Err(error);
            }
        };
        let client = lifecycle_client(&app, &settings, &workspace);
        if !client.wait_ready(super::opencode::READY_TIMEOUT) {
            let _ = state.fail_active(&run_id, "agent_sidecar_unavailable");
            return Err("agent_sidecar_unavailable".to_owned());
        }
        let session = match target.session_id {
            Some(session) => match client.snapshot(&session) {
                Ok(_) => session,
                Err(error) => {
                    let reason = if error == "agent_http_404" {
                        "agent_history_session_missing".to_owned()
                    } else {
                        error
                    };
                    let _ = state.fail_active_preserving_input(&run_id, &reason);
                    return Err(reason);
                }
            },
            None => match client.create_session(&workspace) {
                Ok(session) => session,
                Err(error) => {
                    let _ = state.fail_active(&run_id, &error);
                    return Err(error);
                }
            },
        };
        if let Err(error) = state.bind_session_with(&run_id, &session, || {
            app.state::<AgentPermissionState>()
                .register_run_with_approvals(&run_id, &session, &workspace, &approvals)
        }) {
            let _ = app.state::<AgentPermissionState>().cancel_run(&run_id);
            let _ = state.fail_active(&run_id, &error);
            return Err(error);
        }
        let created = u64::try_from(chrono::Utc::now().timestamp_millis())
            .map_err(|_| "history_time_invalid".to_owned())?;
        if crate::history::save_agent_input(
            &app,
            &app.state::<crate::history::HistoryState>(),
            crate::history::AgentHistoryInput {
                session_id: &session,
                run_id: &run_id,
                text: &request.input,
                created,
            },
        )
        .is_err()
        {
            return fail_history_start(&state, &app.state::<AgentPermissionState>(), &run_id);
        }
        let _operation = state.lock_operation()?;
        state.active_record(&run_id)?;
        if let Err(error) = client.prompt(&session, &run_id, &system, &request.input) {
            super::supervision::submission_failed(&app, &state.active_record(&run_id)?, &error)?;
            return Err(error);
        }
        state.confirm_submission(&run_id)?;
        state
            .read()?
            .active
            .ok_or_else(|| "agent_run_unknown".into())
    })
    .await
    .map_err(|_| "agent_worker_failed".to_owned())?
}

pub(super) fn fail_history_start<T>(
    state: &AgentRunState,
    permissions: &AgentPermissionState,
    run_id: &str,
) -> Result<T, String> {
    let _ = permissions.cancel_run(run_id);
    match state.fail_active_preserving_input(run_id, "history_storage_failed") {
        Ok(()) => Err("history_storage_failed".to_owned()),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn agent_run_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AgentRunState>,
) -> Result<RunListing, String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    state.read()
}

pub(crate) fn interrupt_owned_run(app: &tauri::AppHandle, reason: &str) {
    let state = app.state::<AgentRunState>();
    let Some(record) = state.read().ok().and_then(|listing| listing.active) else {
        return;
    };
    if reason == "app_exited" {
        let _ = state.interrupt_active(reason);
        let _ = app
            .state::<AgentPermissionState>()
            .cancel_run(&record.run_id);
        return;
    }
    if state
        .request_finish(
            &record.run_id,
            RunOutcome::Interrupted,
            Some(reason.to_owned()),
        )
        .is_ok()
    {
        let _ = app
            .state::<AgentPermissionState>()
            .cancel_run(&record.run_id);
    }
}

#[tauri::command]
pub(crate) async fn agent_run_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    run_id: String,
) -> Result<(), String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AgentRunState>();
        let operation = state.lock_operation()?;
        let record = state.active_record(&run_id)?;
        if record.initial_input.is_some() && record.session_id.is_none() {
            state.cancel_preparation(&run_id)?;
            return Ok(());
        }
        super::supervision::settle(&app, &record, "agent_cancelled")?;
        if record.initial_input.is_some() {
            state.cancel_preparation(&run_id)?;
            if let Err(error) = app.state::<AgentPermissionState>().cancel_run(&run_id) {
                if error != "agent_run_unknown" {
                    return Err(error);
                }
            }
            return Ok(());
        }
        state.request_finish(&run_id, RunOutcome::Cancelled, None)?;
        if let Err(error) = app.state::<AgentPermissionState>().cancel_run(&run_id) {
            if error != "agent_run_unknown" {
                return Err(error);
            }
        }
        drop(operation);
        super::collector::collect_active_run_once(&app, super::collector::CollectionMode::Live)
    })
    .await
    .map_err(|_| "agent_worker_failed".to_owned())?
}
