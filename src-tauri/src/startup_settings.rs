use crate::settings::{Settings, SettingsState};
use std::sync::Mutex;
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime};

pub(crate) fn plugin<R: Runtime>(
    load: impl FnOnce(&AppHandle<R>) -> Result<Settings, Box<dyn std::error::Error>> + Send + 'static,
) -> TauriPlugin<R> {
    tauri::plugin::Builder::new("startup-settings")
        .setup(move |app, _| {
            app.manage(SettingsState(Mutex::new(load(app)?)));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use crate::settings::{Settings, SettingsState};
    use tauri::{
        test::{mock_builder, mock_context, noop_assets},
        Manager,
    };

    #[test]
    fn persisted_persona_is_ready_before_any_window_can_read_settings() {
        // Given a saved selection that differs from the first-install default.
        let saved: Settings = serde_json::from_str(
            r#"{"personaId":"xiaozhu-sandaime","theme":"peach","petScale":0.75}"#,
        )
        .expect("saved settings");

        // When plugins initialize, before Tauri runs window and app setup.
        let app = mock_builder()
            .plugin(super::plugin(move |app| {
                assert!(app.webview_windows().is_empty());
                Ok(saved)
            }))
            .build(mock_context(noop_assets()))
            .expect("app initialization");

        // Then the first settings snapshot contains the saved persona and tuning.
        let state = app.state::<SettingsState>();
        let settings = state.0.lock().expect("settings snapshot");
        assert_eq!(settings.persona_id, "xiaozhu-sandaime");
        assert_eq!(settings.theme, "peach");
        assert_eq!(settings.pet_scale, 0.75);
    }
}
