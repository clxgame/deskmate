use std::path::PathBuf;
use std::sync::Mutex;

use super::launch::{LaunchCcSwitchImportRequest, LaunchEnvironment};
use crate::ccswitch::contract::{
    CcSwitchSetupState, HandoffReceipt, MillisSinceEpoch, ModelChoice, ProviderSetupInput,
};
use crate::ccswitch::platform::{CcSwitchInstallation, CcSwitchPlatform, CcSwitchPlatformError};

#[derive(Default)]
pub(super) struct FakePlatform {
    installation: Option<CcSwitchInstallation>,
    error: Option<CcSwitchPlatformError>,
    opened_url: Mutex<Option<String>>,
    open_error: bool,
}

impl FakePlatform {
    pub(super) fn ready(version: &str) -> Self {
        Self {
            installation: Some(CcSwitchInstallation {
                executable: PathBuf::from(r"C:\Tools\CC Switch\CC-Switch.exe"),
                version: Some(version.to_string()),
            }),
            error: None,
            opened_url: Mutex::new(None),
            open_error: false,
        }
    }

    pub(super) fn missing() -> Self {
        Self {
            installation: None,
            error: Some(CcSwitchPlatformError::MissingProtocol),
            opened_url: Mutex::new(None),
            open_error: false,
        }
    }

    pub(super) fn unknown_version() -> Self {
        Self {
            installation: Some(CcSwitchInstallation {
                executable: PathBuf::from(r"C:\Tools\CC Switch\CC-Switch.exe"),
                version: None,
            }),
            error: None,
            opened_url: Mutex::new(None),
            open_error: false,
        }
    }

    pub(super) fn failing_open(version: &str) -> Self {
        Self {
            open_error: true,
            ..Self::ready(version)
        }
    }

    pub(super) fn opened(&self) -> Option<String> {
        self.opened_url
            .lock()
            .expect("fake platform mutex is not poisoned")
            .clone()
    }
}

impl CcSwitchPlatform for FakePlatform {
    fn detect_installation(&self) -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
        if let Some(error) = &self.error {
            return Err(error.clone());
        }
        self.installation
            .clone()
            .ok_or(CcSwitchPlatformError::MissingProtocol)
    }

    fn open_import_url(&self, url: &super::SecretImportUrl) -> Result<(), CcSwitchPlatformError> {
        if self.open_error {
            return Err(CcSwitchPlatformError::OpenFailed);
        }
        *self
            .opened_url
            .lock()
            .expect("fake platform mutex is not poisoned") =
            Some(url.expose_for_platform().to_string());
        Ok(())
    }
}

pub(super) fn valid_setup(canary: &str) -> ProviderSetupInput {
    ProviderSetupInput {
        provider_name: "CC Test Provider".into(),
        endpoint: "https://api.example.test/v1/".into(),
        api_key: canary.into(),
        selected_model: "gpt-test".into(),
        models: vec![ModelChoice {
            id: "gpt-test".into(),
            name: "GPT Test".into(),
        }],
        pre_import_hash: "hash-before".into(),
    }
}

pub(super) fn valid_launch(ticket: &HandoffReceipt) -> LaunchCcSwitchImportRequest {
    LaunchCcSwitchImportRequest {
        ticket_id: ticket.ticket_id.clone(),
        provider_name: ticket.provider_name.clone(),
        endpoint: ticket.endpoint.clone(),
        selected_model: ticket.selected_model.clone(),
        pre_import_hash: ticket.pre_import_hash.clone(),
        switch_immediately: true,
        accepted_process_argument_disclosure: true,
    }
}

pub(super) fn launch_env<'a>(
    state: &'a CcSwitchSetupState,
    platform: &'a FakePlatform,
    now: u64,
) -> LaunchEnvironment<'a, FakePlatform> {
    LaunchEnvironment {
        state,
        platform,
        now: MillisSinceEpoch(now),
    }
}
