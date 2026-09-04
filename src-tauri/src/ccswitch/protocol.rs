// allow: SIZE_OK — Todo 7 keeps the native IPC bridge and its fake-server security tests together.
use std::collections::HashSet;
use std::io::Read;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use super::contract::{
    CcSwitchSetupState, HandoffReceipt, MillisSinceEpoch, ModelChoice, ProviderSelectionInput,
    ProviderSelectionResult, ProviderValidationInput,
};
use super::platform::SystemCcSwitchPlatform;
use super::recovery::{
    DiscardConfirmation, FileObservation, ObservedFiles, RecoveryCompletion, RecoveryError,
    RecoveryKeyStore, RecoveryLocations, RecoveryManager, RecoveryRetention, SnapshotId,
    SystemRecoveryKeyStore,
};
use super::verification::{verify_once, ExternalVerification, VerificationTarget};

mod launch;
mod model_catalog_sync;
mod settings_deploy;
mod status;

#[cfg(test)]
mod launch_failure_tests;
#[cfg(test)]
mod launch_fixture;
#[cfg(test)]
mod launch_handoff_tests;
#[cfg(test)]
mod status_tests;

pub(crate) use launch::SecretImportUrl;
pub use launch::{
    launch_import_with_platform, CcSwitchCommandError, CcSwitchLaunchReceipt,
    LaunchCcSwitchImportRequest, LaunchEnvironment,
};
#[cfg(windows)]
pub(crate) use model_catalog_sync::expand_deployed_provider_catalog;
pub(crate) use model_catalog_sync::ModelCatalogSyncOutcome;
pub(crate) use settings_deploy::{
    abandon_automatic_deployment, launch_automatic_deployment, prepare_automatic_deployment,
    verify_automatic_deployment,
};
pub(crate) use status::supports_version as supports_version_for_deployment;
pub use status::{
    ccswitch_capability_status_with_platform, CcSwitchUiStatus, CcSwitchUnavailableReason,
};

#[tauri::command]
pub fn ccswitch_capability_status() -> CcSwitchUiStatus {
    ccswitch_capability_status_with_platform(&SystemCcSwitchPlatform)
}

