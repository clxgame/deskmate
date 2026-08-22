use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

mod update_repo;
use update_repo::{migrated_update_repo, DEFAULT_UPDATE_REPO};

const PET_SCALE_MIN: f64 = 0.1;
const PET_SCALE_MAX: f64 = 2.0;
const DEFAULT_THEME: &str = "dark";
const OUTLINE_WIDTH_MIN: f64 = 0.0;
const OUTLINE_WIDTH_MAX: f64 = 0.03;
const DEFAULT_OUTLINE_WIDTH: f64 = 0.0073;
const RIM_WIDTH_MIN: f64 = 0.0;
const RIM_WIDTH_MAX: f64 = 1.0;
const DEFAULT_RIM_WIDTH: f64 = 0.4;
const RIM_INTENSITY_MIN: f64 = 0.0;
const RIM_INTENSITY_MAX: f64 = 2.0;
const DEFAULT_RIM_INTENSITY: f64 = 1.0;
const SPECULAR_INTENSITY_MIN: f64 = 0.0;
const SPECULAR_INTENSITY_MAX: f64 = 2.0;
const DEFAULT_SPECULAR_INTENSITY: f64 = 0.5;

fn normalize_pet_scale(scale: f64) -> f64 {
    if scale.is_finite() {
        scale.clamp(PET_SCALE_MIN, PET_SCALE_MAX)
    } else {
        1.0
    }
}

fn normalize_render_value(value: f64, min: f64, max: f64, default: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        default
    }
}

fn normalize_theme(theme: &str) -> String {
    match theme {
        "dark" | "mint" | "peach" | "lavender" => theme.to_owned(),
        _ => DEFAULT_THEME.to_owned(),
    }
}

/// A scheduled task: at `time` (HH:MM, daily), auto-send `prompt` to the AI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub time: String,
    pub prompt: String,
    pub enabled: bool,
}

/// Persisted app settings. All fields have defaults so older settings.json
/// files keep working when new fields are added.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    // 通用
    pub autostart: bool,
    pub language: String,
    pub theme: String,
    // AI
    pub provider_id: String,
    pub model_id: String,
    pub yolo: bool,
    pub base_url: String,
    pub api_key: String,
    // 小组件
    pub pet_scale: f64,
    pub outline_width: f64,
    pub rim_width: f64,
    pub rim_intensity: f64,
    pub specular_intensity: f64,
    pub pet_visible: bool,
    pub always_on_top: bool,
    pub scheduled_tasks: Vec<ScheduledTask>,
    // 快捷键
    pub shortcut_toggle_chat: String,
    pub shortcut_toggle_pet: String,
    // 账号
    pub persona_id: String,
    pub mouse_follow: bool,
    pub user_name: String,
    // 更新
    pub update_repo: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            autostart: false,
            language: "zh-CN".into(),
            theme: DEFAULT_THEME.into(),
            provider_id: String::new(),
            model_id: String::new(),
            yolo: false,
            base_url: "https://ai-gateway.kurogames.com".into(),
            api_key: String::new(),
            pet_scale: 1.0,
            outline_width: DEFAULT_OUTLINE_WIDTH,
            rim_width: DEFAULT_RIM_WIDTH,
            rim_intensity: DEFAULT_RIM_INTENSITY,
            specular_intensity: DEFAULT_SPECULAR_INTENSITY,
            pet_visible: true,
            always_on_top: true,
            scheduled_tasks: Vec::new(),
            // NOTE: Alt+Space is the Windows system menu and Ctrl+Shift+Space
            // is commonly taken by IMEs; Ctrl+Alt+D is usually free.
            shortcut_toggle_chat: "Ctrl+Alt+D".into(),
            shortcut_toggle_pet: String::new(),
            persona_id: "aimisi".into(),
            mouse_follow: false,
            user_name: String::new(),
            update_repo: DEFAULT_UPDATE_REPO.into(),
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        // SAFE-EXPECT: Tauri provides an app data directory after app setup.
        .expect("app data dir unavailable")
        .join("settings.json")
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    let mut settings: Settings = std::fs::read_to_string(settings_path(app))
        .ok()
        // Tolerate a UTF-8 BOM (e.g. written by PowerShell).
        .map(|s| s.trim_start_matches('\u{feff}').to_string())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if settings.persona_id == "default" {
        settings.persona_id = "aimisi".into();
    }
    settings.pet_scale = normalize_pet_scale(settings.pet_scale);
    settings.outline_width = normalize_render_value(
        settings.outline_width,
        OUTLINE_WIDTH_MIN,
        OUTLINE_WIDTH_MAX,
        DEFAULT_OUTLINE_WIDTH,
    );
    settings.rim_width = normalize_render_value(
        settings.rim_width,
        RIM_WIDTH_MIN,
        RIM_WIDTH_MAX,
        DEFAULT_RIM_WIDTH,
    );
    settings.rim_intensity = normalize_render_value(
        settings.rim_intensity,
        RIM_INTENSITY_MIN,
        RIM_INTENSITY_MAX,
        DEFAULT_RIM_INTENSITY,
    );
    settings.specular_intensity = normalize_render_value(
        settings.specular_intensity,
        SPECULAR_INTENSITY_MIN,
        SPECULAR_INTENSITY_MAX,
        DEFAULT_SPECULAR_INTENSITY,
    );
    settings.theme = normalize_theme(&settings.theme);
    settings.update_repo = migrated_update_repo(&settings.update_repo).into_owned();
    settings
}

