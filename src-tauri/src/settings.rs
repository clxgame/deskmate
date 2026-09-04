use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

mod ai_endpoint;
mod update_repo;
use ai_endpoint::{migrated_ai_base_url, normalize_base_url, DEFAULT_AI_BASE_URL};
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

/// A configured AI gateway. Multiple providers are injected into the sidecar
/// and each renders its own usage card. `id` is a stable uuid used to address
/// the keystore entry and catalog file; `sidecar_id` is the key in the
/// opencode provider map (`yume`, `yume-2`, …) and must be unique across all
/// providers so model selection (`providerID` in the prompt contract) routes
/// to the right gateway.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiProvider {
    pub id: String,
    pub sidecar_id: String,
    pub label: String,
    pub base_url: String,
    /// In-memory only; `redacted_for_disk` clears it before persisting.
    pub api_key: String,
}

impl Default for AiProvider {
    fn default() -> Self {
        Self {
            id: String::new(),
            sidecar_id: "yume".into(),
            label: String::new(),
            base_url: DEFAULT_AI_BASE_URL.into(),
            api_key: String::new(),
        }
    }
}

/// The sidecar provider key for the first (legacy-migrated) gateway stays
/// `yume` so existing configs keep working; later gateways get `yume-2`, …
fn frontier_sidecar_id(existing: &[AiProvider]) -> String {
    if existing.is_empty() {
        return "yume".into();
    }
    let mut n = existing.len() + 1;
    loop {
        let candidate = format!("yume-{n}");
        if !existing.iter().any(|p| p.sidecar_id == candidate) {
            return candidate;
        }
        n += 1;
    }
}

fn reconcile_verified_settings_binding(
    settings: &mut Settings,
    provider_id: &str,
    base_url: &str,
    api_key: &str,
) {
    let Some(provider) = settings.providers.iter_mut().find(|p| p.id == provider_id) else {
        return;
    };
    provider.base_url = normalize_base_url(base_url);
    if !api_key.trim().is_empty() {
        provider.api_key = api_key.trim().to_owned();
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
    /// Configured gateways; the first is the legacy-migrated one.
    pub providers: Vec<AiProvider>,
    /// The provider currently in focus (default model / initial usage card);
    /// routing follows the selected model's own gateway, so this is a focus
    /// marker, not a routing gate.
    pub active_provider_id: String,
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
            base_url: DEFAULT_AI_BASE_URL.into(),
            api_key: String::new(),
            providers: Vec::new(),
            active_provider_id: String::new(),
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

const MODEL_CATALOG_DIR: &str = "model-catalogs";
/// Legacy single-file catalog path; used only to migrate into per-provider files.
const LEGACY_MODEL_CATALOG_FILE: &str = "model-catalog.json";
const CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL: &str = "ccswitch_prepare_opencode_provider";
const DENIED_OPENCODE_PERMISSIONS: &[&str] = &[
    "bash",
    "edit",
    "write",
    "patch",
    "external_directory",
    "task",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiModel {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelCatalog {
    pub(crate) base_url: String,
    pub(crate) api_key_fingerprint: String,
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
/// Legacy single-key entry; superseded by per-provider entries once a
/// provider list exists. Kept only to migrate an existing key into
/// `providers[0]`.
const LEGACY_KEYRING_USER: &str = "ai-api-key";

fn api_key_entry(user: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, user).ok()
}

/// The keystore username for a given provider, e.g. `ai-api-key.<provider_id>`.
fn api_key_user_for(provider_id: &str) -> String {
    format!("ai-api-key.{provider_id}")
}

fn read_api_key_user(user: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, user)
        .map_err(|e| format!("无法访问系统凭据存储: {e}"))?;
    match entry.get_password() {
        Ok(api_key) => Ok(api_key),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(format!("无法读取 API Key: {e}")),
    }
}

/// Read the API key for a single provider from the OS keystore.
pub(crate) fn saved_api_key(provider_id: &str) -> String {
    api_key_entry(&api_key_user_for(provider_id))
        .and_then(|entry| entry.get_password().ok())
        .unwrap_or_default()
}

/// The active provider (the one in focus for deployment/usage). Falls back to
/// the first provider when none is marked active.
pub(crate) fn active_provider(settings: &Settings) -> Option<&AiProvider> {
    if settings.providers.is_empty() {
        return None;
    }
    settings
        .providers
        .iter()
        .find(|p| p.id == settings.active_provider_id)
        .or_else(|| settings.providers.first())
}

/// Convenience for call sites holding a `SettingsState`: clone the active
/// provider, or `None` when unavailable.
pub(crate) fn active_provider_clone(state: &SettingsState) -> Option<AiProvider> {
    let settings = state.0.lock().ok()?;
    active_provider(&settings).cloned()
}

/// Persist (or clear) the API key for one provider in the OS keystore.
fn store_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    let Some(entry) = api_key_entry(&api_key_user_for(provider_id)) else {
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

/// Delete one provider's keystore entry. Not found is treated as success so
/// removing a provider that never had a key is idempotent.
fn delete_api_key(provider_id: &str) -> Result<(), String> {
    let Some(entry) = api_key_entry(&api_key_user_for(provider_id)) else {
        return Err("无法访问系统凭据存储，API Key 未能清除".to_string());
    };
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("无法清除已保存的 API Key: {e}")),
    }
}

/// Delete the legacy single-key entry after it has been migrated into a
/// provider's own slot, so the secret doesn't linger under the old name.
fn delete_legacy_api_key() -> Result<(), String> {
    let Some(entry) = api_key_entry(LEGACY_KEYRING_USER) else {
        return Ok(());
    };
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("无法清除旧的 API Key: {e}")),
    }
}

trait LegacyApiKeyMigrationOps {
    fn read_legacy_api_key(&self) -> Result<String, String>;
    fn store_provider_api_key(&self, provider_id: &str, api_key: &str) -> Result<(), String>;
    fn read_provider_api_key(&self, provider_id: &str) -> Result<String, String>;
    fn delete_legacy_api_key(&self) -> Result<(), String>;
}

struct KeyringLegacyApiKeyMigrationOps;

impl LegacyApiKeyMigrationOps for KeyringLegacyApiKeyMigrationOps {
    fn read_legacy_api_key(&self) -> Result<String, String> {
        read_api_key_user(LEGACY_KEYRING_USER)
    }

    fn store_provider_api_key(&self, provider_id: &str, api_key: &str) -> Result<(), String> {
        store_api_key(provider_id, api_key)
    }

    fn read_provider_api_key(&self, provider_id: &str) -> Result<String, String> {
        read_api_key_user(&api_key_user_for(provider_id))
    }

    fn delete_legacy_api_key(&self) -> Result<(), String> {
        delete_legacy_api_key()
    }
}

fn migrate_legacy_api_key_to_provider_after_persisted(
    ops: &impl LegacyApiKeyMigrationOps,
    provider_id: &str,
    preferred_key: Option<&str>,
    persist_provider_locator: impl FnOnce(&str) -> Result<(), String>,
) -> Result<Option<String>, String> {
    let legacy_key = ops.read_legacy_api_key()?;
    let target_key = preferred_key
        .filter(|key| !key.is_empty())
        .unwrap_or(&legacy_key);
    if target_key.is_empty() {
        return Ok(None);
    }

    ops.store_provider_api_key(provider_id, target_key)?;
    let scoped_key = ops.read_provider_api_key(provider_id)?;
    if scoped_key != target_key {
        return Err(
            "provider-scoped API Key read-back mismatch; legacy API Key was preserved".into(),
        );
    }

    persist_provider_locator(target_key)?;
    if !legacy_key.is_empty() {
        ops.delete_legacy_api_key()?;
    }
    Ok(Some(target_key.to_owned()))
}

fn hydrate_provider_api_keys(
    ops: &impl LegacyApiKeyMigrationOps,
    settings: &mut Settings,
) -> Result<(), String> {
    for provider in &mut settings.providers {
        if !provider.api_key.trim().is_empty() {
            provider.api_key = provider.api_key.trim().to_owned();
            continue;
        }
        let saved_key = ops.read_provider_api_key(&provider.id)?;
        if !saved_key.trim().is_empty() {
            provider.api_key = saved_key.trim().to_owned();
        }
    }
    Ok(())
}

fn providers_requiring_catalog_clear(old: &Settings, new: &Settings) -> Vec<String> {
    old.providers
        .iter()
        .filter_map(|old_provider| {
            let new_provider = new.providers.iter().find(|p| p.id == old_provider.id)?;
            let base_url_changed = normalize_base_url(&old_provider.base_url)
                != normalize_base_url(&new_provider.base_url);
            let key_changed = old_provider.api_key.trim() != new_provider.api_key.trim();
            (base_url_changed || key_changed).then(|| old_provider.id.clone())
        })
        .collect()
}

