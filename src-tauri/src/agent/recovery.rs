pub(crate) fn recover_after_start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = super::collector::collect_active_run_once(
            &app,
            super::collector::CollectionMode::Recovery,
        ) {
            eprintln!("agent recovery: {error}");
        }
    });
}

pub(crate) fn read_session_snapshot(
    app: &tauri::AppHandle,
    workspace: &std::path::Path,
    session_id: &str,
) -> Result<Vec<super::NativeMessage>, String> {
    let settings = super::run_commands::current_start_settings(app)?;
    super::run_commands::lifecycle_client(app, &settings, workspace).snapshot(session_id)
}
