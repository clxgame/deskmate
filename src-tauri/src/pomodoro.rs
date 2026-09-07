mod contract;
mod core;
mod runtime;
pub use contract::{deserialize_stored_preferences, Phase, Preferences, Snapshot};
pub use runtime::{apply_preferences, start_checker, stop_checker, PomodoroState};

#[cfg(test)]
mod preference_tests;
#[cfg(test)]
mod qa_tests;
#[cfg(test)]
mod tests;

use contract::Operation;

#[tauri::command]
pub fn pomodoro_get(app: tauri::AppHandle) -> Result<Snapshot, String> {
    runtime::execute(&app, Operation::Get).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pomodoro_start(app: tauri::AppHandle, preferences: Preferences) -> Result<Snapshot, String> {
    runtime::execute(&app, Operation::Start(preferences)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pomodoro_pause(app: tauri::AppHandle) -> Result<Snapshot, String> {
    runtime::execute(&app, Operation::Pause).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pomodoro_reset(app: tauri::AppHandle) -> Result<Snapshot, String> {
    runtime::execute(&app, Operation::Reset).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pomodoro_select_phase(
    app: tauri::AppHandle,
    phase: Phase,
    preferences: Preferences,
) -> Result<Snapshot, String> {
    runtime::execute(&app, Operation::SelectPhase(phase, preferences))
        .map_err(|error| error.to_string())
}
