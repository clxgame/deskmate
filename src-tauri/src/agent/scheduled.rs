use super::{
    record_store::{RunOutcome, RunRecord},
    AgentPermissionState, AgentRunState,
};
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::Manager;

pub(super) fn run_id(task_id: &str, occurrence: &str) -> String {
    let digest = Sha256::digest(format!("{task_id}\0{occurrence}").as_bytes());
    format!(
        "msg_schedule_{}",
        digest[..12]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

pub(crate) enum ScheduledAdmission {
    Started,
    Duplicate,
    BusyReceipt,
}

impl AgentRunState {
    pub(crate) fn begin_scheduled(
        &self,
        run_id: &str,
        workspace: &Path,
        input: &str,
    ) -> Result<ScheduledAdmission, String> {
        let workspace_path = workspace
            .canonicalize()
            .map_err(|_| "workspace_invalid_path")?;
        if !workspace_path.is_dir() || input.trim().is_empty() {
            return Err("agent_start_invalid".into());
        }
        let mut data = self.data.lock().map_err(|_| "agent_state_unavailable")?;
        if data
            .active
            .as_ref()
            .is_some_and(|record| record.run_id == run_id)
            || data.recent.iter().any(|record| record.run_id == run_id)
        {
            return Ok(ScheduledAdmission::Duplicate);
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut record = RunRecord {
            run_id: run_id.into(),
            session_id: None,
            workspace_path,
            created_at: now.clone(),
            ended_at: None,
            outcome: None,
            error_summary: None,
            pending_outcome: None,
            pending_error_summary: None,
            message_ids: Vec::new(),
            part_ids: Vec::new(),
            call_ids: Vec::new(),
            initial_input: Some(input.into()),
        };
        if data.active.is_some() {
            record.ended_at = Some(now);
            record.outcome = Some(RunOutcome::Failed);
            record.error_summary = Some("scheduled_agent_busy".into());
            record.initial_input = None;
            self.store.write(&record)?;
            data.recent.insert(0, record);
            return Ok(ScheduledAdmission::BusyReceipt);
        }
        self.store.write(&record)?;
        data.active = Some(record);
        Ok(ScheduledAdmission::Started)
    }
}
pub(super) fn submit_with(
    state: &AgentRunState,
    id: &str,
    workspace: &Path,
    prompt: &str,
    submit: impl FnOnce(&AgentRunState, &str) -> Result<(), String>,
) -> Result<ScheduledAdmission, String> {
    let admission = state.begin_scheduled(id, workspace, prompt)?;
    if !matches!(admission, ScheduledAdmission::Started) {
        return Ok(admission);
    }
    if let Err(error) = submit(state, id) {
        let _ = state.fail_active(id, "scheduled_submission_failed");
        return Err(error);
    }
    Ok(admission)
}

pub(crate) fn execute(
    app: &tauri::AppHandle,
    task: &crate::settings::ScheduledTask,
    occurrence: &str,
) {
    let result = (|| {
        let workspace = app
            .path()
            .app_data_dir()
            .map_err(|_| "scheduled_workspace_unavailable".to_owned())?
            .join("scheduled-agent-workspace");
        std::fs::create_dir_all(&workspace)
            .map_err(|_| "scheduled_workspace_unavailable".to_owned())?;
        let id = run_id(&task.id, occurrence);
        let state = app.state::<AgentRunState>();
        submit_with(&state, &id, &workspace, &task.prompt, |state, id| {
            let settings = super::run_commands::current_start_settings(app)?;
            let client = super::run_commands::lifecycle_client(app, &settings, &workspace);
            let session = client.create_session(&workspace)?;
            let permissions = app.state::<AgentPermissionState>();
            if let Err(error) = state.bind_session_with(id, &session, || {
                permissions.register_run(id, &session, &workspace)
            }) {
                let _ = permissions.cancel_run(id);
                return Err(error);
            }
            let created = u64::try_from(chrono::Utc::now().timestamp_millis())
                .map_err(|_| "history_time_invalid".to_owned())?;
            if crate::history::save_agent_input(
                app,
                &app.state::<crate::history::HistoryState>(),
                crate::history::AgentHistoryInput {
                    session_id: &session,
                    run_id: id,
                    text: &task.prompt,
                    created,
                },
            )
            .is_err()
            {
                let _ = permissions.cancel_run(id);
                return match state.fail_active_preserving_input(id, "history_storage_failed") {
                    Ok(()) => Err("history_storage_failed".to_owned()),
                    Err(error) => Err(error),
                };
            }
            let result = client
                .prompt(&session, id, "", &task.prompt)
                .and_then(|_| state.confirm_submission(id));
            if result.is_err() {
                let _ = permissions.cancel_run(id);
            }
            result
        })
    })();
    if let Err(error) = result {
        eprintln!("scheduled agent task failed: {error}");
    }
}
