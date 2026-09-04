use crate::ccswitch::contract::{ModelChoice, ProviderSelectionInput};
use crate::ccswitch::platform::SystemCcSwitchPlatform;
use crate::ccswitch::recovery::{RecoveryRetention, SystemRecoveryKeyStore};
use crate::ccswitch::verification::{
    poll_external_change, ExternalVerification, VerificationProblem, VerificationTarget,
};
use crate::settings::SettingsState;
use tauri::Manager;

use super::launch::{launch_import_with_platform, CcSwitchLaunchReceipt, LaunchEnvironment};
use super::{
    bind_launch_request, complete_recovery_at_locations, now_millis,
    prepare_settings_provider_source, recovery_locations, recovery_manager,
    select_model_at_locations, CcSwitchCommandError, CcSwitchLaunchCommandRequest,
    CcSwitchPreparedProvider, CcSwitchRecoveryCompletionKind, CcSwitchRecoveryCompletionRequest,
    SettingsProviderSource,
};

const AUTOMATIC_PROVIDER_NAME: &str = "YUME OpenCode";

pub(crate) fn prepare_automatic_deployment(
    app: &tauri::AppHandle,
    requested_model: &str,
) -> Result<CcSwitchPreparedProvider, CcSwitchCommandError> {
    let setup_state = app.state::<crate::ccswitch::contract::CcSwitchSetupState>();
    let settings_state = app.state::<SettingsState>();
    let provider = crate::settings::active_provider_clone(&settings_state)
        .ok_or_else(|| fixed_error("ccswitch_saved_api_key_missing"))?;
    let api_key = if provider.api_key.trim().is_empty() {
        crate::settings::saved_api_key(&provider.id)
    } else {
        provider.api_key.clone()
    };
    if api_key.trim().is_empty() {
        return Err(fixed_error("ccswitch_saved_api_key_missing"));
    }
    let catalog = crate::settings::load_verified_model_catalog_for_provider(
        app,
        &provider.id,
        &provider.base_url,
        &api_key,
    )
    .ok_or_else(|| fixed_error("ccswitch_verified_model_catalog_missing"))?;
    let chosen_model = if requested_model.trim().is_empty() {
        catalog.models.first().map(|model| model.id.clone())
    } else {
        catalog
            .models
            .iter()
            .find(|model| model.id == requested_model)
            .map(|model| model.id.clone())
    }
    .ok_or_else(|| fixed_error("ccswitch_verified_model_missing"))?;
    let selection = prepare_settings_provider_source(
        &setup_state,
        SettingsProviderSource {
            provider_name: AUTOMATIC_PROVIDER_NAME.to_owned(),
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
        },
        now_millis(),
    )?;
    select_model_at_locations(
        &setup_state,
        ProviderSelectionInput {
            selection_id: selection.selection_id,
            selected_model: chosen_model,
        },
        recovery_locations(app)?,
        SystemRecoveryKeyStore,
        now_millis(),
    )
}

pub(crate) fn launch_automatic_deployment(
    app: &tauri::AppHandle,
    prepared: &CcSwitchPreparedProvider,
) -> Result<CcSwitchLaunchReceipt, CcSwitchCommandError> {
    let state = app.state::<crate::ccswitch::contract::CcSwitchSetupState>();
    let request = bind_launch_request(
        &state,
        CcSwitchLaunchCommandRequest {
            ticket_id: prepared.receipt.ticket_id.clone(),
            switch_immediately: true,
            accepted_process_argument_disclosure: true,
        },
    )?;
    launch_import_with_platform(
        LaunchEnvironment {
            state: &state,
            platform: &SystemCcSwitchPlatform,
            now: now_millis(),
        },
        request,
    )
}

pub(crate) fn verify_automatic_deployment(
    app: &tauri::AppHandle,
    prepared: &CcSwitchPreparedProvider,
    launched: &CcSwitchLaunchReceipt,
) -> Result<(), CcSwitchCommandError> {
    let manager = recovery_manager(app)?;
    let result = poll_external_change(
        manager.paths(),
        &VerificationTarget {
            provider_name: launched.provider_name.clone(),
            endpoint: launched.endpoint.clone(),
            model_id: launched.selected_model.clone(),
            initial: prepared.recovery.original.clone(),
        },
    );
    let observed = manager.observe_files().ok();
    let (kind, error) = match result {
        ExternalVerification::Verified { .. } => (CcSwitchRecoveryCompletionKind::Verified, None),
        ExternalVerification::ChangedInvalid { reason, .. } => (
            CcSwitchRecoveryCompletionKind::TimedOut,
            Some(fixed_error(match reason {
                VerificationProblem::ProviderMissing => "local_ai_configuration_provider_missing",
                VerificationProblem::ModelMissing => "local_ai_configuration_model_missing",
                VerificationProblem::AuthChanged => "local_ai_configuration_auth_changed",
                VerificationProblem::MalformedConfig => "local_ai_configuration_malformed",
            })),
        ),
        ExternalVerification::ReadFailure { .. } => (
            CcSwitchRecoveryCompletionKind::ReadFailed,
            Some(fixed_error("local_ai_configuration_unreadable")),
        ),
        ExternalVerification::Pending { .. } | ExternalVerification::Timeout { .. } => (
            CcSwitchRecoveryCompletionKind::TimedOut,
            Some(fixed_error("local_ai_configuration_timeout")),
        ),
    };
    let retention = complete_recovery_at_locations(
        recovery_locations(app)?,
        SystemRecoveryKeyStore,
        CcSwitchRecoveryCompletionRequest {
            snapshot_id: prepared.recovery.snapshot_id.clone(),
            kind,
            observed,
        },
    )?;
    if error.is_none() && retention != RecoveryRetention::Destroyed {
        return Err(fixed_error("local_ai_recovery_cleanup_failed"));
    }
    error.map_or(Ok(()), Err)
}

pub(crate) fn abandon_automatic_deployment(
    app: &tauri::AppHandle,
    prepared: &CcSwitchPreparedProvider,
) {
    let observed = recovery_manager(app)
        .ok()
        .and_then(|manager| manager.observe_files().ok());
    let _ = complete_recovery_at_locations(
        match recovery_locations(app) {
            Ok(locations) => locations,
            Err(_) => return,
        },
        SystemRecoveryKeyStore,
        CcSwitchRecoveryCompletionRequest {
            snapshot_id: prepared.recovery.snapshot_id.clone(),
            kind: CcSwitchRecoveryCompletionKind::Cancelled,
            observed,
        },
    );
}

fn fixed_error(code: &'static str) -> CcSwitchCommandError {
    CcSwitchCommandError {
        code,
        message: "Automatic local AI deployment could not be completed.",
    }
}
