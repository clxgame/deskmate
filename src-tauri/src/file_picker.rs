use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

/// Shared native picker for the workbench and compact chat. Callers enforce
/// their own window permissions, file limits, and response boundary.
pub(crate) fn pick_files(
    window: &tauri::WebviewWindow,
    title: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Vec<PathBuf>, String> {
    let mut dialog = window.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(&title);
    }
    let extensions: Vec<String> = extensions
        .unwrap_or_default()
        .into_iter()
        .map(|ext| ext.trim_start_matches('.').to_lowercase())
        .filter(|ext| !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .collect();
    if !extensions.is_empty() {
        let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter("files", &refs);
    }
    dialog
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(|path| {
            path.into_path()
                .map_err(|_| "picked path unavailable".to_string())
        })
        .collect()
}
