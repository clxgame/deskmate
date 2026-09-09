use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::pet_visibility_state::{Lifecycle, Phase, Request};

pub struct PetVisibility(pub Mutex<Lifecycle>);

impl Default for PetVisibility {
    fn default() -> Self {
        Self(Mutex::new(Lifecycle::new(true)))
    }
}

#[derive(Clone, serde::Serialize)]
struct VisibilityEvent {
    phase: &'static str,
    token: u64,
}

fn emit_request(app: &tauri::AppHandle, request: Request) {
    let phase = match request.phase {
        Phase::Leaving => "leaving",
        Phase::Reset => "reset",
    };
    if let Err(error) = app.emit_to(
        "pet",
        "deskmate://pet-visibility",
        VisibilityEvent {
            phase,
            token: request.token,
        },
    ) {
        eprintln!("pet visibility event failed: {error}");
    }
}

pub fn initialize(app: &tauri::AppHandle, visible: bool) {
    if let Ok(mut state) = app.state::<PetVisibility>().0.lock() {
        *state = Lifecycle::new(visible);
    }
}

pub fn request(app: &tauri::AppHandle, visible: Option<bool>) {
    let persona = match app.state::<crate::SettingsState>().0.lock() {
        Ok(settings) => settings.persona_id.clone(),
        Err(error) => {
            eprintln!("pet visibility settings unavailable: {error}");
            return;
        }
    };
    let animated = crate::packs::persona_uses_gif(app, &persona);
    dispatch(app, visible, animated);
}

pub fn apply_settings(app: &tauri::AppHandle, settings: &crate::settings::Settings) {
    dispatch(
        app,
        Some(settings.pet_visible),
        crate::packs::persona_uses_gif(app, &settings.persona_id),
    );
}

fn dispatch(app: &tauri::AppHandle, visible: Option<bool>, animated: bool) {
    let handle = app.clone();
    if let Err(error) =
        app.run_on_main_thread(move || request_on_main_thread(&handle, visible, animated))
    {
        eprintln!("pet visibility dispatch failed: {error}");
    }
}

fn request_on_main_thread(app: &tauri::AppHandle, visible: Option<bool>, animated: bool) {
    let Some(pet) = app.get_webview_window("pet") else {
        return;
    };
    let visibility = app.state::<PetVisibility>();
    let Ok(mut state) = visibility.0.lock() else {
        return;
    };
    let desired = visible.unwrap_or(!state.desired_visible);
    let pending = state.request(desired, animated);
    if !desired {
        let _ = crate::hide_chat_impl(app);
    }
    match pending {
        Some(request) => {
            if desired {
                // The webview resets its last faded frame while the native window is hidden.
                let _ = pet.hide();
            }
            emit_request(app, request);
            schedule_fallback(app.clone(), request.token);
        }
        None => {
            let result = if desired {
                crate::pet_visibility_recovery::show(&pet)
            } else {
                pet.hide()
            };
            if let Err(error) = result {
                eprintln!("pet visibility failed: {error}");
            }
        }
    }
}

fn schedule_fallback(app: tauri::AppHandle, token: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1200));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let visibility = handle.state::<PetVisibility>();
            let Ok(mut state) = visibility.0.lock() else {
                return;
            };
            if state.fallback(token) {
                if let Some(pet) = handle.get_webview_window("pet") {
                    let _ = pet.hide();
                }
            } else if state.reset_timed_out(token) {
                crate::pet_visibility_recovery::recover(&handle);
            }
        });
    });
}

#[tauri::command]
pub fn acknowledge_pet_visibility(window: tauri::WebviewWindow, token: u64) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Only the pet window can acknowledge visibility".into());
    }
    let app = window.app_handle().clone();
    app.clone()
        .run_on_main_thread(move || {
            let visibility = app.state::<PetVisibility>();
            let Ok(mut state) = visibility.0.lock() else {
                return;
            };
            match state.acknowledge(token) {
                Some(Phase::Leaving) => {
                    let _ = window.hide();
                }
                Some(Phase::Reset) => {
                    let _ = crate::pet_visibility_recovery::show(&window);
                }
                None => {}
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn register_pet_visibility(
    window: tauri::WebviewWindow,
    persona_id: String,
    animated: bool,
) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Only the pet window can register visibility".into());
    }
    let app = window.app_handle().clone();
    app.clone()
        .run_on_main_thread(move || {
            let selected = match app.state::<crate::SettingsState>().0.lock() {
                Ok(settings) => settings.persona_id == persona_id,
                Err(_) => false,
            };
            if !selected {
                return;
            }
            let visibility = app.state::<PetVisibility>();
            let Ok(mut state) = visibility.0.lock() else {
                return;
            };
            if state.pending.is_none()
                && state.desired_visible
                && !window.is_visible().unwrap_or(false)
            {
                state.request(true, animated);
                if !animated {
                    let _ = crate::pet_visibility_recovery::show(&window);
                }
            }
            if let Some(pending) = state.pending {
                if animated {
                    emit_request(&app, pending);
                    if pending.phase == Phase::Reset {
                        schedule_fallback(app.clone(), pending.token);
                    }
                } else {
                    let visible = state.desired_visible;
                    state.request(visible, false);
                    let result = if visible {
                        crate::pet_visibility_recovery::show(&window)
                    } else {
                        window.hide()
                    };
                    if let Err(error) = result {
                        eprintln!("pet visibility registration failed: {error}");
                    }
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_pet_visibility(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() != "pet" {
        return Err("Only the pet window can read visibility".into());
    }
    let native_visible = window.is_visible().map_err(|error| error.to_string())?;
    let visibility = window.app_handle().state::<PetVisibility>();
    let state = visibility.0.lock().map_err(|error| error.to_string())?;
    Ok(state.feedback_visible(native_visible))
}
