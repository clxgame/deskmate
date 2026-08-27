use std::fs;
use std::path::{Path, PathBuf};

use super::*;

#[test]
fn builds_only_trusted_system32_rundll32_opener() {
    let opener = build_url_open_command(Path::new(r"C:\Windows"))
        .expect("absolute SystemRoot resolves trusted opener");

    assert_eq!(
        opener.program,
        PathBuf::from(r"C:\Windows\System32\rundll32.exe")
    );
    assert_eq!(opener.handler_arg, WINDOWS_FILE_PROTOCOL_HANDLER_ARG);
    assert_eq!(
        build_url_open_command(Path::new(r"C:\attacker-controlled")).err(),
        Some(CcSwitchPlatformError::InvalidSystemOpener)
    );
    assert_eq!(
        build_url_open_command(Path::new("Windows")).err(),
        Some(CcSwitchPlatformError::InvalidSystemOpener)
    );
    assert_eq!(
        build_url_open_command(Path::new("C:\\Windows\n")).err(),
        Some(CcSwitchPlatformError::InvalidSystemOpener)
    );
    assert_eq!(
        build_url_open_command(Path::new(r"C:\Windows\..\Temp")).err(),
        Some(CcSwitchPlatformError::InvalidSystemOpener)
    );
}

#[test]
fn trusted_system_opener_fails_closed_when_exact_executable_is_unavailable() {
    let root = std::env::temp_dir().join(format!(
        "yume-ccswitch-missing-opener-{}",
        uuid::Uuid::new_v4()
    ));
    let system32 = root.join("System32");
    fs::create_dir_all(&system32).expect("test System32 directory is created");

    let result = trusted_system_url_open_command_from_root(&root);

    fs::remove_dir_all(&root).expect("test SystemRoot is removed");
    assert_eq!(
        result.err(),
        Some(CcSwitchPlatformError::InvalidSystemOpener)
    );
}