fn resolve_verify_provider_id(
    settings: &Settings,
    provider_id: Option<&str>,
) -> Result<String, String> {
    match provider_id {
        Some(id) if !id.trim().is_empty() => settings
            .providers
            .iter()
            .find(|provider| provider.id == id.trim())
            .map(|provider| provider.id.clone())
            .ok_or_else(|| "unknown_provider".to_string()),
        _ => active_provider(settings)
            .map(|provider| provider.id.clone())
            .ok_or_else(|| "unknown_provider".to_string()),
    }
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
    settings.base_url =
        migrated_ai_base_url(&settings.provider_id, &settings.base_url).into_owned();
    settings.update_repo = migrated_update_repo(&settings.update_repo).into_owned();

    // Migrate a legacy plaintext key out of settings.json into the OS keystore
    // (under the provider's own slot), then rewrite the file so the secret
    // stops living on disk. If no provider list exists yet, seed `providers[0]`
    // from the legacy single-value fields.
    if let Err(e) = migrate_legacy_key_and_catalog(app, &mut settings) {
        eprintln!("api key migration failed: {e}");
    }
    settings
}

/// One-time upgrade from the single-value `base_url`/`api_key` era to the
/// provider list, moving the credential out of settings.json into the
/// per-provider keystore slot and seeding the verified catalog file.
fn migrate_legacy_key_and_catalog(
    app: &tauri::AppHandle,
    settings: &mut Settings,
) -> Result<(), String> {
    let seeded_provider = settings.providers.is_empty();
    if settings.providers.is_empty() {
        let id = uuid::Uuid::new_v4().to_string();
        let sidecar_id = frontier_sidecar_id(&[]);
        settings.providers.push(AiProvider {
            id: id.clone(),
            sidecar_id,
            label: String::new(),
            base_url: settings.base_url.clone(),
            api_key: std::mem::take(&mut settings.api_key),
        });
        settings.active_provider_id = id.clone();
    }

    // The credential source for providers[0]: a legacy plaintext key in
    // settings.json (pre-keystore era), else the per-provider keystore slot,
    // else the old single `ai-api-key` entry.
    let provider_id = settings.providers[0].id.clone();
    let plaintext_key = settings.providers[0].api_key.trim().to_owned();
    hydrate_provider_api_keys(&KeyringLegacyApiKeyMigrationOps, settings)?;
    let scoped_key = settings.providers[0].api_key.trim().to_owned();
    let preferred_key = if !plaintext_key.is_empty() {
        Some(plaintext_key)
    } else if !scoped_key.is_empty() {
        Some(scoped_key)
    } else {
        None
    };
    let migrated_key = migrate_legacy_api_key_to_provider_after_persisted(
        &KeyringLegacyApiKeyMigrationOps,
        &provider_id,
        preferred_key.as_deref(),
        |target_key| {
            settings.providers[0].api_key = target_key.to_owned();
            save(app, settings)
        },
    )?;
    if let Some(target_key) = migrated_key {
        settings.providers[0].api_key = target_key;
    } else if seeded_provider {
        save(app, settings)?;
    }
    migrate_legacy_model_catalog(app, &provider_id)?;
    Ok(())
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
    let mut on_disk = settings.clone();
    on_disk.api_key.clear();
    for provider in &mut on_disk.providers {
        provider.api_key.clear();
    }
    on_disk
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

#[derive(Clone, Debug, PartialEq, Eq)]
enum StoredValueChange<T> {
    Keep,
    Put(T),
    Remove,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ProviderStorageChange {
    provider_id: String,
    key: StoredValueChange<String>,
    catalog: StoredValueChange<Vec<u8>>,
}

struct SettingsStorageTransaction<'a> {
    settings: &'a Settings,
    providers: Vec<ProviderStorageChange>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ProviderStorageSnapshot {
    key: String,
    catalog: Option<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppliedStorageChange {
    Key(usize),
    Catalog(usize),
    Settings,
}

trait SettingsTransactionOps {
    fn read_provider_key(&self, provider_id: &str) -> Result<String, String>;
    fn store_provider_key(&self, provider_id: &str, api_key: &str) -> Result<(), String>;
    fn delete_provider_key(&self, provider_id: &str) -> Result<(), String>;
    fn read_provider_catalog(&self, provider_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store_provider_catalog(&self, provider_id: &str, catalog: &[u8]) -> Result<(), String>;
    fn delete_provider_catalog(&self, provider_id: &str) -> Result<(), String>;
    fn read_settings_file(&self) -> Result<Option<Vec<u8>>, String>;
    fn save_settings(&self, settings: &Settings) -> Result<(), String>;
    fn restore_settings_file(&self, settings: Option<&[u8]>) -> Result<(), String>;
}

struct AppSettingsTransactionOps<'a> {
    app: &'a tauri::AppHandle,
}

fn read_optional_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

fn restore_optional_file(path: &Path, bytes: Option<&[u8]>) -> Result<(), String> {
    match bytes {
        Some(bytes) => write_file(path, bytes),
        None => match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

impl SettingsTransactionOps for AppSettingsTransactionOps<'_> {
    fn read_provider_key(&self, provider_id: &str) -> Result<String, String> {
        read_api_key_user(&api_key_user_for(provider_id))
    }

    fn store_provider_key(&self, provider_id: &str, api_key: &str) -> Result<(), String> {
        store_api_key(provider_id, api_key)
    }

    fn delete_provider_key(&self, provider_id: &str) -> Result<(), String> {
        delete_api_key(provider_id)
    }

    fn read_provider_catalog(&self, provider_id: &str) -> Result<Option<Vec<u8>>, String> {
        read_optional_file(&model_catalog_path_for_provider(self.app, provider_id))
    }

    fn store_provider_catalog(&self, provider_id: &str, catalog: &[u8]) -> Result<(), String> {
        write_file(
            &model_catalog_path_for_provider(self.app, provider_id),
            catalog,
        )
    }

    fn delete_provider_catalog(&self, provider_id: &str) -> Result<(), String> {
        clear_model_catalog_for_provider(self.app, provider_id)
    }

    fn read_settings_file(&self) -> Result<Option<Vec<u8>>, String> {
        read_optional_file(&settings_path(self.app))
    }

    fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        save(self.app, settings)
    }

    fn restore_settings_file(&self, settings: Option<&[u8]>) -> Result<(), String> {
        restore_optional_file(&settings_path(self.app), settings)
    }
}

fn restore_storage_transaction(
    ops: &impl SettingsTransactionOps,
    transaction: &SettingsStorageTransaction<'_>,
    snapshots: &[ProviderStorageSnapshot],
    settings_snapshot: Option<&[u8]>,
    applied: &[AppliedStorageChange],
) -> Vec<String> {
    let mut errors = Vec::new();
    for change in applied.iter().rev() {
        let result = match *change {
            AppliedStorageChange::Settings => ops.restore_settings_file(settings_snapshot),
            AppliedStorageChange::Key(index) => {
                let provider_id = &transaction.providers[index].provider_id;
                let key = &snapshots[index].key;
                if key.is_empty() {
                    ops.delete_provider_key(provider_id)
                } else {
                    ops.store_provider_key(provider_id, key)
                }
            }
            AppliedStorageChange::Catalog(index) => {
                let provider_id = &transaction.providers[index].provider_id;
                match snapshots[index].catalog.as_deref() {
                    Some(catalog) => ops.store_provider_catalog(provider_id, catalog),
                    None => ops.delete_provider_catalog(provider_id),
                }
            }
        };
        if let Err(error) = result {
            errors.push(format!("{change:?}: {error}"));
        }
    }
    errors
}

fn transaction_failure(
    ops: &impl SettingsTransactionOps,
    transaction: &SettingsStorageTransaction<'_>,
    snapshots: &[ProviderStorageSnapshot],
    settings_snapshot: Option<&[u8]>,
    applied: &[AppliedStorageChange],
    original: String,
) -> String {
    let rollback_errors =
        restore_storage_transaction(ops, transaction, snapshots, settings_snapshot, applied);
    if rollback_errors.is_empty() {
        original
    } else {
        format!(
            "{original}; rollback failed: {}",
            rollback_errors.join("; ")
        )
    }
}

fn execute_settings_storage_transaction(
    ops: &impl SettingsTransactionOps,
    transaction: &SettingsStorageTransaction<'_>,
) -> Result<(), String> {
    let settings_snapshot = ops.read_settings_file()?;
    let mut snapshots = Vec::with_capacity(transaction.providers.len());
    for provider in &transaction.providers {
        snapshots.push(ProviderStorageSnapshot {
            key: ops.read_provider_key(&provider.provider_id)?,
            catalog: ops.read_provider_catalog(&provider.provider_id)?,
        });
    }

    let mut applied = Vec::new();
    for (index, provider) in transaction.providers.iter().enumerate() {
        let key_result = match &provider.key {
            StoredValueChange::Keep => Ok(()),
            StoredValueChange::Put(key) if snapshots[index].key == *key => Ok(()),
            StoredValueChange::Put(key) => {
                applied.push(AppliedStorageChange::Key(index));
                ops.store_provider_key(&provider.provider_id, key)
            }
            StoredValueChange::Remove if snapshots[index].key.is_empty() => Ok(()),
            StoredValueChange::Remove => {
                applied.push(AppliedStorageChange::Key(index));
                ops.delete_provider_key(&provider.provider_id)
            }
        };
        if let Err(error) = key_result {
            return Err(transaction_failure(
                ops,
                transaction,
                &snapshots,
                settings_snapshot.as_deref(),
                &applied,
                error,
            ));
        }

        let catalog_result = match &provider.catalog {
            StoredValueChange::Keep => Ok(()),
            StoredValueChange::Put(catalog)
                if snapshots[index].catalog.as_deref() == Some(catalog.as_slice()) =>
            {
                Ok(())
            }
            StoredValueChange::Put(catalog) => {
                applied.push(AppliedStorageChange::Catalog(index));
                ops.store_provider_catalog(&provider.provider_id, catalog)
            }
            StoredValueChange::Remove if snapshots[index].catalog.is_none() => Ok(()),
            StoredValueChange::Remove => {
                applied.push(AppliedStorageChange::Catalog(index));
                ops.delete_provider_catalog(&provider.provider_id)
            }
        };
        if let Err(error) = catalog_result {
            return Err(transaction_failure(
                ops,
                transaction,
                &snapshots,
                settings_snapshot.as_deref(),
                &applied,
                error,
            ));
        }
    }

    applied.push(AppliedStorageChange::Settings);
    if let Err(error) = ops.save_settings(transaction.settings) {
        return Err(transaction_failure(
            ops,
            transaction,
            &snapshots,
            settings_snapshot.as_deref(),
            &applied,
            error,
        ));
    }
    Ok(())
}

fn persist_settings_update(
    ops: &impl SettingsTransactionOps,
    old: &Settings,
    new: &Settings,
) -> Result<(), String> {
    let catalogs_to_clear = providers_requiring_catalog_clear(old, new);
    let mut providers = new
        .providers
        .iter()
        .filter_map(|provider| {
            let key_changed = old
                .providers
                .iter()
                .find(|old_provider| old_provider.id == provider.id)
                .is_none_or(|old_provider| old_provider.api_key != provider.api_key);
            let clear_catalog = catalogs_to_clear.contains(&provider.id);
            (key_changed || clear_catalog).then(|| ProviderStorageChange {
                provider_id: provider.id.clone(),
                key: if !key_changed {
                    StoredValueChange::Keep
                } else if provider.api_key.is_empty() {
                    StoredValueChange::Remove
                } else {
                    StoredValueChange::Put(provider.api_key.clone())
                },
                catalog: if clear_catalog {
                    StoredValueChange::Remove
                } else {
                    StoredValueChange::Keep
                },
            })
        })
        .collect::<Vec<_>>();
    providers.extend(
        old.providers
            .iter()
            .filter(|old_provider| {
                !new.providers
                    .iter()
                    .any(|new_provider| new_provider.id == old_provider.id)
            })
            .map(|provider| ProviderStorageChange {
                provider_id: provider.id.clone(),
                key: StoredValueChange::Remove,
                catalog: StoredValueChange::Remove,
            }),
    );
    execute_settings_storage_transaction(
        ops,
        &SettingsStorageTransaction {
            settings: new,
            providers,
        },
    )
}

struct VerifiedSettingsWrite<'a> {
    provider_id: &'a str,
    api_key: &'a str,
    catalog: &'a ModelCatalog,
    settings: &'a Settings,
}

fn persist_verified_settings(
    ops: &impl SettingsTransactionOps,
    write: &VerifiedSettingsWrite<'_>,
) -> Result<(), String> {
    let catalog = serde_json::to_vec_pretty(write.catalog).map_err(|error| error.to_string())?;
    execute_settings_storage_transaction(
        ops,
        &SettingsStorageTransaction {
            settings: write.settings,
            providers: vec![ProviderStorageChange {
                provider_id: write.provider_id.into(),
                key: StoredValueChange::Put(write.api_key.into()),
                catalog: StoredValueChange::Put(catalog),
            }],
        },
    )
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
    // SAFE-UNWRAP: a poisoned settings mutex means an earlier command panicked.
    let old = { state.0.lock().unwrap().clone() };
    for provider in &mut settings.providers {
        provider.base_url = normalize_base_url(&provider.base_url);
        let key = provider.api_key.trim().to_owned();
        if key.is_empty() {
            if let Some(old_provider) = old.providers.iter().find(|p| p.id == provider.id) {
                let old_key = old_provider.api_key.trim();
                if old_key.is_empty() {
                    let saved_key = saved_api_key(&provider.id);
                    provider.api_key = saved_key.trim().to_owned();
                } else {
                    provider.api_key = old_key.to_owned();
                }
            }
        } else {
            provider.api_key = key;
        }
    }
    if settings.pet_position.is_none() {
        settings.pet_position = old.pet_position;
    }
    persist_settings_update(&AppSettingsTransactionOps { app: &app }, &old, &settings)?;
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
        // SAFE-EXPECT: Tauri provides an app data directory after app setup.
        .expect("app data dir unavailable")
        .join(legacy_model_catalog_relative_path())
}

fn model_catalog_path_for_provider(app: &tauri::AppHandle, provider_id: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        // SAFE-EXPECT: Tauri provides an app data directory after app setup.
        .expect("app data dir unavailable")
        .join(provider_model_catalog_relative_path(provider_id))
}

fn legacy_model_catalog_relative_path() -> PathBuf {
    PathBuf::from(LEGACY_MODEL_CATALOG_FILE)
}

fn provider_model_catalog_relative_path(provider_id: &str) -> PathBuf {
    PathBuf::from(MODEL_CATALOG_DIR).join(format!("{provider_id}.json"))
}

fn legacy_model_catalog_path_in_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(legacy_model_catalog_relative_path())
}

fn provider_model_catalog_path_in_dir(app_data_dir: &Path, provider_id: &str) -> PathBuf {
    app_data_dir.join(provider_model_catalog_relative_path(provider_id))
}

fn load_model_catalog_at(path: &Path) -> Result<Option<ModelCatalog>, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<ModelCatalog>(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn save_model_catalog_at(path: &Path, catalog: &ModelCatalog) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(catalog).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn clear_model_catalog_for_provider(
    app: &tauri::AppHandle,
    provider_id: &str,
) -> Result<(), String> {
    match std::fs::remove_file(model_catalog_path_for_provider(app, provider_id)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("无法清除已验证的模型目录: {e}")),
    }
}

fn migrate_legacy_model_catalog(app: &tauri::AppHandle, provider_id: &str) -> Result<bool, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        // SAFE-EXPECT: Tauri provides an app data directory after app setup.
        .expect("app data dir unavailable");
    migrate_legacy_model_catalog_in_dir(&app_data_dir, provider_id)
}

