use serde::Serialize;

use crate::ccswitch::platform::{CcSwitchInstallation, CcSwitchPlatform, CcSwitchPlatformError};

const MIN_CC_SWITCH_MAJOR: u16 = 3;
const MIN_CC_SWITCH_MINOR: u16 = 20;
const MIN_CC_SWITCH_PATCH: u16 = 0;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CcSwitchUiStatus {
    Ready { version: String },
    Unavailable { reason: CcSwitchUnavailableReason },
    Unsupported { platform: String },
    RecoverableError { message: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CcSwitchUnavailableReason {
    MissingHandler,
    NotInstalled,
    Unknown,
}

pub fn ccswitch_capability_status_with_platform(
    platform: &impl CcSwitchPlatform,
) -> CcSwitchUiStatus {
    match platform.detect_installation() {
        Ok(installation) => status_from_installation(installation),
        Err(CcSwitchPlatformError::UnsupportedPlatform { platform }) => {
            CcSwitchUiStatus::Unsupported { platform }
        }
        Err(CcSwitchPlatformError::MissingProtocol) => CcSwitchUiStatus::Unavailable {
            reason: CcSwitchUnavailableReason::MissingHandler,
        },
        Err(CcSwitchPlatformError::MalformedProtocolCommand) => CcSwitchUiStatus::Unavailable {
            reason: CcSwitchUnavailableReason::NotInstalled,
        },
        Err(CcSwitchPlatformError::InvalidSystemOpener | CcSwitchPlatformError::OpenFailed) => {
            CcSwitchUiStatus::RecoverableError {
                message: "CC Switch did not accept the import launch request.".into(),
            }
        }
    }
}

pub(crate) fn supports_version(version: &str) -> bool {
    let mut parts = version.split('.');
    let Some(major) = parts.next().and_then(|part| part.parse::<u16>().ok()) else {
        return false;
    };
    let Some(minor) = parts.next().and_then(|part| part.parse::<u16>().ok()) else {
        return false;
    };
    let Some(patch) = parts.next().and_then(|part| part.parse::<u16>().ok()) else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    (major, minor, patch)
        >= (
            MIN_CC_SWITCH_MAJOR,
            MIN_CC_SWITCH_MINOR,
            MIN_CC_SWITCH_PATCH,
        )
}

fn status_from_installation(installation: CcSwitchInstallation) -> CcSwitchUiStatus {
    match installation.version {
        Some(version) if supports_version(&version) => CcSwitchUiStatus::Ready { version },
        Some(_) => CcSwitchUiStatus::Unavailable {
            reason: CcSwitchUnavailableReason::NotInstalled,
        },
        None => CcSwitchUiStatus::Unavailable {
            reason: CcSwitchUnavailableReason::Unknown,
        },
    }
}
