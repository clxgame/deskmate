#[tauri::command]
pub fn workbench_theme(
    window: tauri::WebviewWindow,
    state: tauri::State<crate::settings::SettingsState>,
) -> Result<String, String> {
    if window.label() != "workbench" {
        return Err("workbench commands are only available to the workbench window".into());
    }
    state
        .0
        .lock()
        .map(|settings| settings.theme.clone())
        .map_err(|_| "settings unavailable".to_string())
}
