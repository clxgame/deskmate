use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

mod update_repo;
use update_repo::{migrated_update_repo, DEFAULT_UPDATE_REPO};

const PET_SCALE_MIN: f64 = 0.1;
const PET_SCALE_MAX: f64 = 2.0;
const DEFAULT_PET_SCALE: f64 = 0.5;
const DEFAULT_THEME: &str = "dark";
const OUTLINE_WIDTH_MIN: f64 = 0.0;
const OUTLINE_WIDTH_MAX: f64 = 0.03;
const DEFAULT_OUTLINE_WIDTH: f64 = 0.0008;
const RIM_WIDTH_MIN: f64 = 0.0;
const RIM_WIDTH_MAX: f64 = 1.0;
const DEFAULT_RIM_WIDTH: f64 = 0.1;
const RIM_INTENSITY_MIN: f64 = 0.0;
const RIM_INTENSITY_MAX: f64 = 2.0;
const DEFAULT_RIM_INTENSITY: f64 = 0.3;
const SPECULAR_INTENSITY_MIN: f64 = 0.0;
const SPECULAR_INTENSITY_MAX: f64 = 2.0;
const DEFAULT_SPECULAR_INTENSITY: f64 = 0.05;

fn normalize_pet_scale(scale: f64) -> f64 {
    if scale.is_finite() {
        scale.clamp(PET_SCALE_MIN, PET_SCALE_MAX)
    } else {
        DEFAULT_PET_SCALE
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPosition {
    pub x: i32,
    pub y: i32,
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
    pub pet_position: Option<PetPosition>,
    pub scheduled_tasks: Vec<ScheduledTask>,
    // 快捷键
    pub shortcut_toggle_chat: String,
    pub shortcut_toggle_pet: String,
    // 账号
    pub persona_id: String,
    pub mouse_follow: bool,
    pub user_name: String,
    // 记忆
    /// Let the companion propose memories from the conversation. Off by
    /// default: automatic memory is opt-in.
    pub memory_auto_extract: bool,
    /// Allow relevant confirmed memories to be sent to the configured AI
    /// gateway. Off disables injection but keeps local memory management.
    pub memory_ai_use: bool,
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
            pet_scale: DEFAULT_PET_SCALE,
            outline_width: DEFAULT_OUTLINE_WIDTH,
            rim_width: DEFAULT_RIM_WIDTH,
            rim_intensity: DEFAULT_RIM_INTENSITY,
            specular_intensity: DEFAULT_SPECULAR_INTENSITY,
            pet_visible: true,
            always_on_top: true,
            pet_position: None,
            scheduled_tasks: Vec::new(),
            // NOTE: Alt+Space is the Windows system menu and Ctrl+Shift+Space
            // is commonly taken by IMEs; Ctrl+Alt+D is usually free.
            shortcut_toggle_chat: "Ctrl+Alt+D".into(),
            shortcut_toggle_pet: String::new(),
            persona_id: "xiaozhu".into(),
            mouse_follow: true,
            user_name: String::new(),
            // Automatic extraction is opt-in; using stored memories in replies
            // is on so an explicitly remembered fact is actually useful.
            memory_auto_extract: false,
            memory_ai_use: true,
            update_repo: DEFAULT_UPDATE_REPO.into(),
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

const MODEL_CATALOG_FILE: &str = "model-catalog.json";
const YUME_PROVIDER_ID: &str = "yume";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiModel {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelCatalog {
    pub(crate) base_url: String,
    pub(crate) models: Vec<ApiModel>,
}

impl Default for SettingsState {
    fn default() -> Self {
        Self(Mutex::new(Settings::default()))
    }
}

/// The API key is a credential, not a preference: it lives in the OS keystore
/// (Windows Credential Manager / macOS Keychain) instead of settings.json.
const KEYRING_SERVICE: &str = "com.deskmate.desktop";
const KEYRING_USER: &str = "ai-api-key";

fn api_key_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
}

fn load_api_key() -> String {
    api_key_entry()
        .and_then(|entry| entry.get_password().ok())
        .unwrap_or_default()
}

/// Persist (or clear) the API key in the OS keystore.
fn store_api_key(api_key: &str) -> Result<(), String> {
    let Some(entry) = api_key_entry() else {
        return Err("无法访问系统凭据存储，API Key 未能保存".to_string());
    };
    if api_key.is_empty() {
        return match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("无法清除已保存的 API Key: {e}")),
        };
    }
    entry
        .set_password(api_key)
        .map_err(|e| format!("无法保存 API Key 到系统凭据存储: {e}"))
}

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
    // "default" was the pre-pack persona id; 小著 is the built-in fallback now.
    if settings.persona_id == "default" {
        settings.persona_id = "xiaozhu".into();
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

    // Migrate a legacy plaintext key out of settings.json into the OS keystore,
    // then rewrite the file so the secret stops living on disk.
    let legacy_key = std::mem::take(&mut settings.api_key);
    if !legacy_key.trim().is_empty() {
        match store_api_key(legacy_key.trim()) {
            Ok(()) => {
                settings.api_key = legacy_key.trim().to_string();
                if let Err(e) = save(app, &settings) {
                    eprintln!("could not scrub legacy api key from settings.json: {e}");
                }
            }
            Err(e) => {
                // Keystore unavailable: keep the key usable in memory this run
                // rather than silently locking the user out of their model.
                eprintln!("api key migration failed: {e}");
                settings.api_key = legacy_key;
            }
        }
    } else {
        settings.api_key = load_api_key();
    }
    settings
}

pub fn persist_pet_position(app: &tauri::AppHandle, position: tauri::PhysicalPosition<i32>) {
    let Some(state) = app.try_state::<SettingsState>() else {
        return;
    };
    let Ok(mut settings) = state.0.lock() else {
        eprintln!("could not persist pet position: settings state poisoned");
        return;
    };
    let next = PetPosition {
        x: position.x,
        y: position.y,
    };
    if settings.pet_position == Some(next) {
        return;
    }
    settings.pet_position = Some(next);
    if let Err(error) = save(app, &settings) {
        eprintln!("could not persist pet position: {error}");
    }
}

/// The on-disk form of the settings: identical except the credential is removed.
fn redacted_for_disk(settings: &Settings) -> Settings {
    Settings {
        api_key: String::new(),
        ..settings.clone()
    }
}

fn save(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Never write the API key to disk; it belongs to the OS keystore.
    let json =
        serde_json::to_string_pretty(&redacted_for_disk(settings)).map_err(|e| e.to_string())?;
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
    settings.api_key = settings.api_key.trim().to_string();
    // Store the credential in the OS keystore before anything else, so a
    // keystore failure surfaces to the user instead of being lost silently.
    store_api_key(&settings.api_key)?;
    // SAFE-UNWRAP: a poisoned settings mutex means an earlier command panicked.
    let old = { state.0.lock().unwrap().clone() };
    if settings.pet_position.is_none() {
        settings.pet_position = old.pet_position;
    }
    save(&app, &settings)?;
    apply(&app, &old, &settings);
    // SAFE-UNWRAP: a poisoned settings mutex means an earlier command panicked.
    *state.0.lock().unwrap() = settings.clone();
    // Notify every window (pet scale, persona, model...) of the change.
    let _ = app.emit("deskmate://settings-changed", &settings);
    Ok(())
}

fn model_catalog_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir unavailable")
        .join(MODEL_CATALOG_FILE)
}