fn save(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: tauri::State<SettingsState>) -> Settings {
    // SAFE-UNWRAP: a poisoned settings mutex means an earlier command panicked.
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(
    app: tauri::AppHandle,
    state: tauri::State<SettingsState>,
    mut settings: Settings,
) -> Result<(), String> {
    settings.pet_scale = normalize_pet_scale(settings.pet_scale);
    settings.outline_width = normalize_render_value(
        settings.outline_width,
        OUTLINE_WIDTH_MIN,
        OUTLINE_WIDTH_MAX,
        DEFAULT_OUTLINE_WIDTH,
    );
    settings.rim_width = normalize_render_value(
        settings.rim_width,
        RIM_WIDTH_MIN,
        RIM_WIDTH_MAX,
        DEFAULT_RIM_WIDTH,
    );
    settings.rim_intensity = normalize_render_value(
        settings.rim_intensity,
        RIM_INTENSITY_MIN,
        RIM_INTENSITY_MAX,
        DEFAULT_RIM_INTENSITY,
    );
    settings.specular_intensity = normalize_render_value(
        settings.specular_intensity,
        SPECULAR_INTENSITY_MIN,
        SPECULAR_INTENSITY_MAX,
        DEFAULT_SPECULAR_INTENSITY,
    );
    settings.theme = normalize_theme(&settings.theme);
    settings.update_repo = migrated_update_repo(&settings.update_repo).into_owned();
    // SAFE-UNWRAP: a poisoned settings mutex means an earlier command panicked.
    let old = { state.0.lock().unwrap().clone() };
    save(&app, &settings)?;
    apply(&app, &old, &settings);
    // SAFE-UNWRAP: a poisoned settings mutex means an earlier command panicked.
    *state.0.lock().unwrap() = settings.clone();
    // Notify every window (pet scale, persona, model...) of the change.
    let _ = app.emit("deskmate://settings-changed", &settings);
    Ok(())
}

/// Apply side-effectful settings (autostart, shortcuts, window state).
pub fn apply(app: &tauri::AppHandle, old: &Settings, new: &Settings) {
    // Autostart.
    if old.autostart != new.autostart {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        let result = if new.autostart {
            manager.enable()
        } else {
            manager.disable()
        };
        if let Err(e) = result {
            eprintln!("autostart update failed: {e}");
        }
    }

    // Pet window: visibility & always-on-top are native; scale resizes the
    // whole window (the canvas fills it, so the model grows with it).
    if let Some(pet) = app.get_webview_window("pet") {
        if old.pet_visible != new.pet_visible {
            let _ = if new.pet_visible {
                pet.show()
            } else {
                pet.hide()
            };
        }
        if old.always_on_top != new.always_on_top {
            let _ = pet.set_always_on_top(new.always_on_top);
        }
        if (old.pet_scale - new.pet_scale).abs() > f64::EPSILON {
            apply_pet_scale(&pet, new.pet_scale);
        }
    }

    // Global shortcuts.
    if old.shortcut_toggle_chat != new.shortcut_toggle_chat
        || old.shortcut_toggle_pet != new.shortcut_toggle_pet
    {
        register_shortcuts(app, new);
    }
}

/// Verify a gateway API key by hitting the OpenAI-compatible /v1/models
/// endpoint (done in Rust to avoid browser CORS restrictions).
/// Returns the model count on success; errors are machine codes that the
/// frontend localizes: empty_key / bad_url / unauthorized / not_found /
/// status:<code> / network:<detail>.
#[tauri::command]
pub fn verify_api_key(base_url: String, api_key: String) -> Result<Option<usize>, String> {
    if api_key.trim().is_empty() {
        return Err("empty_key".into());
    }
    let base = base_url.trim().trim_end_matches('/').to_string();
    if !base.starts_with("http") {
        return Err("bad_url".into());
    }
    let url = format!("{base}/v1/models");
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", api_key.trim()))
        .timeout(std::time::Duration::from_secs(10))
        .call();
    match resp {
        Ok(r) => Ok(r
            .into_json::<serde_json::Value>()
            .ok()
            .and_then(|v| v.get("data").and_then(|d| d.as_array().map(|a| a.len())))),
        Err(ureq::Error::Status(code, _)) => match code {
            401 | 403 => Err("unauthorized".into()),
            404 => Err("not_found".into()),
            _ => Err(format!("status:{code}")),
        },
        Err(e) => Err(format!("network:{e}")),
    }
}

/// Spawn the scheduler loop: every 20s, fire enabled tasks whose HH:MM
/// matches the current local minute. Firing = show chat + emit event with
/// the prompt; the chat window sends it to the AI like a user message.
pub fn start_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Guards against double-firing within the same minute.
        let mut last_fired: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(20));
            let now = chrono::Local::now().format("%H:%M").to_string();
            let tasks: Vec<ScheduledTask> = {
                let Some(state) = app.try_state::<SettingsState>() else {
                    continue;
                };
                // SAFE-UNWRAP: a poisoned settings mutex means an earlier command panicked.
                let guard = state.0.lock().unwrap();
                guard
                    .scheduled_tasks
                    .iter()
                    .filter(|t| t.enabled && t.time == now)
                    .cloned()
                    .collect()
            };
            for task in tasks {
                if last_fired.get(&task.id) == Some(&now) {
                    continue;
                }
                last_fired.insert(task.id.clone(), now.clone());
                // Bring the chat window up, then hand the prompt to it.
                let _ = crate::show_chat(&app);
                let _ = app.emit("deskmate://scheduled-task", &task);
            }
        }
    });
}

