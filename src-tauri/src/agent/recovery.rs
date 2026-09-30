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
    crate::history::commands::client(app)?
        .get(&workspace.to_string_lossy(), session_id)
        .map_err(|error| error.to_string())?;
    let settings = super::run_commands::current_start_settings(app)?;
    super::run_commands::lifecycle_client(app, &settings, workspace).snapshot(session_id)
}
/// Confirm only from scoped native facts. An empty snapshot is inconclusive;
/// this helper never submits or replays the saved input.
pub(super) fn confirm_from_native_with(
    state: &super::AgentRunState,
    candidate: &super::RunRecord,
    snapshot: impl FnOnce() -> Result<Vec<super::NativeMessage>, String>,
) -> Result<bool, String> {
    let messages = snapshot()?;
    let accepted = messages.iter().any(|message| {
        (message.id == candidate.run_id && message.role.as_deref() == Some("user"))
            || (message.parent_id.as_deref() == Some(&candidate.run_id)
                && message.role.as_deref() == Some("assistant"))
    });
    if !accepted {
        return Ok(false);
    }
    let _operation = state.lock_operation()?;
    if !state.matches_active(candidate)? {
        return Ok(false);
    }
    state.confirm_submission(&candidate.run_id)?;
    Ok(true)
}
