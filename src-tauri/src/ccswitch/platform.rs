use std::path::PathBuf;

use super::protocol::SecretImportUrl;

mod windows;

#[cfg(test)]
use windows::{
    build_url_open_command, detect_installation_from_registry_output, parse_registered_executable,
    read_packaged_version, read_packaged_version_with_product_reader,
    trusted_system_url_open_command_from_root, CC_SWITCH_EXE, WINDOWS_FILE_PROTOCOL_HANDLER_ARG,
};
#[cfg(windows)]
use windows::{detect_system_installation, open_system_url, prepare_system_import};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CcSwitchInstallation {
    pub executable: PathBuf,
    pub version: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CcSwitchPlatformError {
    UnsupportedPlatform { platform: String },
    MissingProtocol,
    MalformedProtocolCommand,
    InvalidSystemOpener,
    OpenFailed,
}

pub trait CcSwitchPlatform {
    fn detect_installation(&self) -> Result<CcSwitchInstallation, CcSwitchPlatformError>;
    fn prepare_import(
        &self,
        installation: &CcSwitchInstallation,
    ) -> Result<(), CcSwitchPlatformError>;
    fn open_import_url(&self, url: &SecretImportUrl) -> Result<(), CcSwitchPlatformError>;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemCcSwitchPlatform;

impl CcSwitchPlatform for SystemCcSwitchPlatform {
    fn detect_installation(&self) -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
        detect_system_installation()
    }

    fn prepare_import(
        &self,
        installation: &CcSwitchInstallation,
    ) -> Result<(), CcSwitchPlatformError> {
        prepare_system_import(installation)
    }

    fn open_import_url(&self, url: &SecretImportUrl) -> Result<(), CcSwitchPlatformError> {
        open_system_url(url)
    }
}

#[cfg(not(windows))]
fn detect_system_installation() -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
    Err(CcSwitchPlatformError::UnsupportedPlatform {
        platform: std::env::consts::OS.to_string(),
    })
}

#[cfg(not(windows))]
fn open_system_url(_url: &SecretImportUrl) -> Result<(), CcSwitchPlatformError> {
    Err(CcSwitchPlatformError::UnsupportedPlatform {
        platform: std::env::consts::OS.to_string(),
    })
}

#[cfg(not(windows))]
fn prepare_system_import(
    _installation: &CcSwitchInstallation,
) -> Result<(), CcSwitchPlatformError> {
    Err(CcSwitchPlatformError::UnsupportedPlatform {
        platform: std::env::consts::OS.to_string(),
    })
}

#[cfg(test)]
mod opener_tests;
#[cfg(test)]
mod registry_tests;