/// Base pet window size at scale 1.0 (matches tauri.conf.json).
const PET_BASE_W: f64 = 320.0;
const PET_BASE_H: f64 = 420.0;

/// Resize the pet window to `scale`, keeping its bottom-center anchored so
/// the pet stays planted where the user put it.
pub fn apply_pet_scale(pet: &tauri::WebviewWindow, scale: f64) {
    let scale = normalize_pet_scale(scale);
    let new_w = PET_BASE_W * scale;
    let new_h = PET_BASE_H * scale;

    let (Ok(pos), Ok(size), Ok(factor)) =
        (pet.outer_position(), pet.outer_size(), pet.scale_factor())
    else {
        return;
    };
    let logical_pos: tauri::LogicalPosition<f64> = pos.to_logical(factor);
    let logical_size: tauri::LogicalSize<f64> = size.to_logical(factor);

    // Keep bottom-center fixed.
    let cx = logical_pos.x + logical_size.width / 2.0;
    let bottom = logical_pos.y + logical_size.height;

    let _ = pet.set_size(tauri::LogicalSize::new(new_w, new_h));
    let _ = pet.set_position(tauri::LogicalPosition::new(
        cx - new_w / 2.0,
        (bottom - new_h).max(0.0),
    ));
}

/// (Re-)register all global shortcuts from settings.
pub fn register_shortcuts(app: &tauri::AppHandle, settings: &Settings) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if !settings.shortcut_toggle_chat.is_empty() {
        let shortcut = settings.shortcut_toggle_chat.clone();
        if let Err(e) = gs.on_shortcut(shortcut.as_str(), move |app, _sc, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = crate::toggle_chat_impl(app);
            }
        }) {
            eprintln!("register shortcut {shortcut} failed: {e}");
        }
    }

    if !settings.shortcut_toggle_pet.is_empty() {
        let shortcut = settings.shortcut_toggle_pet.clone();
        if let Err(e) = gs.on_shortcut(shortcut.as_str(), move |app, _sc, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                crate::toggle_pet_visibility(app);
            }
        }) {
            eprintln!("register shortcut {shortcut} failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_pet_scale, normalize_render_value, normalize_theme};

    #[test]
    fn pet_scale_is_clamped_to_the_supported_range() {
        assert_eq!(normalize_pet_scale(-1.0), 0.1);
        assert_eq!(normalize_pet_scale(0.1), 0.1);
        assert_eq!(normalize_pet_scale(1.25), 1.25);
        assert_eq!(normalize_pet_scale(2.5), 2.0);
    }

    #[test]
    fn theme_accepts_supported_palettes_and_falls_back_to_dark() {
        assert_eq!(normalize_theme("dark"), "dark");
        assert_eq!(normalize_theme("mint"), "mint");
        assert_eq!(normalize_theme("peach"), "peach");
        assert_eq!(normalize_theme("lavender"), "lavender");
        assert_eq!(normalize_theme("unknown"), "dark");
    }

    #[test]
    fn render_values_are_clamped_and_non_finite_values_use_defaults() {
        assert_eq!(normalize_render_value(-1.0, 0.0, 0.03, 0.0073), 0.0);
        assert_eq!(normalize_render_value(0.08, 0.0, 0.03, 0.0073), 0.03);
        assert_eq!(normalize_render_value(0.4, 0.0, 1.0, 0.4), 0.4);
        assert_eq!(normalize_render_value(f64::NAN, 0.0, 2.0, 1.0), 1.0);
        assert_eq!(normalize_render_value(f64::INFINITY, 0.0, 2.0, 1.0), 1.0);
    }
}