fn save_model_catalog(app: &tauri::AppHandle, catalog: &ModelCatalog) -> Result<(), String> {
    let path = model_catalog_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(catalog).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub(crate) fn load_model_catalog(app: &tauri::AppHandle) -> Option<ModelCatalog> {
    std::fs::read_to_string(model_catalog_path(app))
        .ok()
        .and_then(|raw| serde_json::from_str::<ModelCatalog>(&raw).ok())
        .filter(|catalog| {
            catalog.base_url.starts_with("http://") || catalog.base_url.starts_with("https://")
        })
}

pub(crate) fn sidecar_environment(app: &tauri::AppHandle) -> Option<(String, String)> {
    let catalog = load_model_catalog(app)?;
    let api_key = load_api_key();
    build_sidecar_environment(&catalog, &api_key)
}

fn build_sidecar_environment(catalog: &ModelCatalog, api_key: &str) -> Option<(String, String)> {
    if api_key.trim().is_empty() || catalog.models.is_empty() {
        return None;
    }

    let models = catalog
        .models
        .iter()
        .map(|model| (model.id.clone(), serde_json::json!({ "name": model.name })))
        .collect::<serde_json::Map<String, serde_json::Value>>();
    let config = serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            YUME_PROVIDER_ID: {
                "npm": "@ai-sdk/openai-compatible",
                "name": "YUME",
                "options": { "baseURL": catalog.base_url },
                "models": models,
            }
        }
    });
    let auth = serde_json::json!({
        YUME_PROVIDER_ID: { "type": "api", "key": api_key.trim() }
    });
    Some((config.to_string(), auth.to_string()))
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