#[tauri::command]
pub fn prepare_ccswitch_opencode_provider(
    state: State<CcSwitchSetupState>,
    input: ProviderValidationInput,
) -> Result<ProviderSelectionResult, CcSwitchCommandError> {
    prepare_provider_with_fetcher(&state, input, now_millis(), fetch_model_catalog)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchPreparedProvider {
    pub contract_version: u8,
    pub receipt: CcSwitchTicketReceipt,
    pub recovery: CcSwitchRecoveryHandle,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchTicketReceipt {
    pub contract_version: u8,
    pub ticket_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub selected_model: String,
    pub expires_at: MillisSinceEpoch,
}

impl From<HandoffReceipt> for CcSwitchTicketReceipt {
    fn from(receipt: HandoffReceipt) -> Self {
        Self {
            contract_version: receipt.contract_version,
            ticket_id: receipt.ticket_id,
            provider_name: receipt.provider_name,
            endpoint: receipt.endpoint,
            selected_model: receipt.selected_model,
            expires_at: receipt.expires_at,
        }
    }
}

#[tauri::command]
pub fn select_ccswitch_opencode_model(
    app: tauri::AppHandle,
    state: State<CcSwitchSetupState>,
    input: ProviderSelectionInput,
) -> Result<CcSwitchPreparedProvider, CcSwitchCommandError> {
    select_model_at_locations(
        &state,
        input,
        recovery_locations(&app)?,
        SystemRecoveryKeyStore,
        now_millis(),
    )
}

#[tauri::command]
pub fn launch_ccswitch_opencode_import(
    state: State<CcSwitchSetupState>,
    request: CcSwitchLaunchCommandRequest,
) -> Result<CcSwitchUiLaunchReceipt, CcSwitchCommandError> {
    let request = bind_launch_request(&state, request)?;
    let receipt = launch_import_with_platform(
        LaunchEnvironment {
            state: &state,
            platform: &SystemCcSwitchPlatform,
            now: now_millis(),
        },
        request,
    )?;
    Ok(receipt.into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CcSwitchSettingsPrepareCommandRequest {
    pub provider_name: String,
}

#[tauri::command]
pub fn prepare_ccswitch_opencode_provider_from_settings(
    app: tauri::AppHandle,
    setup_state: State<CcSwitchSetupState>,
    settings_state: State<crate::settings::SettingsState>,
    request: CcSwitchSettingsPrepareCommandRequest,
) -> Result<ProviderSelectionResult, CcSwitchCommandError> {
    let settings = settings_state.0.lock().map_err(|_| CcSwitchCommandError {
        code: "ccswitch_settings_unavailable",
        message: "Settings are unavailable.",
    })?;
    let base_url = settings.base_url.clone();
    drop(settings);
    let api_key = crate::settings::saved_api_key();
    if api_key.trim().is_empty() {
        return Err(CcSwitchCommandError {
            code: "ccswitch_saved_api_key_missing",
            message: "A verified saved API key is required.",
        });
    }
    let catalog = crate::settings::load_verified_model_catalog(&app, &base_url, &api_key)
        .ok_or_else(missing_verified_catalog_error)?;
    let source = SettingsProviderSource {
        provider_name: request.provider_name,
        endpoint: catalog.base_url,
        api_key,
        models: catalog
            .models
            .into_iter()
            .map(|model| ModelChoice {
                id: model.id,
                name: model.name,
            })
            .collect(),
    };
    prepare_settings_provider_source(&setup_state, source, now_millis())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CcSwitchLaunchCommandRequest {
    pub ticket_id: String,
    #[serde(default)]
    pub switch_immediately: bool,
    #[serde(default)]
    pub accepted_process_argument_disclosure: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchUiLaunchReceipt {
    pub contract_version: u8,
    pub ticket_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub selected_model: String,
    pub expires_at: MillisSinceEpoch,
    pub enabled: bool,
}

impl From<CcSwitchLaunchReceipt> for CcSwitchUiLaunchReceipt {
    fn from(receipt: CcSwitchLaunchReceipt) -> Self {
        Self {
            contract_version: receipt.contract_version,
            ticket_id: receipt.ticket_id,
            provider_name: receipt.provider_name,
            endpoint: receipt.endpoint,
            selected_model: receipt.selected_model,
            expires_at: receipt.expires_at,
            enabled: receipt.enabled,
        }
    }
}

fn bind_launch_request(
    state: &CcSwitchSetupState,
    request: CcSwitchLaunchCommandRequest,
) -> Result<LaunchCcSwitchImportRequest, CcSwitchCommandError> {
    let binding = state
        .ticket_consume_request(&request.ticket_id)
        .map_err(launch::command_error_from_contract)?;
    Ok(LaunchCcSwitchImportRequest {
        ticket_id: binding.ticket_id,
        provider_name: binding.provider_name,
        endpoint: binding.endpoint,
        selected_model: binding.selected_model,
        pre_import_hash: binding.pre_import_hash,
        switch_immediately: request.switch_immediately,
        accepted_process_argument_disclosure: request.accepted_process_argument_disclosure,
    })
}

struct SettingsProviderSource {
    provider_name: String,
    endpoint: String,
    api_key: String,
    models: Vec<ModelChoice>,
}

fn prepare_settings_provider_source(
    state: &CcSwitchSetupState,
    source: SettingsProviderSource,
    now: MillisSinceEpoch,
) -> Result<ProviderSelectionResult, CcSwitchCommandError> {
    if source.api_key.trim().is_empty() {
        return Err(CcSwitchCommandError {
            code: "ccswitch_saved_api_key_missing",
            message: "A verified saved API key is required.",
        });
    }
    if source.models.is_empty() {
        return Err(missing_verified_catalog_error());
    }
    let provider = CcSwitchSetupState::validate_provider_input(ProviderValidationInput {
        provider_name: source.provider_name,
        endpoint: source.endpoint,
        api_key: source.api_key,
    })
    .map_err(launch::command_error_from_contract)?;
    if catalog_reflects_secret(&source.models, provider.api_key()) {
        return Err(invalid_model_catalog_error());
    }
    state
        .stage_validated_provider(provider, source.models, now)
        .map_err(launch::command_error_from_contract)
}

#[tauri::command]
pub fn cancel_ccswitch_setup(
    state: State<CcSwitchSetupState>,
    handle_id: String,
) -> Result<(), CcSwitchCommandError> {
    state
        .cancel_setup(&handle_id)
        .map_err(launch::command_error_from_contract)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchRecoveryHandle {
    pub snapshot_id: String,
    pub original: ObservedFiles,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CcSwitchRecoveryCompletionKind {
    Verified,
    Cancelled,
    TimedOut,
    ReadFailed,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchRecoveryCompletionRequest {
    pub snapshot_id: String,
    pub kind: CcSwitchRecoveryCompletionKind,
    pub observed: Option<ObservedFiles>,
}

#[tauri::command]
pub fn observe_ccswitch_opencode_files(
    app: tauri::AppHandle,
) -> Result<ObservedFiles, CcSwitchCommandError> {
    recovery_manager(&app)?
        .observe_files()
        .map_err(command_error_from_recovery)
}

#[tauri::command]
pub fn create_ccswitch_recovery_snapshot(
    app: tauri::AppHandle,
) -> Result<CcSwitchRecoveryHandle, CcSwitchCommandError> {
    create_recovery_snapshot_at_locations(recovery_locations(&app)?, SystemRecoveryKeyStore)
}

#[tauri::command]
pub fn check_ccswitch_opencode_import(
    app: tauri::AppHandle,
    target: VerificationTarget,
) -> Result<ExternalVerification, CcSwitchCommandError> {
    let manager = recovery_manager(&app)?;
    Ok(verify_once(manager.paths(), &target))
}

#[tauri::command]
pub fn complete_ccswitch_recovery(
    app: tauri::AppHandle,
    completion: CcSwitchRecoveryCompletionRequest,
) -> Result<RecoveryRetention, CcSwitchCommandError> {
    complete_recovery_at_locations(
        recovery_locations(&app)?,
        SystemRecoveryKeyStore,
        completion,
    )
}

#[tauri::command]
pub fn restore_ccswitch_recovery(
    app: tauri::AppHandle,
    snapshot_id: String,
) -> Result<FileObservation, CcSwitchCommandError> {
    let id = SnapshotId::parse(&snapshot_id).map_err(command_error_from_recovery)?;
    recovery_manager(&app)?
        .restore(&id)
        .map_err(command_error_from_recovery)
}

#[tauri::command]
pub fn discard_ccswitch_recovery(
    app: tauri::AppHandle,
    snapshot_id: String,
    confirmed: bool,
) -> Result<(), CcSwitchCommandError> {
    let id = SnapshotId::parse(&snapshot_id).map_err(command_error_from_recovery)?;
    let confirmation = if confirmed {
        DiscardConfirmation::Confirmed
    } else {
        DiscardConfirmation::Unconfirmed
    };
    recovery_manager(&app)?
        .discard(&id, confirmation)
        .map_err(command_error_from_recovery)
}

const MAX_MODEL_CATALOG_BYTES: u64 = 2 * 1024 * 1024;

fn prepare_provider_with_fetcher<F>(
    state: &CcSwitchSetupState,
    input: ProviderValidationInput,
    now: MillisSinceEpoch,
    fetcher: F,
) -> Result<ProviderSelectionResult, CcSwitchCommandError>
where
    F: FnOnce(&str, &str) -> Result<Vec<ModelChoice>, CcSwitchCommandError>,
{
    let provider = CcSwitchSetupState::validate_provider_input(input)
        .map_err(launch::command_error_from_contract)?;
    let models = fetcher(provider.endpoint(), provider.api_key())?;
    if catalog_reflects_secret(&models, provider.api_key()) {
        return Err(invalid_model_catalog_error());
    }
    state
        .stage_validated_provider(provider, models, now)
        .map_err(launch::command_error_from_contract)
}

fn fetch_model_catalog(
    endpoint: &str,
    api_key: &str,
) -> Result<Vec<ModelChoice>, CcSwitchCommandError> {
    let catalog_url = model_catalog_url(endpoint)?;
    let response = ureq::get(catalog_url.as_str())
        .set("Authorization", &format!("Bearer {api_key}"))
        .timeout(Duration::from_secs(10))
        .call()
        .map_err(command_error_from_model_request)?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_MODEL_CATALOG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid_model_catalog_error())?;
    if bytes.len() as u64 > MAX_MODEL_CATALOG_BYTES {
        return Err(invalid_model_catalog_error());
    }
    let payload: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| invalid_model_catalog_error())?;
    parse_model_catalog(&payload)
}

fn model_catalog_url(endpoint: &str) -> Result<url::Url, CcSwitchCommandError> {
    let mut url = url::Url::parse(endpoint).map_err(|_| CcSwitchCommandError {
        code: "ccswitch_invalid_endpoint",
        message: "Endpoint is invalid.",
    })?;
    let base_path = url.path().trim_end_matches('/');
    let catalog_path = if base_path.ends_with("/v1") || base_path == "v1" {
        format!("{base_path}/models")
    } else if base_path.is_empty() {
        "/v1/models".to_owned()
    } else {
        format!("{base_path}/v1/models")
    };
    url.set_path(&catalog_path);
    url.set_query(None);
    Ok(url)
}

fn parse_model_catalog(
    payload: &serde_json::Value,
) -> Result<Vec<ModelChoice>, CcSwitchCommandError> {
    let data = payload
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(invalid_model_catalog_error)?;
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for item in data {
        let Some(id) = ["id", "model", "slug"]
            .into_iter()
            .find_map(|key| item.get(key).and_then(serde_json::Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if !seen.insert(id.to_owned()) {
            continue;
        }
        let name = item
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(id);
        models.push(ModelChoice {
            id: id.to_owned(),
            name: name.to_owned(),
        });
    }
    if models.is_empty() {
        return Err(invalid_model_catalog_error());
    }
    Ok(models)
}

fn catalog_reflects_secret(models: &[ModelChoice], api_key: &str) -> bool {
    let encoded_api_key: String =
        url::form_urlencoded::byte_serialize(api_key.as_bytes()).collect();
    models.iter().any(|model| {
        [&model.id, &model.name].into_iter().any(|value| {
            value.contains(api_key)
                || (!encoded_api_key.is_empty() && value.contains(&encoded_api_key))
                || looks_like_api_key(value)
        })
    })
}

fn looks_like_api_key(value: &str) -> bool {
    let candidate = value.trim();
    if candidate.len() < 20 || candidate.chars().any(char::is_whitespace) {
        return false;
    }
    let lower = candidate.to_ascii_lowercase();
    [
        "sk-", "sk_", "pk-", "pk_", "rk-", "rk_", "ghp_", "glpat-", "xoxb-",
    ]
    .into_iter()
    .any(|prefix| lower.starts_with(prefix))
}

fn command_error_from_model_request(error: ureq::Error) -> CcSwitchCommandError {
    match error {
        ureq::Error::Status(401 | 403, _) => CcSwitchCommandError {
            code: "ccswitch_invalid_api_key",
            message: "The API key was rejected by the provider.",
        },
        ureq::Error::Status(_, _) | ureq::Error::Transport(_) => CcSwitchCommandError {
            code: "ccswitch_model_validation_unavailable",
            message: "The provider model catalog could not be reached.",
        },
    }
}

fn invalid_model_catalog_error() -> CcSwitchCommandError {
    CcSwitchCommandError {
        code: "ccswitch_invalid_model_catalog",
        message: "The provider returned an invalid model catalog.",
    }
}

fn missing_verified_catalog_error() -> CcSwitchCommandError {
    CcSwitchCommandError {
        code: "ccswitch_verified_model_catalog_missing",
        message: "Verify the API key in Settings before configuring CC Switch.",
    }
}

fn select_model_at_locations<K: RecoveryKeyStore>(
    state: &CcSwitchSetupState,
    input: ProviderSelectionInput,
    locations: RecoveryLocations,
    keys: K,
    now: MillisSinceEpoch,
) -> Result<CcSwitchPreparedProvider, CcSwitchCommandError> {
    let manager = RecoveryManager::new(locations, keys).map_err(command_error_from_recovery)?;
    let snapshot = manager
        .create_snapshot()
        .map_err(command_error_from_recovery)?;
    let pre_import_hash = snapshot
        .original
        .config
        .hash()
        .unwrap_or("missing")
        .to_owned();
    let validation = match state.select_model(input, &pre_import_hash, now) {
        Ok(validation) => validation,
        Err(error) => {
            manager
                .discard(&snapshot.id, DiscardConfirmation::Confirmed)
                .map_err(command_error_from_recovery)?;
            return Err(launch::command_error_from_contract(error));
        }
    };
    Ok(CcSwitchPreparedProvider {
        contract_version: validation.contract_version,
        receipt: validation.receipt.into(),
        recovery: CcSwitchRecoveryHandle {
            snapshot_id: snapshot.id.as_str().to_owned(),
            original: snapshot.original,
        },
    })
}

fn create_recovery_snapshot_at_locations<K: RecoveryKeyStore>(
    locations: RecoveryLocations,
    keys: K,
) -> Result<CcSwitchRecoveryHandle, CcSwitchCommandError> {
    let snapshot = RecoveryManager::new(locations, keys)
        .map_err(command_error_from_recovery)?
        .create_snapshot()
        .map_err(command_error_from_recovery)?;
    Ok(CcSwitchRecoveryHandle {
        snapshot_id: snapshot.id.as_str().to_owned(),
        original: snapshot.original,
    })
}

fn complete_recovery_at_locations<K: RecoveryKeyStore>(
    locations: RecoveryLocations,
    keys: K,
    request: CcSwitchRecoveryCompletionRequest,
) -> Result<RecoveryRetention, CcSwitchCommandError> {
    let id = SnapshotId::parse(&request.snapshot_id).map_err(command_error_from_recovery)?;
    let completion = match request.kind {
        CcSwitchRecoveryCompletionKind::Verified => RecoveryCompletion::Verified,
        CcSwitchRecoveryCompletionKind::Cancelled => {
            RecoveryCompletion::Cancelled(request.observed)
        }
        CcSwitchRecoveryCompletionKind::TimedOut => RecoveryCompletion::TimedOut(request.observed),
        CcSwitchRecoveryCompletionKind::ReadFailed => {
            RecoveryCompletion::ReadFailed(request.observed)
        }
    };
    RecoveryManager::new(locations, keys)
        .map_err(command_error_from_recovery)?
        .complete(&id, completion)
        .map_err(command_error_from_recovery)
}

fn recovery_manager(
    app: &tauri::AppHandle,
) -> Result<RecoveryManager<SystemRecoveryKeyStore>, CcSwitchCommandError> {
    RecoveryManager::new(recovery_locations(app)?, SystemRecoveryKeyStore)
        .map_err(command_error_from_recovery)
}

fn recovery_locations(app: &tauri::AppHandle) -> Result<RecoveryLocations, CcSwitchCommandError> {
    let home = app.path().home_dir().map_err(|_| CcSwitchCommandError {
        code: "ccswitch_recovery_path_rejected",
        message: "Unable to resolve the OpenCode home directory safely.",
    })?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| CcSwitchCommandError {
            code: "ccswitch_recovery_path_rejected",
            message: "Unable to resolve the YUME recovery directory safely.",
        })?;
    Ok(RecoveryLocations::new(home, app_data))
}

fn command_error_from_recovery(error: RecoveryError) -> CcSwitchCommandError {
    match error {
        RecoveryError::PathRejected => CcSwitchCommandError {
            code: "ccswitch_recovery_path_rejected",
            message: "Recovery paths were rejected.",
        },
        RecoveryError::ReadFailed => CcSwitchCommandError {
            code: "ccswitch_recovery_read_failed",
            message: "Unable to read OpenCode configuration safely.",
        },
        RecoveryError::WriteFailed => CcSwitchCommandError {
            code: "ccswitch_recovery_write_failed",
            message: "Unable to update recovery material safely.",
        },
        RecoveryError::InvalidSnapshot => CcSwitchCommandError {
            code: "ccswitch_recovery_invalid_snapshot",
            message: "Recovery snapshot is invalid.",
        },
        RecoveryError::SnapshotMissing => CcSwitchCommandError {
            code: "ccswitch_recovery_snapshot_missing",
            message: "Recovery snapshot is missing.",
        },
        RecoveryError::KeyUnavailable => CcSwitchCommandError {
            code: "ccswitch_recovery_key_unavailable",
            message: "Recovery key is unavailable.",
        },
        RecoveryError::KeyStoreFailed => CcSwitchCommandError {
            code: "ccswitch_recovery_key_store_failed",
            message: "Recovery key storage failed.",
        },
        RecoveryError::AuthenticationFailed => CcSwitchCommandError {
            code: "ccswitch_recovery_authentication_failed",
            message: "Recovery snapshot authentication failed.",
        },
        RecoveryError::ConfirmationRequired => CcSwitchCommandError {
            code: "ccswitch_recovery_confirmation_required",
            message: "Explicit recovery confirmation is required.",
        },
        RecoveryError::StaleConflict { .. } => CcSwitchCommandError {
            code: "ccswitch_recovery_stale_conflict",
            message: "Recovery refused to overwrite a newer external change.",
        },
    }
}

fn now_millis() -> MillisSinceEpoch {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            let millis = u64::try_from(duration.as_millis()).unwrap_or(u64::MAX);
            MillisSinceEpoch(millis)
        }
        Err(_) => MillisSinceEpoch(0),
    }
}

#[cfg(test)]
mod recovery_bridge_tests {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::fs;
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::thread;

    use super::*;

    struct TestTree {
        root: PathBuf,
        home: PathBuf,
        app_data: PathBuf,
    }

    impl TestTree {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "yume-ccswitch-protocol-bridge-test-{}",
                uuid::Uuid::new_v4()
            ));
            let home = root.join("home");
            let app_data = root.join("app-data");
            fs::create_dir_all(home.join(".config/opencode")).expect("create config dir");
            fs::create_dir_all(home.join(".local/share/opencode")).expect("create auth dir");
            fs::create_dir_all(&app_data).expect("create app-data dir");
            fs::write(
                home.join(".config/opencode/opencode.json"),
                br#"{"provider":{"old":{"options":{"baseURL":"https://old.example.test"}}}}"#,
            )
            .expect("write config");
            fs::write(
                home.join(".local/share/opencode/auth.json"),
                br#"{"old":true}"#,
            )
            .expect("write auth");
            Self {
                root,
                home,
                app_data,
            }
        }

        fn locations(&self) -> RecoveryLocations {
            RecoveryLocations::new(self.home.clone(), self.app_data.clone())
        }
    }

    impl Drop for TestTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[derive(Default)]
    struct FakeKeyStore {
        values: RefCell<HashMap<String, Vec<u8>>>,
    }

    impl RecoveryKeyStore for FakeKeyStore {
        fn store(&self, id: &SnapshotId, key: &[u8]) -> Result<(), RecoveryError> {
            self.values
                .borrow_mut()
                .insert(id.as_str().to_owned(), key.to_vec());
            Ok(())
        }

        fn load(&self, id: &SnapshotId) -> Result<Vec<u8>, RecoveryError> {
            self.values
                .borrow()
                .get(id.as_str())
                .cloned()
                .ok_or(RecoveryError::KeyUnavailable)
        }

        fn delete(&self, id: &SnapshotId) -> Result<(), RecoveryError> {
            self.values.borrow_mut().remove(id.as_str());
            Ok(())
        }
    }

    #[test]
    fn bridge_snapshot_completion_and_discard_use_temp_locations_without_secret_echo() {
        let tree = TestTree::new();
        let keys = FakeKeyStore::default();
        let canary = format!("bridge-secret-{}", uuid::Uuid::new_v4());
        fs::write(
            tree.home.join(".config/opencode/opencode.json"),
            canary.as_bytes(),
        )
        .expect("write canary config");

        let handle = create_recovery_snapshot_at_locations(tree.locations(), keys)
            .expect("snapshot is created");
        let serialized = serde_json::to_string(&handle).expect("handle serializes");

        assert!(!serialized.contains(&canary));

        let retained = complete_recovery_at_locations(
            tree.locations(),
            FakeKeyStore::default(),
            CcSwitchRecoveryCompletionRequest {
                snapshot_id: handle.snapshot_id.clone(),
                kind: CcSwitchRecoveryCompletionKind::TimedOut,
                observed: None,
            },
        )
        .err()
        .map(|error| error.code);

        assert_eq!(retained, Some("ccswitch_recovery_key_unavailable"));
    }

    #[test]
    fn validation_fetches_local_catalog_once_and_selection_keeps_secret_native() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake provider");
        let address = listener.local_addr().expect("fake provider address");
        let canary = format!("bridge-secret-{}", uuid::Uuid::new_v4());
        let expected_authorization = format!("Authorization: Bearer {canary}");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept validation request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1_024];
            loop {
                let read = stream.read(&mut buffer).expect("read validation request");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let authorized = request
                .windows(expected_authorization.len())
                .any(|window| window == expected_authorization.as_bytes());
            let correct_path = request.starts_with(b"GET /v1/models HTTP/1.1\r\n");
            let body = br#"{"data":[{"id":"model-a","name":"Model A"},{"id":"model-b"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response head");
            stream.write_all(body).expect("write response body");
            (authorized, correct_path)
        });

        let state = CcSwitchSetupState::default();
        let selection = prepare_provider_with_fetcher(
            &state,
            ProviderValidationInput {
                provider_name: "Local Provider".to_owned(),
                endpoint: format!("http://{address}/"),
                api_key: canary.clone(),
            },
            MillisSinceEpoch(1_000),
            fetch_model_catalog,
        )
        .expect("local validation succeeds");
        let serialized = serde_json::to_string(&selection).expect("selection serializes");
        assert!(!serialized.contains(&canary));
        assert_eq!(selection.models.len(), 2);
        assert_eq!(server.join().expect("fake provider joins"), (true, true));

        let tree = TestTree::new();
        let prepared = select_model_at_locations(
            &state,
            ProviderSelectionInput {
                selection_id: selection.selection_id,
                selected_model: "model-b".to_owned(),
            },
            tree.locations(),
            FakeKeyStore::default(),
            MillisSinceEpoch(2_000),
        )
        .expect("native model selection creates launch ticket");
        let serialized = serde_json::to_string(&prepared).expect("prepared result serializes");
        assert!(!serialized.contains(&canary));
        assert!(!serialized.contains("preImportHash"));
        assert!(!serialized.contains("\"models\""));
        assert_eq!(prepared.receipt.selected_model, "model-b");

        let launch_request = bind_launch_request(
            &state,
            CcSwitchLaunchCommandRequest {
                ticket_id: prepared.receipt.ticket_id.clone(),
                switch_immediately: true,
                accepted_process_argument_disclosure: true,
            },
        )
        .expect("native ticket supplies launch binding");
        assert_eq!(launch_request.provider_name, "Local Provider");
        assert_eq!(launch_request.selected_model, "model-b");
        assert_eq!(launch_request.pre_import_hash.len(), 64);
        assert!(launch_request.accepted_process_argument_disclosure);

        let injected_metadata = serde_json::json!({
            "ticketId": prepared.receipt.ticket_id,
            "switchImmediately": true,
            "acceptedProcessArgumentDisclosure": true,
            "preImportHash": "renderer-controlled"
        });
        assert!(serde_json::from_value::<CcSwitchLaunchCommandRequest>(injected_metadata).is_err());

        let ui_receipt: CcSwitchUiLaunchReceipt = CcSwitchLaunchReceipt {
            contract_version: 1,
            ticket_id: "ticket-for-ui".to_owned(),
            provider_name: "Local Provider".to_owned(),
            endpoint: "https://api.example.test".to_owned(),
            selected_model: "model-b".to_owned(),
            pre_import_hash: "native-only-hash".to_owned(),
            expires_at: MillisSinceEpoch(10_000),
            enabled: true,
        }
        .into();
        let ui_serialized = serde_json::to_string(&ui_receipt).expect("UI receipt serializes");
        assert!(!ui_serialized.contains("preImportHash"));
        assert!(!ui_serialized.contains("native-only-hash"));
    }

    #[test]
    fn settings_prepare_uses_verified_catalog_without_fetch_launch_or_serializing_secret() {
        let state = CcSwitchSetupState::default();
        let platform = super::launch_fixture::FakePlatform::ready("3.20.0");
        let canary = format!("settings-secret-{}", uuid::Uuid::new_v4());

        let selection = prepare_settings_provider_source(
            &state,
            SettingsProviderSource {
                provider_name: "YUME OpenCode".to_owned(),
                endpoint: "https://verified.example.test/v1/".to_owned(),
                api_key: canary.clone(),
                models: vec![
                    ModelChoice {
                        id: "model-a".to_owned(),
                        name: "Model A".to_owned(),
                    },
                    ModelChoice {
                        id: "model-b".to_owned(),
                        name: "Model B".to_owned(),
                    },
                ],
            },
            MillisSinceEpoch(2_000),
        )
        .expect("settings prepare uses saved material");

        assert!(platform.opened().is_none());
        let serialized = serde_json::to_string(&selection).expect("selection result serializes");
        assert!(!serialized.contains(&canary));
        assert!(!serialized.contains("preImportHash"));
        assert_eq!(selection.provider_name, "YUME OpenCode");
        assert_eq!(selection.endpoint, "https://verified.example.test/v1");
        assert_eq!(selection.models.len(), 2);

        let prepared = select_model_at_locations(
            &state,
            ProviderSelectionInput {
                selection_id: selection.selection_id,
                selected_model: "model-b".to_owned(),
            },
            TestTree::new().locations(),
            FakeKeyStore::default(),
            MillisSinceEpoch(3_000),
        )
        .expect("saved selection still requires explicit model confirmation");
        assert_eq!(prepared.receipt.selected_model, "model-b");
        assert!(platform.opened().is_none());
    }

    #[test]
    fn settings_prepare_fails_closed_when_saved_material_is_incomplete() {
        let state = CcSwitchSetupState::default();
        let platform = super::launch_fixture::FakePlatform::ready("3.20.0");

        let missing_key = prepare_settings_provider_source(
            &state,
            SettingsProviderSource {
                provider_name: "YUME OpenCode".to_owned(),
                endpoint: "https://verified.example.test/v1".to_owned(),
                api_key: String::new(),
                models: vec![ModelChoice {
                    id: "model-a".to_owned(),
                    name: "Model A".to_owned(),
                }],
            },
            MillisSinceEpoch(2_000),
        )
        .expect_err("empty saved key is rejected");
        assert_eq!(missing_key.code, "ccswitch_saved_api_key_missing");

        let missing_catalog = prepare_settings_provider_source(
            &state,
            SettingsProviderSource {
                provider_name: "YUME OpenCode".to_owned(),
                endpoint: "https://verified.example.test/v1".to_owned(),
                api_key: "saved-key".to_owned(),
                models: Vec::new(),
            },
            MillisSinceEpoch(2_000),
        )
        .expect_err("empty verified catalog is rejected");
        assert_eq!(
            missing_catalog.code,
            "ccswitch_verified_model_catalog_missing"
        );

        assert!(platform.opened().is_none());
    }

    #[test]
    fn settings_prepare_request_rejects_renderer_supplied_secret_material() {
        let forged = serde_json::json!({
            "providerName": "YUME OpenCode",
            "endpoint": "https://attacker.example.test/v1",
            "apiKey": "renderer-secret",
            "model": "attacker-model"
        });

        assert!(serde_json::from_value::<CcSwitchSettingsPrepareCommandRequest>(forged).is_err());
    }

    #[test]
    fn validation_rejects_a_catalog_that_reflects_the_submitted_secret() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake provider");
        let address = listener.local_addr().expect("fake provider address");
        let canary = format!("reflected-secret-{}", uuid::Uuid::new_v4());
        let reflected = canary.clone();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept validation request");
            let mut request = [0_u8; 2_048];
            let _ = stream.read(&mut request).expect("read validation request");
            let body = format!("{{\"data\":[{{\"id\":\"model-a\",\"name\":\"{reflected}\"}}]}}");
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write reflected response");
        });

        let error = prepare_provider_with_fetcher(
            &CcSwitchSetupState::default(),
            ProviderValidationInput {
                provider_name: "Reflected Provider".to_owned(),
                endpoint: format!("http://{address}"),
                api_key: canary.clone(),
            },
            MillisSinceEpoch(1_000),
            fetch_model_catalog,
        )
        .expect_err("secret-reflecting catalog is rejected");
        server.join().expect("fake provider joins");

        let serialized = serde_json::to_string(&error).expect("fixed error serializes");
        assert_eq!(error.code, "ccswitch_invalid_model_catalog");
        assert!(!serialized.contains(&canary));
    }

    #[test]
    fn validation_errors_are_fixed_and_never_echo_the_secret() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake provider");
        let address = listener.local_addr().expect("fake provider address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept validation request");
            let mut request = [0_u8; 2_048];
            let _ = stream.read(&mut request).expect("read validation request");
            stream
                .write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("write unauthorized response");
        });
        let canary = format!("rejected-secret-{}", uuid::Uuid::new_v4());
        let error = prepare_provider_with_fetcher(
            &CcSwitchSetupState::default(),
            ProviderValidationInput {
                provider_name: "Rejected Provider".to_owned(),
                endpoint: format!("http://{address}"),
                api_key: canary.clone(),
            },
            MillisSinceEpoch(1_000),
            fetch_model_catalog,
        )
        .expect_err("unauthorized provider is rejected");
        server.join().expect("fake provider joins");
        let serialized = serde_json::to_string(&error).expect("command error serializes");
        assert_eq!(error.code, "ccswitch_invalid_api_key");
        assert!(!serialized.contains(&canary));
    }
}
