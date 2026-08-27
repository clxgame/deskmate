use std::fs;
use std::path::PathBuf;

use super::*;

#[test]
fn parses_only_absolute_ccswitch_registry_commands() {
    let parsed = parse_registered_executable(
        r#""C:\Users\tester\AppData\Local\Programs\CC Switch\CC-Switch.exe" "%1""#,
    )
    .expect("registered executable parses");
    assert_eq!(
        parsed.file_name().and_then(|name| name.to_str()),
        Some(CC_SWITCH_EXE)
    );

    assert!(parse_registered_executable(r#"cmd.exe /c "CC-Switch.exe" "%1""#).is_none());
    assert!(parse_registered_executable(r#""C:\Windows\System32\cmd.exe" /c "%1""#).is_none());
    assert!(parse_registered_executable("CC-Switch.exe %1").is_none());
    assert!(parse_registered_executable("\"C:\\Tools\\CC-Switch.exe\"\n%1").is_none());
}

#[test]
fn requires_exactly_one_standalone_uri_placeholder() {
    assert_eq!(
        parse_registered_executable(r#"C:\Tools\CC-Switch.exe %1"#),
        Some(PathBuf::from(r"C:\Tools\CC-Switch.exe"))
    );
    assert!(parse_registered_executable(r#""C:\Tools\CC-Switch.exe""#).is_none());
    assert!(parse_registered_executable(r#""C:\Tools\CC-Switch.exe" "%1" "%1""#).is_none());
    assert!(parse_registered_executable(r#""C:\Tools\CC-Switch.exe" "%1" --unexpected"#).is_none());
    assert!(parse_registered_executable(r#""C:\Tools\CC-Switch.exe" "%1suffix""#).is_none());
    assert!(parse_registered_executable(r#""C:\Tools\CC-Switch.exe"%1"#).is_none());
    assert!(parse_registered_executable(r#"C:\Tools\CC-Switch.exe%1"#).is_none());
}

#[test]
fn fixture_detects_valid_quoted_registry_handler_without_real_registry() {
    let fixture = r#"
HKEY_CLASSES_ROOT\ccswitch\shell\open\command
    (Default)    REG_SZ    "C:\Users\tester\AppData\Local\Programs\CC Switch\CC-Switch.exe" "%1"
"#;

    let installation =
        detect_installation_from_registry_output(true, fixture, |_| Some("3.20.0".into()))
            .expect("valid fixture detects CC Switch");

    assert_eq!(
        installation.executable,
        PathBuf::from(r"C:\Users\tester\AppData\Local\Programs\CC Switch\CC-Switch.exe")
    );
    assert_eq!(installation.version.as_deref(), Some("3.20.0"));
}

#[test]
fn fixture_rejects_missing_malformed_and_incompatible_registry_handlers() {
    assert_eq!(
        detect_installation_from_registry_output(false, "", |_| None).err(),
        Some(CcSwitchPlatformError::MissingProtocol)
    );
    assert_eq!(
        detect_installation_from_registry_output(true, "HKEY_CLASSES_ROOT\\ccswitch", |_| None)
            .err(),
        Some(CcSwitchPlatformError::MissingProtocol)
    );
    assert_eq!(
        detect_installation_from_registry_output(
            true,
            r#"(Default)    REG_SZ    "C:\Windows\System32\cmd.exe" /c "%1""#,
            |_| None
        )
        .err(),
        Some(CcSwitchPlatformError::MalformedProtocolCommand)
    );
    assert_eq!(
        detect_installation_from_registry_output(
            true,
            r#"(Default)    REG_SZ    "C:\Program Files\CC Switch\CC-Switch.exe" "%1""#,
            |_| None
        )
        .err(),
        Some(CcSwitchPlatformError::MalformedProtocolCommand)
    );

    let old = detect_installation_from_registry_output(
        true,
        r#"(Default)    REG_SZ    "C:\Program Files\CC Switch\CC-Switch.exe" "%1""#,
        |_| Some("3.19.9".into()),
    )
    .expect("old handler still detects for compatibility decision");
    assert_eq!(old.version.as_deref(), Some("3.19.9"));
}

#[cfg(windows)]
#[test]
fn packaged_version_requires_existing_executable_and_readable_metadata() {
    let root = std::env::temp_dir().join(format!(
        "yume-ccswitch-version-fixture-{}",
        uuid::Uuid::new_v4()
    ));
    let executable = root.join(CC_SWITCH_EXE);
    let package_json = root.join("resources").join("app").join("package.json");
    fs::create_dir_all(package_json.parent().expect("package directory exists"))
        .expect("fixture package directory is created");
    fs::write(&package_json, r#"{"version":"3.20.0"}"#).expect("valid fixture metadata is written");

    assert_eq!(read_packaged_version(&executable), None);
    fs::write(&executable, []).expect("fixture executable is created");
    assert_eq!(
        read_packaged_version(&executable).as_deref(),
        Some("3.20.0")
    );
    fs::write(&package_json, "{").expect("malformed fixture metadata is written");
    assert_eq!(read_packaged_version(&executable), None);

    fs::remove_dir_all(root).expect("version fixture is removed");
}