fn migrate_legacy_model_catalog_in_dir(
    app_data_dir: &Path,
    provider_id: &str,
) -> Result<bool, String> {
    let legacy_path = legacy_model_catalog_path_in_dir(app_data_dir);
    let Some(catalog) = load_model_catalog_at(&legacy_path)? else {
        return Ok(false);
    };
    let provider_path = provider_model_catalog_path_in_dir(app_data_dir, provider_id);
    match load_model_catalog_at(&provider_path)? {
        Some(existing) if existing == catalog => {}
        Some(_) => {
            return Err(
                "provider catalog conflict; legacy and provider catalogs were preserved".into(),
            );
        }
        None => {
            save_model_catalog_at(&provider_path, &catalog)?;
            let readback = load_model_catalog_at(&provider_path)?
                .ok_or_else(|| "provider catalog missing after write".to_string())?;
            if readback != catalog {
                return Err(
                    "provider catalog read-back mismatch; legacy catalog was preserved".into(),
                );
            }
        }
    }
    std::fs::remove_file(legacy_path).map_err(|e| e.to_string())?;
    Ok(true)
}

fn fingerprint_is_sha256(fingerprint: &str) -> bool {
    fingerprint.len() == 64 && fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn api_key_fingerprint(api_key: &str) -> String {
    format!("{:x}", Sha256::digest(api_key.trim().as_bytes()))
}

pub(crate) fn load_model_catalog_for_provider(
    app: &tauri::AppHandle,
    provider_id: &str,
) -> Option<ModelCatalog> {
    let path = if provider_id.is_empty() {
        model_catalog_path(app)
    } else {
        model_catalog_path_for_provider(app, provider_id)
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ModelCatalog>(&raw).ok())
        .filter(|catalog| {
            catalog.base_url.starts_with("http://") || catalog.base_url.starts_with("https://")
        })
        .filter(|catalog| fingerprint_is_sha256(&catalog.api_key_fingerprint))
}

fn model_catalog_matches_verified_binding(
    catalog: &ModelCatalog,
    expected_base_url: &str,
    api_key: &str,
) -> bool {
    !catalog.models.is_empty()
        && catalog.base_url == normalize_base_url(expected_base_url)
        && catalog.api_key_fingerprint == api_key_fingerprint(api_key)
}

pub(crate) fn load_verified_model_catalog_for_provider(
    app: &tauri::AppHandle,
    provider_id: &str,
    expected_base_url: &str,
    api_key: &str,
) -> Option<ModelCatalog> {
    let catalog = load_model_catalog_for_provider(app, provider_id)?;
    if model_catalog_matches_verified_binding(&catalog, expected_base_url, api_key) {
        Some(catalog)
    } else {
        None
    }
}

pub(crate) fn sidecar_environment(app: &tauri::AppHandle) -> Option<(String, String)> {
    let state = app.try_state::<SettingsState>()?;
    let settings = state.0.lock().ok()?.clone();
    build_multi_provider_sidecar_environment(app, &settings)
}

/// Injects **every** verified gateway into the sidecar so a model picked from
/// any of them routes to its own provider (`providerID` in the prompt
/// contract). Providers whose catalog is missing or unverified are skipped
/// rather than failing the whole environment.
pub(crate) fn build_multi_provider_sidecar_environment(
    app: &tauri::AppHandle,
    settings: &Settings,
) -> Option<(String, String)> {
    let mut verified_providers = Vec::new();

    for provider in &settings.providers {
        let key = {
            let in_memory = provider.api_key.trim();
            if in_memory.is_empty() {
                saved_api_key(&provider.id)
            } else {
                in_memory.to_owned()
            }
        };
        if key.trim().is_empty() {
            continue;
        }
        let Some(catalog) =
            load_verified_model_catalog_for_provider(app, &provider.id, &provider.base_url, &key)
        else {
            continue;
        };
        if catalog.models.is_empty() {
            continue;
        }
        let display_name = if provider.label.trim().is_empty() {
            "YUME".to_owned()
        } else {
            provider.label.trim().to_owned()
        };
        verified_providers.push(VerifiedSidecarProvider {
            sidecar_id: provider.sidecar_id.clone(),
            display_name,
            catalog,
            api_key: key,
        });
    }

    build_verified_multi_provider_sidecar_environment(&verified_providers)
}

pub(crate) struct VerifiedSidecarProvider {
    pub(crate) sidecar_id: String,
    pub(crate) display_name: String,
    pub(crate) catalog: ModelCatalog,
    pub(crate) api_key: String,
}

pub(crate) fn build_verified_multi_provider_sidecar_environment(
    verified_providers: &[VerifiedSidecarProvider],
) -> Option<(String, String)> {
    let mut providers = serde_json::Map::new();
    let mut auth = serde_json::Map::new();

    for provider in verified_providers {
        insert_verified_sidecar_provider(
            &mut providers,
            &mut auth,
            &provider.sidecar_id,
            &provider.display_name,
            &provider.catalog,
            &provider.api_key,
        );
    }

    finalize_sidecar_environment(providers, auth)
}

fn insert_verified_sidecar_provider(
    providers: &mut serde_json::Map<String, serde_json::Value>,
    auth: &mut serde_json::Map<String, serde_json::Value>,
    sidecar_id: &str,
    display_name: &str,
    catalog: &ModelCatalog,
    api_key: &str,
) {
    let models = catalog
        .models
        .iter()
        .map(|model| (model.id.clone(), serde_json::json!({ "name": model.name })))
        .collect::<serde_json::Map<String, serde_json::Value>>();
    providers.insert(
        sidecar_id.to_owned(),
        serde_json::json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": display_name,
            "options": { "baseURL": catalog.base_url },
            "models": models,
        }),
    );
    auth.insert(
        sidecar_id.to_owned(),
        serde_json::json!({ "type": "api", "key": api_key.trim() }),
    );
}

