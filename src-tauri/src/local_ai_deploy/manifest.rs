#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct CcSwitchPackage {
    pub version: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub fallback_url: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

const X64: CcSwitchPackage = CcSwitchPackage {
    version: "3.20.1",
    filename: "CC-Switch-v3.20.1-Windows.msi",
    url: "https://dl.ccswitch.io/v3.20.1/CC-Switch-v3.20.1-Windows.msi",
    fallback_url: "https://github.com/farion1231/cc-switch/releases/download/v3.20.1/CC-Switch-v3.20.1-Windows.msi",
    sha256: "b2a958ccd2bbfd1c44c614d9bebb0dd9f4a55066deed2962511032a487f7ab90",
    size: 13_553_664,
};

const ARM64: CcSwitchPackage = CcSwitchPackage {
    version: "3.20.1",
    filename: "CC-Switch-v3.20.1-Windows-arm64.msi",
    url: "https://dl.ccswitch.io/v3.20.1/CC-Switch-v3.20.1-Windows-arm64.msi",
    fallback_url: "https://github.com/farion1231/cc-switch/releases/download/v3.20.1/CC-Switch-v3.20.1-Windows-arm64.msi",
    sha256: "101a42cd7f554754d68d5a124305d3d71a3b417e69a64ea4d2b6f475e3b271e7",
    size: 12_836_864,
};

pub(super) fn ccswitch_package_for_arch(arch: &str) -> Option<CcSwitchPackage> {
    match arch {
        "x86_64" => Some(X64),
        "aarch64" => Some(ARM64),
        _ => None,
    }
}