fn parse_api_models(payload: &serde_json::Value) -> Result<Vec<ApiModel>, String> {
    let data = payload
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "invalid_response".to_string())?;
    let mut seen = std::collections::HashSet::new();
    let mut models = Vec::new();
    for item in data {
        let Some(id) = ["id", "model", "slug"]
            .into_iter()
            .find_map(|key| item.get(key).and_then(serde_json::Value::as_str))
            .map(str::trim)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if !seen.insert(id.to_string()) {
            continue;
        }
        let name = item
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(id)
            .to_string();
        models.push(ApiModel {
            id: id.to_string(),
            name,
        });
    }
    Ok(models)
}

fn fetch_api_models(base_url: &str, api_key: &str) -> Result<Vec<ApiModel>, String> {
    let base = base_url.trim().trim_end_matches('/');
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err("bad_url".into());
    }
    let url = format!("{base}/v1/models");
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", api_key.trim()))
        .timeout(std::time::Duration::from_secs(10))
        .call();
    match resp {
        Ok(r) => {
            let payload = r
                .into_json::<serde_json::Value>()
                .map_err(|_| "invalid_response".to_string())?;
            parse_api_models(&payload)
        }
        Err(ureq::Error::Status(code, _)) => match code {
            401 | 403 => Err("unauthorized".into()),
            404 => Err("not_found".into()),
            _ => Err(format!("status:{code}")),
        },
        Err(e) => Err(format!("network:{e}")),
    }
}