fn finalize_sidecar_environment(
    providers: serde_json::Map<String, serde_json::Value>,
    auth: serde_json::Map<String, serde_json::Value>,
) -> Option<(String, String)> {
    if providers.is_empty() {
        return None;
    }

    let config = serde_json::json!({
        "$schema": "https://opencode.ai/config.json",
        "permission": sidecar_permission_policy(),
        "provider": providers,
    });
    Some((
        config.to_string(),
        serde_json::Value::Object(auth).to_string(),
    ))
}

/// The permission policy is global to the sidecar and independent of how many
/// providers are injected: deny everything except YUME's dedicated tool.
fn sidecar_permission_policy() -> serde_json::Map<String, serde_json::Value> {
    let mut permission = serde_json::Map::new();
    permission.insert("*".to_string(), serde_json::json!("deny"));
    permission.insert(
        CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL.to_string(),
        serde_json::json!("allow"),
    );
    for permission_id in DENIED_OPENCODE_PERMISSIONS {
        permission.insert((*permission_id).to_string(), serde_json::json!("deny"));
    }
    permission
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
    state: tauri::State<SettingsState>,
    provider_id: Option<String>,
    base_url: String,
    api_key: String,
) -> Result<Option<usize>, String> {
    if api_key.trim().is_empty() {
        return Err("empty_key".into());
    }
    let provider_id = {
        let settings = state
            .0
            .lock()
            .map_err(|_| "settings_unavailable".to_string())?;
        resolve_verify_provider_id(&settings, provider_id.as_deref())?
    };
    let base = normalize_base_url(&base_url);
    let key = api_key.trim().to_owned();
    let models = fetch_api_models(&base, &key)?;
    if models.is_empty() {
        return Err("no_models".into());
    }
    let verified_settings = {
        let mut current = state
            .0
            .lock()
            .map_err(|_| "settings_unavailable".to_string())?;
        let provider_id = resolve_verify_provider_id(&current, Some(&provider_id))?;
        let catalog = ModelCatalog {
            base_url: base.clone(),
            api_key_fingerprint: api_key_fingerprint(&key),
            models: models.clone(),
        };
        let mut next = current.clone();
        reconcile_verified_settings_binding(&mut next, &provider_id, &base, &key);
        persist_verified_settings(
            &AppSettingsTransactionOps { app: &app },
            &VerifiedSettingsWrite {
                provider_id: &provider_id,
                api_key: &key,
                catalog: &catalog,
                settings: &next,
            },
        )?;
        *current = next.clone();
        next
    };
    let _ = app.emit("deskmate://settings-changed", &verified_settings);
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
        api_key_fingerprint, delete_api_key, finalize_sidecar_environment,
        hydrate_provider_api_keys, insert_verified_sidecar_provider,
        migrate_legacy_api_key_to_provider_after_persisted, migrate_legacy_model_catalog_in_dir,
        model_catalog_matches_verified_binding, normalize_pet_scale, normalize_render_value,
        normalize_theme, parse_api_models, persist_settings_update, persist_verified_settings,
        providers_requiring_catalog_clear, reconcile_verified_settings_binding, redacted_for_disk,
        resolve_verify_provider_id, saved_api_key, store_api_key, AiProvider, ApiModel,
        LegacyApiKeyMigrationOps, ModelCatalog, PetPosition, Settings, SettingsState,
        SettingsTransactionOps, VerifiedSettingsWrite,
    };
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::fs;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum MigrationEvent {
        ReadLegacy,
        StoreScoped,
        ReadScoped,
        PersistLocator,
        DeleteLegacy,
    }

    struct FakeLegacyKeyOps {
        legacy_result: Result<String, String>,
        store_result: Result<(), String>,
        scoped_result: Result<String, String>,
        delete_result: Result<(), String>,
        stored_keys: RefCell<Vec<String>>,
        events: RefCell<Vec<MigrationEvent>>,
    }

    impl FakeLegacyKeyOps {
        fn success(legacy_key: &str) -> Self {
            Self {
                legacy_result: Ok(legacy_key.into()),
                store_result: Ok(()),
                scoped_result: Ok(legacy_key.into()),
                delete_result: Ok(()),
                stored_keys: RefCell::new(Vec::new()),
                events: RefCell::new(Vec::new()),
            }
        }

        fn stored_keys(&self) -> Vec<String> {
            self.stored_keys.borrow().clone()
        }

        fn events(&self) -> Vec<MigrationEvent> {
            self.events.borrow().clone()
        }
    }

    impl LegacyApiKeyMigrationOps for FakeLegacyKeyOps {
        fn read_legacy_api_key(&self) -> Result<String, String> {
            self.events.borrow_mut().push(MigrationEvent::ReadLegacy);
            self.legacy_result.clone()
        }

        fn store_provider_api_key(&self, _provider_id: &str, api_key: &str) -> Result<(), String> {
            self.events.borrow_mut().push(MigrationEvent::StoreScoped);
            self.stored_keys.borrow_mut().push(api_key.to_owned());
            self.store_result.clone()
        }

        fn read_provider_api_key(&self, _provider_id: &str) -> Result<String, String> {
            self.events.borrow_mut().push(MigrationEvent::ReadScoped);
            self.scoped_result.clone()
        }

        fn delete_legacy_api_key(&self) -> Result<(), String> {
            self.events.borrow_mut().push(MigrationEvent::DeleteLegacy);
            self.delete_result.clone()
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum TransactionFailure {
        StoreKey,
        DeleteKey,
        StoreCatalog,
        DeleteCatalog,
        SaveSettings,
    }

    #[derive(Clone, Debug, PartialEq, Eq)]
    enum TransactionEvent {
        ReadKey,
        ReadCatalog,
        ReadSettings,
        StoreKey(String),
        DeleteKey,
        StoreCatalog(Vec<u8>),
        DeleteCatalog,
        SaveSettings,
        RestoreSettings,
    }

    struct FakeSettingsTransactionOps {
        keys: RefCell<HashMap<String, String>>,
        catalogs: RefCell<HashMap<String, Vec<u8>>>,
        settings: RefCell<Option<Vec<u8>>>,
        fail_once: RefCell<Option<TransactionFailure>>,
        fail_provider_id: RefCell<Option<String>>,
        rollback_key_error: RefCell<Option<String>>,
        events: RefCell<Vec<TransactionEvent>>,
    }

    impl FakeSettingsTransactionOps {
        fn new(key: &str, catalog: Option<&[u8]>, settings: Option<&[u8]>) -> Self {
            Self::with_providers(&[("provider-under-test", key, catalog)], settings)
        }

        fn with_providers(
            providers: &[(&str, &str, Option<&[u8]>)],
            settings: Option<&[u8]>,
        ) -> Self {
            Self {
                keys: RefCell::new(HashMap::from_iter(
                    providers
                        .iter()
                        .map(|(id, key, _)| ((*id).into(), (*key).into())),
                )),
                catalogs: RefCell::new(HashMap::from_iter(providers.iter().filter_map(
                    |(id, _, catalog)| catalog.map(|bytes| ((*id).into(), bytes.to_vec())),
                ))),
                settings: RefCell::new(settings.map(<[u8]>::to_vec)),
                fail_once: RefCell::new(None),
                fail_provider_id: RefCell::new(None),
                rollback_key_error: RefCell::new(None),
                events: RefCell::new(Vec::new()),
            }
        }

        fn fail_once(&self, failure: TransactionFailure) {
            *self.fail_once.borrow_mut() = Some(failure);
        }

        fn fail_provider_once(&self, failure: TransactionFailure, provider_id: &str) {
            self.fail_once(failure);
            *self.fail_provider_id.borrow_mut() = Some(provider_id.into());
        }

        fn fail_if_configured(
            &self,
            failure: TransactionFailure,
            provider_id: Option<&str>,
        ) -> Result<(), String> {
            let provider_matches = self
                .fail_provider_id
                .borrow()
                .as_deref()
                .is_none_or(|id| Some(id) == provider_id);
            if *self.fail_once.borrow() == Some(failure) && provider_matches {
                self.fail_once.borrow_mut().take();
                Err(format!("{failure:?} failed"))
            } else {
                Ok(())
            }
        }

        fn assert_restored(&self, key: &str, catalog: Option<&[u8]>, settings: Option<&[u8]>) {
            self.assert_provider_restored("provider-under-test", key, catalog);
            assert_eq!(self.settings.borrow().as_deref(), settings);
        }

        fn assert_provider_restored(&self, provider_id: &str, key: &str, catalog: Option<&[u8]>) {
            assert_eq!(
                self.keys.borrow().get(provider_id).map(String::as_str),
                Some(key)
            );
            assert_eq!(
                self.catalogs.borrow().get(provider_id).map(Vec::as_slice),
                catalog
            );
        }

        fn events(&self) -> Vec<TransactionEvent> {
            self.events.borrow().clone()
        }
    }

    impl SettingsTransactionOps for FakeSettingsTransactionOps {
        fn read_provider_key(&self, provider_id: &str) -> Result<String, String> {
            self.events.borrow_mut().push(TransactionEvent::ReadKey);
            Ok(self
                .keys
                .borrow()
                .get(provider_id)
                .cloned()
                .unwrap_or_default())
        }

        fn store_provider_key(&self, provider_id: &str, api_key: &str) -> Result<(), String> {
            self.events
                .borrow_mut()
                .push(TransactionEvent::StoreKey(api_key.into()));
            if api_key == "old-key" {
                if let Some(error) = self.rollback_key_error.borrow_mut().take() {
                    return Err(error);
                }
            }
            self.keys
                .borrow_mut()
                .insert(provider_id.into(), api_key.into());
            self.fail_if_configured(TransactionFailure::StoreKey, Some(provider_id))
        }

        fn delete_provider_key(&self, provider_id: &str) -> Result<(), String> {
            self.events.borrow_mut().push(TransactionEvent::DeleteKey);
            self.keys.borrow_mut().remove(provider_id);
            self.fail_if_configured(TransactionFailure::DeleteKey, Some(provider_id))
        }

        fn read_provider_catalog(&self, provider_id: &str) -> Result<Option<Vec<u8>>, String> {
            self.events.borrow_mut().push(TransactionEvent::ReadCatalog);
            Ok(self.catalogs.borrow().get(provider_id).cloned())
        }

        fn store_provider_catalog(&self, provider_id: &str, catalog: &[u8]) -> Result<(), String> {
            self.events
                .borrow_mut()
                .push(TransactionEvent::StoreCatalog(catalog.to_vec()));
            self.catalogs
                .borrow_mut()
                .insert(provider_id.into(), catalog.to_vec());
            self.fail_if_configured(TransactionFailure::StoreCatalog, Some(provider_id))
        }

        fn delete_provider_catalog(&self, provider_id: &str) -> Result<(), String> {
            self.events
                .borrow_mut()
                .push(TransactionEvent::DeleteCatalog);
            self.catalogs.borrow_mut().remove(provider_id);
            self.fail_if_configured(TransactionFailure::DeleteCatalog, Some(provider_id))
        }

        fn read_settings_file(&self) -> Result<Option<Vec<u8>>, String> {
            self.events
                .borrow_mut()
                .push(TransactionEvent::ReadSettings);
            Ok(self.settings.borrow().clone())
        }

        fn save_settings(&self, settings: &Settings) -> Result<(), String> {
            self.events
                .borrow_mut()
                .push(TransactionEvent::SaveSettings);
            *self.settings.borrow_mut() = Some(
                serde_json::to_vec(&redacted_for_disk(settings)).expect("settings serialization"),
            );
            self.fail_if_configured(TransactionFailure::SaveSettings, None)
        }

        fn restore_settings_file(&self, settings: Option<&[u8]>) -> Result<(), String> {
            self.events
                .borrow_mut()
                .push(TransactionEvent::RestoreSettings);
            *self.settings.borrow_mut() = settings.map(<[u8]>::to_vec);
            Ok(())
        }
    }

    fn provider_settings(api_key: &str, base_url: &str) -> Settings {
        Settings {
            providers: vec![AiProvider {
                id: "provider-under-test".into(),
                sidecar_id: "yume".into(),
                label: "Test".into(),
                base_url: base_url.into(),
                api_key: api_key.into(),
            }],
            active_provider_id: "provider-under-test".into(),
            ..Settings::default()
        }
    }

    fn single_provider_sidecar_environment(
        catalog: &ModelCatalog,
        api_key: &str,
    ) -> Option<(String, String)> {
        if api_key.trim().is_empty() || catalog.models.is_empty() {
            return None;
        }

        let mut providers = serde_json::Map::new();
        let mut auth = serde_json::Map::new();
        insert_verified_sidecar_provider(
            &mut providers,
            &mut auth,
            "yume",
            "YUME",
            catalog,
            api_key,
        );
        finalize_sidecar_environment(providers, auth)
    }

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
            api_key_fingerprint: api_key_fingerprint("secret-key"),
            models: vec![ApiModel {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
        };

        let (config, auth) = single_provider_sidecar_environment(&catalog, "secret-key")
            .expect("configured provider");
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
    fn generated_sidecar_environment_denies_generic_opencode_tools() {
        let catalog = ModelCatalog {
            base_url: "https://models.example.test".into(),
            api_key_fingerprint: api_key_fingerprint("secret-key"),
            models: vec![ApiModel {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
        };

        let (config, _) = single_provider_sidecar_environment(&catalog, "secret-key")
            .expect("configured provider");
        let config = serde_json::from_str::<serde_json::Value>(&config).expect("valid config");
        let permission = config["permission"].as_object().expect("permission map");

        assert_eq!(permission["*"], "deny");
        assert_eq!(permission["ccswitch_prepare_opencode_provider"], "allow");
        for denied in [
            "bash",
            "edit",
            "write",
            "patch",
            "external_directory",
            "task",
        ] {
            assert_eq!(permission[denied], "deny");
        }
        let allowed = permission
            .iter()
            .filter(|(_, value)| **value == "allow")
            .map(|(tool, _)| tool.as_str())
            .collect::<Vec<_>>();
        assert_eq!(allowed, vec!["ccswitch_prepare_opencode_provider"]);
    }

    #[test]
    fn verified_model_catalog_matches_only_bound_base_key_and_non_empty_models() {
        let catalog = ModelCatalog {
            base_url: "https://models.example.test/v1".into(),
            api_key_fingerprint: api_key_fingerprint("secret-key"),
            models: vec![ApiModel {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
        };

        assert!(model_catalog_matches_verified_binding(
            &catalog,
            " https://models.example.test/v1/ ",
            " secret-key "
        ));
        assert!(!model_catalog_matches_verified_binding(
            &catalog,
            "https://models.example.test/v2",
            "secret-key"
        ));
        assert!(!model_catalog_matches_verified_binding(
            &catalog,
            "https://models.example.test/v1",
            "changed-key"
        ));

        let empty_catalog = ModelCatalog {
            models: Vec::new(),
            ..catalog
        };
        assert!(!model_catalog_matches_verified_binding(
            &empty_catalog,
            "https://models.example.test/v1",
            "secret-key"
        ));
    }

    #[test]
    fn legacy_model_catalog_without_api_key_fingerprint_fails_closed() {
        let legacy = serde_json::json!({
            "baseUrl": "https://models.example.test/v1",
            "models": [{"id": "model-a", "name": "Model A"}]
        });

        assert!(serde_json::from_value::<ModelCatalog>(legacy).is_err());
    }

    #[test]
    fn provider_scoped_keyring_round_trips_and_deletes_with_uuid_user() {
        let provider_id = format!("test-{}", uuid::Uuid::new_v4());
        let api_key = "provider-scoped-test-key";

        let store_result = store_api_key(&provider_id, api_key);
        let stored_value = saved_api_key(&provider_id);
        let delete_result = delete_api_key(&provider_id);
        let deleted_value = saved_api_key(&provider_id);
        let cleanup_result = delete_api_key(&provider_id);

        assert_eq!(store_result, Ok(()));
        assert_eq!(stored_value, api_key);
        assert_eq!(delete_result, Ok(()));
        assert_eq!(deleted_value, "");
        assert_eq!(cleanup_result, Ok(()));
    }

    #[test]
    fn legacy_key_migration_deletes_legacy_after_scoped_readback_matches() {
        let ops = FakeLegacyKeyOps::success("legacy-key");
        let provider_id = "provider-under-test";

        let migrated =
            migrate_legacy_api_key_to_provider_after_persisted(&ops, provider_id, None, |_| {
                ops.events.borrow_mut().push(MigrationEvent::PersistLocator);
                Ok(())
            });

        assert_eq!(migrated, Ok(Some("legacy-key".into())));
        assert_eq!(ops.stored_keys(), vec!["legacy-key"]);
        assert_eq!(
            ops.events(),
            vec![
                MigrationEvent::ReadLegacy,
                MigrationEvent::StoreScoped,
                MigrationEvent::ReadScoped,
                MigrationEvent::PersistLocator,
                MigrationEvent::DeleteLegacy
            ]
        );
    }

    #[test]
    fn legacy_key_migration_prefers_existing_scoped_key_over_legacy_key() {
        let ops = FakeLegacyKeyOps {
            legacy_result: Ok("legacy-key".into()),
            store_result: Ok(()),
            scoped_result: Ok("scoped-key".into()),
            delete_result: Ok(()),
            stored_keys: RefCell::new(Vec::new()),
            events: RefCell::new(Vec::new()),
        };
        let provider_id = "provider-under-test";
        let persisted_keys = RefCell::new(Vec::new());

        let migrated = migrate_legacy_api_key_to_provider_after_persisted(
            &ops,
            provider_id,
            Some("scoped-key"),
            |key| {
                ops.events.borrow_mut().push(MigrationEvent::PersistLocator);
                persisted_keys.borrow_mut().push(key.to_owned());
                Ok(())
            },
        );

        assert_eq!(migrated, Ok(Some("scoped-key".into())));
        assert_eq!(ops.stored_keys(), vec!["scoped-key"]);
        assert_eq!(persisted_keys.into_inner(), vec!["scoped-key"]);
        assert_eq!(
            ops.events(),
            vec![
                MigrationEvent::ReadLegacy,
                MigrationEvent::StoreScoped,
                MigrationEvent::ReadScoped,
                MigrationEvent::PersistLocator,
                MigrationEvent::DeleteLegacy
            ]
        );
    }

    #[test]
    fn legacy_key_migration_prefers_plaintext_key_over_legacy_key() {
        let ops = FakeLegacyKeyOps {
            scoped_result: Ok("plaintext-key".into()),
            ..FakeLegacyKeyOps::success("legacy-key")
        };
        let provider_id = "provider-under-test";
        let persisted_keys = RefCell::new(Vec::new());

        let migrated = migrate_legacy_api_key_to_provider_after_persisted(
            &ops,
            provider_id,
            Some("plaintext-key"),
            |key| {
                ops.events.borrow_mut().push(MigrationEvent::PersistLocator);
                persisted_keys.borrow_mut().push(key.to_owned());
                Ok(())
            },
        );

        assert_eq!(migrated, Ok(Some("plaintext-key".into())));
        assert_eq!(ops.stored_keys(), vec!["plaintext-key"]);
        assert_eq!(persisted_keys.into_inner(), vec!["plaintext-key"]);
        assert_eq!(
            ops.events(),
            vec![
                MigrationEvent::ReadLegacy,
                MigrationEvent::StoreScoped,
                MigrationEvent::ReadScoped,
                MigrationEvent::PersistLocator,
                MigrationEvent::DeleteLegacy
            ]
        );
    }

    #[test]
    fn legacy_key_migration_preserves_legacy_when_settings_persistence_fails() {
        let ops = FakeLegacyKeyOps {
            scoped_result: Ok("preferred-key".into()),
            ..FakeLegacyKeyOps::success("legacy-key")
        };
        let provider_id = "provider-under-test";

        let migrated = migrate_legacy_api_key_to_provider_after_persisted(
            &ops,
            provider_id,
            Some("preferred-key"),
            |_| {
                ops.events.borrow_mut().push(MigrationEvent::PersistLocator);
                Err("settings save failed".into())
            },
        );

        assert_eq!(migrated, Err("settings save failed".into()));
        assert_eq!(ops.stored_keys(), vec!["preferred-key"]);
        assert_eq!(
            ops.events(),
            vec![
                MigrationEvent::ReadLegacy,
                MigrationEvent::StoreScoped,
                MigrationEvent::ReadScoped,
                MigrationEvent::PersistLocator
            ]
        );
    }

    #[test]
    fn legacy_key_migration_returns_none_when_preferred_and_legacy_keys_are_empty() {
        let ops = FakeLegacyKeyOps::success("");

        let migrated = migrate_legacy_api_key_to_provider_after_persisted(
            &ops,
            "provider-under-test",
            Some(""),
            |_| Err("persistence must not run".into()),
        );

        assert_eq!(migrated, Ok(None));
        assert!(ops.stored_keys().is_empty());
        assert_eq!(ops.events(), vec![MigrationEvent::ReadLegacy]);
    }

    #[test]
    fn provider_scoped_keys_hydrate_all_empty_providers() {
        let ops = FakeLegacyKeyOps {
            legacy_result: Ok(String::new()),
            store_result: Ok(()),
            scoped_result: Ok("scoped-key".into()),
            delete_result: Ok(()),
            stored_keys: RefCell::new(Vec::new()),
            events: RefCell::new(Vec::new()),
        };
        let mut settings = Settings {
            providers: vec![
                AiProvider {
                    id: "provider-a".into(),
                    sidecar_id: "yume".into(),
                    label: String::new(),
                    base_url: "https://a.example.test".into(),
                    api_key: String::new(),
                },
                AiProvider {
                    id: "provider-b".into(),
                    sidecar_id: "yume-2".into(),
                    label: String::new(),
                    base_url: "https://b.example.test".into(),
                    api_key: String::new(),
                },
            ],
            active_provider_id: "provider-a".into(),
            ..Settings::default()
        };

        hydrate_provider_api_keys(&ops, &mut settings).expect("hydrate provider keys");

        assert_eq!(settings.providers[0].api_key, "scoped-key");
        assert_eq!(settings.providers[1].api_key, "scoped-key");
        assert_eq!(
            ops.events(),
            vec![MigrationEvent::ReadScoped, MigrationEvent::ReadScoped]
        );
    }

    #[test]
    fn provider_catalog_changes_are_tracked_per_provider_and_key_binding() {
        let old = Settings {
            providers: vec![
                AiProvider {
                    id: "provider-a".into(),
                    sidecar_id: "yume".into(),
                    label: String::new(),
                    base_url: "https://a.example.test/v1".into(),
                    api_key: "old-key".into(),
                },
                AiProvider {
                    id: "provider-b".into(),
                    sidecar_id: "yume-2".into(),
                    label: String::new(),
                    base_url: "https://b.example.test/v1".into(),
                    api_key: "stable-key".into(),
                },
            ],
            ..Settings::default()
        };
        let mut new = old.clone();
        new.providers[0].api_key = "new-key".into();

        assert_eq!(
            providers_requiring_catalog_clear(&old, &new),
            vec!["provider-a".to_string()]
        );
    }

    #[test]
    fn legacy_model_catalog_migrates_to_provider_catalog_after_readback() {
        let root = std::env::temp_dir().join(format!(
            "deskmate-settings-catalog-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("temp dir");
        let legacy_path = root.join("model-catalog.json");
        let provider_path = root.join("model-catalogs").join("provider-a.json");
        let catalog = ModelCatalog {
            base_url: "https://models.example.test/v1".into(),
            api_key_fingerprint: api_key_fingerprint("secret-key"),
            models: vec![ApiModel {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
        };
        fs::write(
            &legacy_path,
            serde_json::to_string_pretty(&catalog).expect("catalog json"),
        )
        .expect("legacy write");

        let migrated = migrate_legacy_model_catalog_in_dir(&root, "provider-a");

        assert_eq!(migrated, Ok(true));
        assert!(!legacy_path.exists());
        let provider_catalog = fs::read_to_string(provider_path).expect("provider catalog");
        assert_eq!(
            serde_json::from_str::<ModelCatalog>(&provider_catalog).expect("catalog"),
            catalog
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn legacy_model_catalog_equal_target_only_removes_legacy() {
        let root = std::env::temp_dir().join(format!(
            "deskmate-settings-catalog-equal-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("model-catalogs")).expect("temp dir");
        let legacy_path = root.join("model-catalog.json");
        let provider_path = root.join("model-catalogs").join("provider-a.json");
        let catalog = ModelCatalog {
            base_url: "https://models.example.test/v1".into(),
            api_key_fingerprint: api_key_fingerprint("secret-key"),
            models: vec![ApiModel {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
        };
        let legacy_json = serde_json::to_string_pretty(&catalog).expect("legacy catalog json");
        let target_json = serde_json::to_string(&catalog).expect("target catalog json");
        fs::write(&legacy_path, legacy_json).expect("legacy write");
        fs::write(&provider_path, &target_json).expect("target write");

        let migrated = migrate_legacy_model_catalog_in_dir(&root, "provider-a");

        assert_eq!(migrated, Ok(true));
        assert!(!legacy_path.exists());
        assert_eq!(
            fs::read_to_string(&provider_path).expect("provider catalog"),
            target_json,
            "an equal provider catalog must not be rewritten"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn legacy_model_catalog_conflict_preserves_both_catalogs() {
        let root = std::env::temp_dir().join(format!(
            "deskmate-settings-catalog-conflict-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("model-catalogs")).expect("temp dir");
        let legacy_path = root.join("model-catalog.json");
        let provider_path = root.join("model-catalogs").join("provider-a.json");
        let legacy_catalog = ModelCatalog {
            base_url: "https://legacy.example.test/v1".into(),
            api_key_fingerprint: api_key_fingerprint("legacy-key"),
            models: vec![ApiModel {
                id: "legacy-model".into(),
                name: "Legacy Model".into(),
            }],
        };
        let provider_catalog = ModelCatalog {
            base_url: "https://provider.example.test/v1".into(),
            api_key_fingerprint: api_key_fingerprint("provider-key"),
            models: vec![ApiModel {
                id: "provider-model".into(),
                name: "Provider Model".into(),
            }],
        };
        let legacy_json =
            serde_json::to_string_pretty(&legacy_catalog).expect("legacy catalog json");
        let provider_json =
            serde_json::to_string_pretty(&provider_catalog).expect("provider catalog json");
        fs::write(&legacy_path, &legacy_json).expect("legacy write");
        fs::write(&provider_path, &provider_json).expect("provider write");

        let migrated = migrate_legacy_model_catalog_in_dir(&root, "provider-a");

        assert!(migrated
            .expect_err("different catalogs must conflict")
            .contains("conflict"));
        assert_eq!(
            fs::read_to_string(&legacy_path).expect("legacy catalog preserved"),
            legacy_json
        );
        assert_eq!(
            fs::read_to_string(&provider_path).expect("provider catalog preserved"),
            provider_json
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn settings_transaction_rolls_back_partial_key_store_failure() {
        let ops =
            FakeSettingsTransactionOps::new("old-key", Some(b"old-catalog"), Some(b"old-settings"));
        ops.fail_once(TransactionFailure::StoreKey);
        let old = provider_settings("old-key", "https://old.example.test");
        let new = provider_settings("new-key", "https://old.example.test");

        let result = persist_settings_update(&ops, &old, &new);

        assert_eq!(result, Err("StoreKey failed".into()));
        ops.assert_restored("old-key", Some(b"old-catalog"), Some(b"old-settings"));
    }

    #[test]
    fn settings_transaction_rolls_back_both_providers_when_second_key_store_fails() {
        let ops = FakeSettingsTransactionOps::with_providers(
            &[
                ("provider-a", "old-key-a", Some(b"old-catalog-a")),
                ("provider-b", "old-key-b", Some(b"old-catalog-b")),
            ],
            Some(b"old-settings"),
        );
        ops.fail_provider_once(TransactionFailure::StoreKey, "provider-b");
        let mut old = provider_settings("old-key-a", "https://a.example.test");
        old.providers[0].id = "provider-a".into();
        old.providers.push(AiProvider {
            id: "provider-b".into(),
            sidecar_id: "yume-2".into(),
            label: "Provider B".into(),
            base_url: "https://b.example.test".into(),
            api_key: "old-key-b".into(),
        });
        let mut new = old.clone();
        new.providers[0].api_key = "new-key-a".into();
        new.providers[1].api_key = "new-key-b".into();

        let result = persist_settings_update(&ops, &old, &new);

        assert_eq!(result, Err("StoreKey failed".into()));
        ops.assert_provider_restored("provider-a", "old-key-a", Some(b"old-catalog-a"));
        ops.assert_provider_restored("provider-b", "old-key-b", Some(b"old-catalog-b"));
        assert_eq!(
            ops.settings.borrow().as_deref(),
            Some(b"old-settings".as_slice())
        );
    }

    #[test]
    fn settings_transaction_rolls_back_partial_provider_key_delete_failure() {
        let ops =
            FakeSettingsTransactionOps::new("old-key", Some(b"old-catalog"), Some(b"old-settings"));
        ops.fail_once(TransactionFailure::DeleteKey);
        let old = provider_settings("old-key", "https://old.example.test");
        let new = Settings::default();

        let result = persist_settings_update(&ops, &old, &new);

        assert_eq!(result, Err("DeleteKey failed".into()));
        ops.assert_restored("old-key", Some(b"old-catalog"), Some(b"old-settings"));
    }

    #[test]
    fn settings_transaction_rolls_back_partial_catalog_clear_failure() {
        let ops =
            FakeSettingsTransactionOps::new("old-key", Some(b"old-catalog"), Some(b"old-settings"));
        ops.fail_once(TransactionFailure::DeleteCatalog);
        let old = provider_settings("old-key", "https://old.example.test");
        let new = provider_settings("new-key", "https://new.example.test");

        let result = persist_settings_update(&ops, &old, &new);

        assert_eq!(result, Err("DeleteCatalog failed".into()));
        ops.assert_restored("old-key", Some(b"old-catalog"), Some(b"old-settings"));
    }

    #[test]
    fn settings_transaction_rolls_back_provider_cleanup_when_settings_save_fails() {
        let ops =
            FakeSettingsTransactionOps::new("old-key", Some(b"old-catalog"), Some(b"old-settings"));
        ops.fail_once(TransactionFailure::SaveSettings);
        let old = provider_settings("old-key", "https://old.example.test");
        let new = Settings::default();

        let result = persist_settings_update(&ops, &old, &new);

        assert_eq!(result, Err("SaveSettings failed".into()));
        ops.assert_restored("old-key", Some(b"old-catalog"), Some(b"old-settings"));
    }

    #[test]
    fn verify_settings_save_failure_restores_key_catalog_and_settings() {
        let ops =
            FakeSettingsTransactionOps::new("old-key", Some(b"old-catalog"), Some(b"old-settings"));
        ops.fail_once(TransactionFailure::SaveSettings);
        let settings = provider_settings("verified-key", "https://verified.example.test");
        let catalog = ModelCatalog {
            base_url: "https://verified.example.test".into(),
            api_key_fingerprint: api_key_fingerprint("verified-key"),
            models: vec![ApiModel {
                id: "model-a".into(),
                name: "Model A".into(),
            }],
        };
        let write = VerifiedSettingsWrite {
            provider_id: "provider-under-test",
            api_key: "verified-key",
            catalog: &catalog,
            settings: &settings,
        };

        let result = persist_verified_settings(&ops, &write);

        assert_eq!(result, Err("SaveSettings failed".into()));
        ops.assert_restored("old-key", Some(b"old-catalog"), Some(b"old-settings"));
    }

    #[test]
    fn settings_transaction_reports_original_and_rollback_errors() {
        let ops = FakeSettingsTransactionOps::new("old-key", None, Some(b"old-settings"));
        ops.fail_once(TransactionFailure::SaveSettings);
        *ops.rollback_key_error.borrow_mut() = Some("key rollback failed".into());
        let old = provider_settings("old-key", "https://old.example.test");
        let new = provider_settings("new-key", "https://old.example.test");

        let error = persist_settings_update(&ops, &old, &new)
            .expect_err("settings save and key rollback should fail");

        assert!(error.contains("SaveSettings failed"));
        assert!(error.contains("key rollback failed"));
    }

    #[test]
    fn settings_transaction_skips_unchanged_key() {
        let ops = FakeSettingsTransactionOps::new("same-key", None, Some(b"old-settings"));
        let old = provider_settings("same-key", "https://same.example.test");
        let mut new = old.clone();
        new.theme = "mint".into();

        persist_settings_update(&ops, &old, &new).expect("settings transaction");

        assert!(!ops
            .events()
            .iter()
            .any(|event| matches!(event, TransactionEvent::StoreKey(_))));
    }

    #[test]
    fn verify_provider_resolution_accepts_old_frontend_missing_provider_id() {
        let settings = Settings {
            providers: vec![AiProvider {
                id: "provider-a".into(),
                sidecar_id: "yume".into(),
                label: String::new(),
                base_url: "https://models.example.test".into(),
                api_key: String::new(),
            }],
            active_provider_id: "provider-a".into(),
            ..Settings::default()
        };

        assert_eq!(
            resolve_verify_provider_id(&settings, None),
            Ok("provider-a".into())
        );
        assert_eq!(
            resolve_verify_provider_id(&settings, Some("")),
            Ok("provider-a".into())
        );
        assert_eq!(
            resolve_verify_provider_id(&settings, Some("missing")),
            Err("unknown_provider".into())
        );
    }

    #[test]
    fn legacy_key_migration_preserves_legacy_when_scoped_readback_mismatches() {
        let ops = FakeLegacyKeyOps {
            scoped_result: Ok("different-key".into()),
            ..FakeLegacyKeyOps::success("legacy-key")
        };
        let provider_id = "provider-under-test";

        let migrated = migrate_legacy_api_key_to_provider_after_persisted(
            &ops,
            provider_id,
            Some("preferred-key"),
            |_| Ok(()),
        );

        assert!(migrated
            .expect_err("mismatch should fail")
            .contains("read-back mismatch"));
        assert_eq!(ops.stored_keys(), vec!["preferred-key"]);
        assert_eq!(
            ops.events(),
            vec![
                MigrationEvent::ReadLegacy,
                MigrationEvent::StoreScoped,
                MigrationEvent::ReadScoped
            ]
        );
    }

    #[test]
    fn legacy_key_migration_preserves_legacy_when_scoped_write_fails() {
        let ops = FakeLegacyKeyOps {
            store_result: Err("write failed".into()),
            ..FakeLegacyKeyOps::success("legacy-key")
        };
        let provider_id = "provider-under-test";

        let migrated = migrate_legacy_api_key_to_provider_after_persisted(
            &ops,
            provider_id,
            Some("preferred-key"),
            |_| Ok(()),
        );

        assert_eq!(migrated, Err("write failed".into()));
        assert_eq!(ops.stored_keys(), vec!["preferred-key"]);
        assert_eq!(
            ops.events(),
            vec![MigrationEvent::ReadLegacy, MigrationEvent::StoreScoped]
        );
    }

    #[test]
    fn legacy_key_migration_preserves_legacy_when_scoped_read_fails() {
        let ops = FakeLegacyKeyOps {
            scoped_result: Err("read failed".into()),
            ..FakeLegacyKeyOps::success("legacy-key")
        };
        let provider_id = "provider-under-test";

        let migrated = migrate_legacy_api_key_to_provider_after_persisted(
            &ops,
            provider_id,
            Some("preferred-key"),
            |_| Ok(()),
        );

        assert_eq!(migrated, Err("read failed".into()));
        assert_eq!(ops.stored_keys(), vec!["preferred-key"]);
        assert_eq!(
            ops.events(),
            vec![
                MigrationEvent::ReadLegacy,
                MigrationEvent::StoreScoped,
                MigrationEvent::ReadScoped
            ]
        );
    }

    #[test]
    fn legacy_key_migration_reports_delete_failure_after_verified_equality() {
        let ops = FakeLegacyKeyOps {
            delete_result: Err("delete failed".into()),
            ..FakeLegacyKeyOps::success("legacy-key")
        };
        let provider_id = "provider-under-test";

        let migrated =
            migrate_legacy_api_key_to_provider_after_persisted(&ops, provider_id, None, |_| Ok(()));

        assert_eq!(migrated, Err("delete failed".into()));
        assert_eq!(
            ops.events(),
            vec![
                MigrationEvent::ReadLegacy,
                MigrationEvent::StoreScoped,
                MigrationEvent::ReadScoped,
                MigrationEvent::DeleteLegacy
            ]
        );
    }

    #[test]
    fn verified_settings_reconciliation_makes_identical_pending_settings_safe() {
        let provider_id = "provider-under-test";
        let mut current = Settings {
            providers: vec![AiProvider {
                id: provider_id.into(),
                sidecar_id: "yume".into(),
                label: String::new(),
                base_url: "https://models.example.test/v1/".into(),
                api_key: " stale-key ".into(),
            }],
            active_provider_id: provider_id.into(),
            ..Settings::default()
        };

        reconcile_verified_settings_binding(
            &mut current,
            provider_id,
            " https://models.example.test/v1/ ",
            " verified-key ",
        );

        let pending = current.clone();

        assert_eq!(
            current.providers[0].base_url,
            "https://models.example.test/v1"
        );
        assert_eq!(current.providers[0].api_key, "verified-key");
        assert!(providers_requiring_catalog_clear(&current, &pending).is_empty());
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
            providers: vec![AiProvider {
                id: "provider-under-test".into(),
                sidecar_id: "yume".into(),
                label: "Test".into(),
                base_url: "https://models.example.test".into(),
                api_key: "provider-secret-key".into(),
            }],
            ..Settings::default()
        };

        let on_disk = redacted_for_disk(&settings);
        assert_eq!(on_disk.api_key, "");
        assert_eq!(on_disk.providers[0].api_key, "");
        // Non-secret preferences must survive the redaction untouched.
        assert_eq!(on_disk.base_url, "https://example.invalid");
        assert_eq!(on_disk.providers[0].base_url, "https://models.example.test");

        let json = serde_json::to_string(&on_disk).expect("settings serialize");
        assert!(!json.contains("super-secret-key"));
        assert!(!json.contains("provider-secret-key"));
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
