use super::{
    contract::*,
    contract_runtime::*,
    error::{WorklogError, WorklogResult},
    repository::Repository,
    storage::{WorklogStore, DB_FILE_NAME},
};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub const WORKLOG_CHANGED_EVENT: &str = "deskmate://worklog-changed";
pub struct WorklogState(pub Mutex<Option<Arc<Repository>>>);
impl WorklogState {
    pub fn initialize(app: &tauri::AppHandle) -> Self {
        let store = app
            .path()
            .app_data_dir()
            .map_err(|_| WorklogError::new("STORAGE_UNAVAILABLE", "Data directory unavailable"))
            .and_then(|dir| WorklogStore::open(&dir.join(DB_FILE_NAME)));
        match store {
            Ok(store) => Self(Mutex::new(Some(Arc::new(Repository::new(store))))),
            Err(error) => {
                eprintln!("worklog disabled: {}", error.code);
                Self(Mutex::new(None))
            }
        }
    }
    pub fn repository(&self) -> WorklogResult<Arc<Repository>> {
        self.0
            .lock()
            .map_err(|_| WorklogError::new("STORAGE_UNAVAILABLE", "Journal state unavailable"))?
            .as_ref()
            .cloned()
            .ok_or_else(|| WorklogError::new("WORKLOG_DISABLED", "Work journal is unavailable"))
    }
    pub fn with_repository<T>(
        &self,
        body: impl FnOnce(&Repository) -> WorklogResult<T>,
    ) -> WorklogResult<T> {
        body(self.repository()?.as_ref())
    }
}
fn configured_model(app: &tauri::AppHandle) -> WorklogResult<String> {
    let state = app.state::<crate::settings::SettingsState>();
    let settings = state
        .0
        .lock()
        .map_err(|_| WorklogError::new("MODEL_CONFIGURATION", "Model settings unavailable"))?;
    if settings.provider_id.is_empty() || settings.model_id.is_empty() {
        return Err(WorklogError::new(
            "MODEL_CONFIGURATION",
            "Choose a model in settings",
        ));
    }
    Ok(format!("{}/{}", settings.provider_id, settings.model_id))
}
fn notify(app: &tauri::AppHandle) {
    let _ = app.emit(WORKLOG_CHANGED_EVENT, ());
}

#[tauri::command]
pub fn worklog_available(state: tauri::State<WorklogState>) -> bool {
    state.repository().is_ok()
}
#[tauri::command]
pub fn worklog_record(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: RecordEntry,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.record_entry(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_update(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: UpdateEntry,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.update_entry(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_query(
    state: tauri::State<WorklogState>,
    query: DateQuery,
) -> WorklogResult<Vec<Entry>> {
    state.with_repository(|repo| repo.query_entries(&query))
}
#[tauri::command]
pub fn worklog_delete_entry(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: DeleteRecord,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.delete_entry(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_list_reports(
    state: tauri::State<WorklogState>,
    query: DateQuery,
) -> WorklogResult<Vec<Report>> {
    state.with_repository(|repo| repo.list_reports(&query))
}
#[tauri::command]
pub fn worklog_get_report(
    state: tauri::State<WorklogState>,
    id: String,
) -> WorklogResult<ReportDetail> {
    state.with_repository(|repo| repo.get_report(&id))
}
#[tauri::command]
pub fn worklog_save_report(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: SaveReport,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.save_report(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_apply_version(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: ApplyVersion,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.apply_version(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_delete_report(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: DeleteRecord,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.delete_report(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_list_schedules(state: tauri::State<WorklogState>) -> WorklogResult<Vec<Schedule>> {
    state.with_repository(Repository::list_schedules)
}
#[tauri::command]
pub fn worklog_save_schedule(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: SaveSchedule,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.save_schedule(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_delete_schedule(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: DeleteRecord,
) -> WorklogResult<OperationReceipt> {
    let result = state.with_repository(|repo| repo.delete_schedule(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_generate_report(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    mut request: GenerateReport,
) -> WorklogResult<OperationReceipt> {
    request.model_id = configured_model(&app)?;
    let result = state.with_repository(|repo| repo.generate_report(&request))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_list_runs(state: tauri::State<WorklogState>) -> WorklogResult<Vec<Run>> {
    state.with_repository(Repository::list_runs)
}
#[tauri::command]
pub fn worklog_retry_run(
    app: tauri::AppHandle,
    state: tauri::State<WorklogState>,
    request: RetryRun,
) -> WorklogResult<OperationReceipt> {
    let model = configured_model(&app)?;
    let result = state.with_repository(|repo| repo.retry_run(&request, &model))?;
    notify(&app);
    Ok(result)
}
#[tauri::command]
pub fn worklog_get_operation(
    state: tauri::State<WorklogState>,
    request_id: String,
) -> WorklogResult<Option<OperationReceipt>> {
    state.with_repository(|repo| repo.operation(&request_id))
}
#[cfg(test)]
#[path = "tests/commands.rs"]
mod tests;
