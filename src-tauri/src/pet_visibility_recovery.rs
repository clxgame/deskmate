use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct VisibilityError(pub Mutex<Option<String>>);

#[derive(Clone, serde::Serialize)]
struct ErrorEvent {
    message: Option<String>,
}

impl VisibilityError {
    fn clear(&self) -> Result<bool, String> {
        self.0
            .lock()
            .map(|mut error| error.take().is_some())
            .map_err(|error| error.to_string())
    }
}

pub fn show(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.show()?;
    let app = window.app_handle();
    match app.state::<VisibilityError>().clear() {
        Ok(true) => {
            let _ = app.emit_to(
                "settings",
                "deskmate://pet-visibility-error",
                ErrorEvent { message: None },
            );
        }
        Ok(false) => {}
        Err(error) => eprintln!("pet visibility recovery clear failed: {error}"),
    }
    Ok(())
}

pub fn recover(app: &tauri::AppHandle) {
    let message = "桌宠恢复显示超时，请在角色设置中切换角色后重试。".to_owned();
    if let Ok(mut error) = app.state::<VisibilityError>().0.lock() {
        *error = Some(message.clone());
    }
    crate::show_settings_window(app);
    let _ = app.emit_to(
        "settings",
        "deskmate://pet-visibility-error",
        ErrorEvent {
            message: Some(message),
        },
    );
}

#[tauri::command]
pub fn get_pet_visibility_error(state: State<VisibilityError>) -> Result<Option<String>, String> {
    state
        .0
        .lock()
        .map(|error| error.clone())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_recovery_clears_cached_error_once() {
        let state = VisibilityError(Mutex::new(Some("reset timed out".into())));
        assert!(state.clear().expect("clear"));
        assert_eq!(*state.0.lock().expect("error"), None);
        assert!(!state.clear().expect("already clear"));
    }
}
