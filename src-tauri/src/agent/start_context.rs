use super::opencode;
use tauri::Manager;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct StartSettings {
    pub(super) provider_id: String,
    pub(super) model_id: String,
    pub(super) persona_id: String,
    pub(super) memory_ai_use: bool,
}

impl From<&crate::settings::Settings> for StartSettings {
    fn from(settings: &crate::settings::Settings) -> Self {
        Self {
            provider_id: settings.provider_id.clone(),
            model_id: settings.model_id.clone(),
            persona_id: settings.persona_id.clone(),
            memory_ai_use: settings.memory_ai_use,
        }
    }
}

pub(super) fn lifecycle_client(
    app: &tauri::AppHandle,
    settings: &StartSettings,
    workspace: &std::path::Path,
) -> opencode::OpenCodeClient {
    opencode::OpenCodeClient::new(opencode::AgentEndpoint {
        base_url: crate::sidecar_url(app),
        provider_id: settings.provider_id.clone(),
        model_id: settings.model_id.clone(),
        workspace: workspace.to_path_buf(),
        auth_header: crate::sidecar_auth_header(app),
    })
}

pub(super) fn current_start_settings(app: &tauri::AppHandle) -> Result<StartSettings, String> {
    let settings = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map_err(|_| "agent_settings_unavailable")?
        .clone();
    Ok(StartSettings::from(&settings))
}
