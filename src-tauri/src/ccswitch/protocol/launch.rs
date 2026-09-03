use serde::{Deserialize, Serialize};
use url::Url;

use super::status::supports_version;
use crate::ccswitch::contract::{
    CcSwitchContractError, CcSwitchSetupState, HandoffReceipt, MillisSinceEpoch,
    TicketConsumeRequest,
};
use crate::ccswitch::platform::{CcSwitchInstallation, CcSwitchPlatform, CcSwitchPlatformError};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchLaunchReceipt {
    pub contract_version: u8,
    pub ticket_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub selected_model: String,
    pub pre_import_hash: String,
    pub expires_at: MillisSinceEpoch,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchCommandError {
    pub code: &'static str,
    pub message: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCcSwitchImportRequest {
    pub ticket_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub selected_model: String,
    pub pre_import_hash: String,
    #[serde(default)]
    pub switch_immediately: bool,
    #[serde(default)]
    pub accepted_process_argument_disclosure: bool,
}

pub struct LaunchEnvironment<'a, P: CcSwitchPlatform> {
    pub state: &'a CcSwitchSetupState,
    pub platform: &'a P,
    pub now: MillisSinceEpoch,
}

pub struct SecretImportUrl {
    inner: Url,
}

impl SecretImportUrl {
    fn new(
        receipt: &HandoffReceipt,
        api_key: &str,
        switch_immediately: bool,
    ) -> Result<Self, CcSwitchCommandError> {
        let mut url = Url::parse("ccswitch://v1/import").map_err(|_| CcSwitchCommandError {
            code: "ccswitch_malformed_uri",
            message: "Unable to prepare the CC Switch import link.",
        })?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("resource", "provider");
            query.append_pair("app", "opencode");
            query.append_pair("name", &receipt.provider_name);
            query.append_pair("endpoint", &receipt.endpoint);
            query.append_pair("apiKey", api_key);
            query.append_pair("model", &receipt.selected_model);
            query.append_pair("enabled", if switch_immediately { "true" } else { "false" });
        }
        Ok(Self { inner: url })
    }

    pub(crate) fn expose_for_platform(&self) -> &str {
        self.inner.as_str()
    }
}

pub fn launch_import_with_platform<P: CcSwitchPlatform>(
    environment: LaunchEnvironment<'_, P>,
    request: LaunchCcSwitchImportRequest,
) -> Result<CcSwitchLaunchReceipt, CcSwitchCommandError> {
    if !request.accepted_process_argument_disclosure {
        return Err(CcSwitchCommandError {
            code: "ccswitch_confirmation_required",
            message: "Confirm the CC Switch process-argument disclosure before launching.",
        });
    }
    let installation = require_supported_installation(environment.platform)?;
    let switch_immediately = request.switch_immediately;
    let prepared = environment
        .state
        .consume_ticket(ticket_request_from_launch(request), environment.now)
        .map_err(command_error_from_contract)?;
    let receipt = prepared.receipt();
    let url = SecretImportUrl::new(&receipt, prepared.api_key(), switch_immediately)?;
    environment
        .platform
        .prepare_import(&installation)
        .map_err(command_error_from_platform)?;
    environment
        .platform
        .open_import_url(&url)
        .map_err(command_error_from_platform)?;
    Ok(CcSwitchLaunchReceipt {
        contract_version: receipt.contract_version,
        ticket_id: receipt.ticket_id,
        provider_name: receipt.provider_name,
        endpoint: receipt.endpoint,
        selected_model: receipt.selected_model,
        pre_import_hash: receipt.pre_import_hash,
        expires_at: receipt.expires_at,
        enabled: switch_immediately,
    })
}

fn ticket_request_from_launch(request: LaunchCcSwitchImportRequest) -> TicketConsumeRequest {
    TicketConsumeRequest {
        ticket_id: request.ticket_id,
        provider_name: request.provider_name,
        endpoint: request.endpoint,
        selected_model: request.selected_model,
        pre_import_hash: request.pre_import_hash,
    }
}

fn require_supported_installation(
    platform: &impl CcSwitchPlatform,
) -> Result<CcSwitchInstallation, CcSwitchCommandError> {
    let installation = platform
        .detect_installation()
        .map_err(command_error_from_platform)?;
    if !installation
        .version
        .as_deref()
        .is_some_and(supports_version)
    {
        return Err(CcSwitchCommandError {
            code: "ccswitch_incompatible_version",
            message: "CC Switch 3.20.0 or newer is required.",
        });
    }
    Ok(installation)
}

pub(crate) fn command_error_from_contract(error: CcSwitchContractError) -> CcSwitchCommandError {
    match error {
        CcSwitchContractError::InvalidProviderName => CcSwitchCommandError {
            code: "ccswitch_invalid_provider_name",
            message: "Provider name is invalid.",
        },
        CcSwitchContractError::InvalidEndpoint => CcSwitchCommandError {
            code: "ccswitch_invalid_endpoint",
            message: "Endpoint is invalid.",
        },
        CcSwitchContractError::InvalidApiKey => CcSwitchCommandError {
            code: "ccswitch_invalid_api_key",
            message: "API key is invalid.",
        },
        CcSwitchContractError::InvalidModelCatalog => CcSwitchCommandError {
            code: "ccswitch_invalid_model_catalog",
            message: "Model catalog is invalid.",
        },
        CcSwitchContractError::InvalidModel => CcSwitchCommandError {
            code: "ccswitch_invalid_model",
            message: "Selected model is invalid.",
        },
        CcSwitchContractError::InvalidHash => CcSwitchCommandError {
            code: "ccswitch_invalid_hash",
            message: "Configuration hash is invalid.",
        },
        CcSwitchContractError::TicketMissing => CcSwitchCommandError {
            code: "ccswitch_ticket_missing",
            message: "The setup ticket is unavailable.",
        },
        CcSwitchContractError::TicketExpired => CcSwitchCommandError {
            code: "ccswitch_ticket_expired",
            message: "The setup ticket expired.",
        },
        CcSwitchContractError::TicketStale => CcSwitchCommandError {
            code: "ccswitch_ticket_stale",
            message: "The setup ticket no longer matches the validated provider.",
        },
        CcSwitchContractError::SelectionMissing => CcSwitchCommandError {
            code: "ccswitch_selection_missing",
            message: "The provider selection is unavailable.",
        },
        CcSwitchContractError::SelectionExpired => CcSwitchCommandError {
            code: "ccswitch_selection_expired",
            message: "The provider selection expired.",
        },
    }
}

fn command_error_from_platform(error: CcSwitchPlatformError) -> CcSwitchCommandError {
    match error {
        CcSwitchPlatformError::UnsupportedPlatform { .. } => CcSwitchCommandError {
            code: "ccswitch_unsupported_platform",
            message: "CC Switch setup is available on Windows only.",
        },
        CcSwitchPlatformError::MissingProtocol => CcSwitchCommandError {
            code: "ccswitch_missing_protocol",
            message: "CC Switch protocol handler is missing.",
        },
        CcSwitchPlatformError::MalformedProtocolCommand => CcSwitchCommandError {
            code: "ccswitch_malformed_protocol",
            message: "CC Switch protocol handler is invalid.",
        },
        CcSwitchPlatformError::InvalidSystemOpener => CcSwitchCommandError {
            code: "ccswitch_invalid_system_opener",
            message: "Windows URL launcher could not be resolved safely.",
        },
        CcSwitchPlatformError::OpenFailed => CcSwitchCommandError {
            code: "ccswitch_open_failed",
            message: "Unable to open CC Switch.",
        },
    }
}
