use std::path::PathBuf;

use super::status::{
    ccswitch_capability_status_with_platform, CcSwitchUiStatus, CcSwitchUnavailableReason,
};
use crate::ccswitch::platform::{CcSwitchInstallation, CcSwitchPlatform, CcSwitchPlatformError};

struct StatusPlatform(Result<CcSwitchInstallation, CcSwitchPlatformError>);

impl CcSwitchPlatform for StatusPlatform {
    fn detect_installation(&self) -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
        self.0.clone()
    }

    fn open_import_url(&self, _url: &super::SecretImportUrl) -> Result<(), CcSwitchPlatformError> {
        Ok(())
    }
}

fn installation(version: Option<&str>) -> CcSwitchInstallation {
    CcSwitchInstallation {
        executable: PathBuf::from(r"C:\Tools\CC Switch\CC-Switch.exe"),
        version: version.map(str::to_owned),
    }
}

#[test]
fn reports_ready_missing_unsupported_and_incompatible_status() {
    assert_eq!(
        ccswitch_capability_status_with_platform(&StatusPlatform(Ok(installation(Some("3.20.0"))))),
        CcSwitchUiStatus::Ready {
            version: "3.20.0".into()
        }
    );
    assert_eq!(
        ccswitch_capability_status_with_platform(&StatusPlatform(Err(
            CcSwitchPlatformError::MissingProtocol
        ))),
        CcSwitchUiStatus::Unavailable {
            reason: CcSwitchUnavailableReason::MissingHandler
        }
    );
    assert_eq!(
        ccswitch_capability_status_with_platform(&StatusPlatform(Err(
            CcSwitchPlatformError::UnsupportedPlatform {
                platform: "linux".into()
            }
        ))),
        CcSwitchUiStatus::Unsupported {
            platform: "linux".into()
        }
    );
    assert_eq!(
        ccswitch_capability_status_with_platform(&StatusPlatform(Ok(installation(Some("3.19.9"))))),
        CcSwitchUiStatus::Unavailable {
            reason: CcSwitchUnavailableReason::NotInstalled
        }
    );
    assert_eq!(
        ccswitch_capability_status_with_platform(&StatusPlatform(Ok(installation(None)))),
        CcSwitchUiStatus::Unavailable {
            reason: CcSwitchUnavailableReason::Unknown
        }
    );
}

#[test]
fn malformed_versions_are_unavailable() {
    for version in ["3.20", "3.20.0.1", "not-a-version"] {
        assert_eq!(
            ccswitch_capability_status_with_platform(&StatusPlatform(Ok(installation(Some(
                version
            ))))),
            CcSwitchUiStatus::Unavailable {
                reason: CcSwitchUnavailableReason::NotInstalled
            }
        );
    }
}
