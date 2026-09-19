use super::{
    lifecycle::AgentRunState,
    permissions::AgentPermissionState,
    record_store::{RunListing, RunRecord},
};
use serde::Deserialize;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStartInput {
    workspace_path: std::path::PathBuf,
    input: String,
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
        state.begin(&run_id, &request.workspace_path, &request.input)?;
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
            ))
        })();
        let (system, settings) = match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                let _ = state.fail_active(&run_id, &error);
                return Err(error);
            }
        };
        let client = lifecycle_client(&app, &settings, &workspace);
        if !client.wait_ready(std::time::Duration::from_secs(10)) {
            let _ = state.fail_active(&run_id, "agent_sidecar_unavailable");
            return Err("agent_sidecar_unavailable".to_owned());
        }
        let session = match client.create_session(&workspace) {
            Ok(session) => session,
            Err(error) => {
                let _ = state.fail_active(&run_id, &error);
                return Err(error);
            }
        };
        if let Err(error) = state.bind_session_with(&run_id, &session, || {
            app.state::<AgentPermissionState>()
                .register_run(&run_id, &session, &workspace)
        }) {
            let _ = app.state::<AgentPermissionState>().cancel_run(&run_id);
            let _ = state.fail_active(&run_id, &error);
            return Err(error);
        }
        if let Err(error) = client.prompt(&session, &run_id, &system, &request.input) {
            let _ = app.state::<AgentPermissionState>().cancel_run(&run_id);
            let _ = state.fail_active(&run_id, &error);
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

#[tauri::command]
pub(crate) async fn agent_run_read(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<RunListing, String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AgentRunState>();
        if !crate::sidecar_owned_running(&app)? {
            if let Some(record) = state.read()?.active {
                state.interrupt_active("sidecar_process_lost")?;
                let _ = app
                    .state::<AgentPermissionState>()
                    .cancel_run(&record.run_id);
            }
            return state.read();
        }
        if let Some(record) = state.read()?.active {
            if let Some(session) = record.session_id.clone() {
                let settings = current_start_settings(&app)?;
                let snapshot =
                    lifecycle_client(&app, &settings, &record.workspace_path).snapshot(&session);
                reconcile_read_snapshot(
                    &state,
                    &app.state::<AgentPermissionState>(),
                    &record.run_id,
                    snapshot,
                )?;
                if state.read()?.active.is_none() {
                    let _ = app
                        .state::<AgentPermissionState>()
                        .cancel_run(&record.run_id);
                }
            }
        }
        state.read()
    })
    .await
    .map_err(|_| "agent_worker_failed".to_owned())?
}

pub(super) fn reconcile_read_snapshot(
    state: &AgentRunState,
    permissions: &AgentPermissionState,
    run_id: &str,
    snapshot: Result<Vec<super::record_store::NativeMessage>, String>,
) -> Result<(), String> {
    match snapshot {
        Ok(messages) => state.reconcile(run_id, &messages),
        Err(error) => {
            state.interrupt_active(&error)?;
            let _ = permissions.cancel_run(run_id);
            Ok(())
        }
    }
}

pub(crate) fn recover_after_start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AgentRunState>();
        let Ok(listing) = state.read() else {
            return;
        };
        let Some(record) = listing.active else {
            return;
        };
        let Some(session) = record.session_id.clone() else {
            let _ = state.interrupt_active("submission_not_confirmed");
            return;
        };
        let Ok(settings) = current_start_settings(&app) else {
            return;
        };
        let client = lifecycle_client(&app, &settings, &record.workspace_path);
        let recovered = client
            .wait_ready(std::time::Duration::from_secs(10))
            .then(|| client.snapshot(&session))
            .transpose()
            .and_then(|value| value.ok_or_else(|| "sidecar_not_ready".to_owned()));
        match recovered {
            Ok(messages) => {
                let _ = state.reconcile(&record.run_id, &messages);
            }
            Err(error) => {
                let _ = state.interrupt_active(&error);
            }
        }
        if state
            .read()
            .ok()
            .is_some_and(|listing| listing.active.is_none())
        {
            let _ = app
                .state::<AgentPermissionState>()
                .cancel_run(&record.run_id);
        }
    });
}

pub(crate) fn interrupt_owned_run(app: &tauri::AppHandle, reason: &str) {
    let state = app.state::<AgentRunState>();
    let run_id = state
        .read()
        .ok()
        .and_then(|listing| listing.active.map(|record| record.run_id));
    if state.interrupt_active(reason).is_ok() {
        if let Some(run_id) = run_id {
            let _ = app.state::<AgentPermissionState>().cancel_run(&run_id);
        }
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
        let _operation = state.lock_operation()?;
        let workspace = state
            .read()?
            .active
            .filter(|record| record.run_id == run_id)
            .ok_or_else(|| "agent_run_unknown".to_owned())?
            .workspace_path;
        state.cancel_with(&run_id, |session| {
            let settings = current_start_settings(&app)?;
            lifecycle_client(&app, &settings, &workspace).abort(session)
        })?;
        app.state::<AgentPermissionState>().cancel_run(&run_id)?;
        Ok(())
    })
    .await
    .map_err(|_| "agent_worker_failed".to_owned())?
}
