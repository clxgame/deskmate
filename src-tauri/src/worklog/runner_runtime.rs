use super::{
    commands::WorklogState,
    model_client::ModelEndpoint,
    runner::{RunnerEnvironment, RunnerHandle},
};
use std::sync::Arc;
use tauri::{Emitter, Manager};

struct DesktopEnvironment(tauri::AppHandle);
impl RunnerEnvironment for DesktopEnvironment {
    fn endpoint(&self) -> Option<ModelEndpoint> {
        let sidecar = self.0.try_state::<crate::Sidecar>()?;
        let process_id = sidecar.child.lock().ok()?.as_ref()?.id();
        let settings = self.0.try_state::<crate::settings::SettingsState>()?;
        let settings = settings.0.lock().ok()?;
        if settings.provider_id.is_empty() || settings.model_id.is_empty() {
            return None;
        }
        Some(ModelEndpoint {
            base_url: format!("http://127.0.0.1:{}", sidecar.port),
            provider_id: settings.provider_id.clone(),
            model_id: settings.model_id.clone(),
            epoch: format!("{}:{process_id}", sidecar.port),
        })
    }
    fn model_identity(&self) -> Option<String> {
        let state = self.0.try_state::<crate::settings::SettingsState>()?;
        let settings = state.0.lock().ok()?;
        if settings.provider_id.is_empty() || settings.model_id.is_empty() {
            return None;
        }
        Some(format!("{}/{}", settings.provider_id, settings.model_id))
    }
    fn changed(&self) {
        let _result = self.0.emit("deskmate://worklog-changed", ());
    }
}
pub fn start(app: tauri::AppHandle) {
    let Some(state) = app.try_state::<WorklogState>() else {
        return;
    };
    match state.repository() {
        Ok(repository) => {
            let handle = RunnerHandle::start(repository, Arc::new(DesktopEnvironment(app.clone())));
            app.manage(handle);
        }
        Err(error) => eprintln!("worklog runner unavailable: {}", error.code),
    }
}
pub fn stop(app: &tauri::AppHandle) {
    if let Some(handle) = app.try_state::<RunnerHandle>() {
        handle.stop();
    }
}