#[tauri::command]
pub fn verify_api_key(
    app: tauri::AppHandle,
    base_url: String,
    api_key: String,
) -> Result<Option<usize>, String> {
    if api_key.trim().is_empty() {
        return Err("empty_key".into());
    }
    let base = base_url.trim().trim_end_matches('/').to_string();
    let models = fetch_api_models(&base, &api_key)?;
    if models.is_empty() {
        return Err("no_models".into());
    }
    store_api_key(api_key.trim())?;
    save_model_catalog(
        &app,
        &ModelCatalog {
            base_url: base,
            models: models.clone(),
        },
    )?;
    crate::restart_sidecar(&app)?;
    Ok(Some(models.len()))
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
    use super::{
        build_sidecar_environment, normalize_pet_scale, normalize_render_value, normalize_theme,
        parse_api_models, redacted_for_disk, ApiModel, ModelCatalog, PetPosition, Settings,
        SettingsState,
    };

    #[test]
    fn parses_openai_model_catalog_into_stable_display_metadata() {
        let payload = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "model-a", "name": "Model A" },
                { "id": "model-b", "owned_by": "team-b" },
                { "id": "model-a", "name": "duplicate" },
                { "object": "model" }
            ]
        });

        let models = parse_api_models(&payload).expect("valid model catalog");

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "model-a");
        assert_eq!(models[0].name, "Model A");
        assert_eq!(models[1].id, "model-b");
        assert_eq!(models[1].name, "model-b");
    }

    #[test]
    fn generated_sidecar_environment_declares_the_yume_provider() {
        let catalog = ModelCatalog {
            base_url: "https://models.example.test".into(),
            models: vec![ApiModel {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
        };

        let (config, auth) =
            build_sidecar_environment(&catalog, "secret-key").expect("configured provider");
        let config = serde_json::from_str::<serde_json::Value>(&config).expect("valid config");
        let auth = serde_json::from_str::<serde_json::Value>(&auth).expect("valid auth");

        assert_eq!(config["provider"]["yume"]["name"], "YUME");
        assert_eq!(
            config["provider"]["yume"]["options"]["baseURL"],
            "https://models.example.test"
        );
        assert_eq!(
            config["provider"]["yume"]["models"]["model-a"]["name"],
            "Model A"
        );
        assert_eq!(auth["yume"]["type"], "api");
        assert_eq!(auth["yume"]["key"], "secret-key");
    }

    #[test]
    fn settings_state_has_defaults_before_setup_hydrates_persisted_values() {
        let state = SettingsState::default();
        let settings = state.0.lock().expect("startup settings state").clone();
        assert_eq!(settings.persona_id, "xiaozhu");
        assert!(settings.pet_visible);
    }

    #[test]
    fn default_persona_is_the_built_in_one() {
        // 小著 is the only persona bundled with the app. Defaulting to a persona
        // that lives in an optional pack would leave a fresh install with no pet.
        let settings = Settings::default();
        assert_eq!(settings.persona_id, "xiaozhu");
        assert_eq!(settings.pet_scale, 0.5);
        assert_eq!(settings.outline_width, 0.0008);
        assert_eq!(settings.rim_width, 0.1);
        assert_eq!(settings.rim_intensity, 0.3);
        assert_eq!(settings.specular_intensity, 0.05);
        assert!(settings.mouse_follow);
    }

    #[test]
    fn pet_position_is_optional_for_legacy_settings_and_round_trips() {
        let legacy: Settings = serde_json::from_str("{}").expect("legacy settings");
        assert_eq!(legacy.pet_position, None);

        let positioned: Settings = serde_json::from_str(r#"{"petPosition":{"x":123,"y":456}}"#)
            .expect("positioned settings");
        assert_eq!(
            positioned.pet_position,
            Some(PetPosition { x: 123, y: 456 })
        );
        let json = serde_json::to_string(&positioned).expect("settings serialize");
        assert!(json.contains("\"petPosition\":{\"x\":123,\"y\":456}"));
    }

    #[test]
    fn api_key_is_never_serialized_to_settings_json() {
        let settings = Settings {
            api_key: "super-secret-key".into(),
            base_url: "https://example.invalid".into(),
            ..Settings::default()
        };

        let on_disk = redacted_for_disk(&settings);
        assert_eq!(on_disk.api_key, "");
        // Non-secret preferences must survive the redaction untouched.
        assert_eq!(on_disk.base_url, "https://example.invalid");

        let json = serde_json::to_string(&on_disk).expect("settings serialize");
        assert!(!json.contains("super-secret-key"));
    }

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

    #[test]
    fn memory_defaults_are_opt_in_for_extraction_and_on_for_use() {
        let settings = Settings::default();
        assert!(
            !settings.memory_auto_extract,
            "automatic extraction must be opt-in"
        );
        assert!(settings.memory_ai_use);
    }

    #[test]
    fn a_settings_file_predating_memory_still_loads() {
        // A real 0.1.5 settings.json has no memory fields at all.
        let legacy = r#"{
            "autostart": false,
            "language": "zh-CN",
            "theme": "mint",
            "personaId": "changli",
            "scheduledTasks": [{"id":"t1","time":"09:00","prompt":"喝水","enabled":true}]
        }"#;
        let settings: Settings = serde_json::from_str(legacy).expect("legacy settings parse");
        assert_eq!(settings.theme, "mint");
        assert_eq!(settings.persona_id, "changli");
        assert_eq!(settings.scheduled_tasks.len(), 1);
        // Missing memory fields fall back to the conservative defaults.
        assert!(!settings.memory_auto_extract);
        assert!(settings.memory_ai_use);
    }
}
