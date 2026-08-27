use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use super::contract::{
    CcSwitchSetupState, MillisSinceEpoch, ProviderSetupInput, ProviderValidationResult,
};
use super::platform::SystemCcSwitchPlatform;

mod launch;
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
    input: ProviderSetupInput,
) -> Result<ProviderValidationResult, CcSwitchCommandError> {
    state
        .stage_provider(input, now_millis())
        .map_err(launch::command_error_from_contract)
}

#[tauri::command]
pub fn launch_ccswitch_opencode_import(
    state: State<CcSwitchSetupState>,
    request: LaunchCcSwitchImportRequest,
) -> Result<CcSwitchLaunchReceipt, CcSwitchCommandError> {
    launch_import_with_platform(
        LaunchEnvironment {
            state: &state,
            platform: &SystemCcSwitchPlatform,
            now: now_millis(),
        },
        request,
    )
}

#[tauri::command]
pub fn cancel_ccswitch_setup(
    state: State<CcSwitchSetupState>,
    ticket_id: String,
) -> Result<(), CcSwitchCommandError> {
    state
        .cancel_ticket(&ticket_id)
        .map_err(launch::command_error_from_contract)
}

fn now_millis() -> MillisSinceEpoch {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            let millis = match u64::try_from(duration.as_millis()) {
                Ok(value) => value,
                Err(_) => u64::MAX,
            };
            MillisSinceEpoch(millis)
        }
        Err(_) => MillisSinceEpoch(0),
    }
}
