use std::fs;
use std::path::PathBuf;

use super::*;

#[test]
fn parses_only_absolute_ccswitch_registry_commands() {
    let parsed = parse_registered_executable(
        r#""C:\Users\tester\AppData\Local\Programs\CC Switch\CC-Switch.exe" "%1""#,
    )
    // SAFE-EXPECT: this test fixture must parse so later assertions can inspect the path.
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
            // SAFE-EXPECT: this fixture is the valid registry shape under test.
            .expect("valid fixture detects CC Switch");

    assert_eq!(
        installation.executable,
        PathBuf::from(r"C:\Users\tester\AppData\Local\Programs\CC Switch\CC-Switch.exe")
    );
    assert_eq!(installation.version.as_deref(), Some("3.20.0"));
}

#[test]
fn fixture_detects_windows_short_path_registry_handler_without_real_registry() {
    let fixture = r#"
HKEY_CLASSES_ROOT\ccswitch\shell\open\command
    (Default)    REG_SZ    "C:\Users\CHENGL~1\AppData\Local\Programs\CCSWIT~1\CC-SWI~1.EXE" "%1"
"#;

    let installation =
        detect_installation_from_registry_output(true, fixture, |_| Some("3.20.0".into()))
            // SAFE-EXPECT: this fixture is the accepted Windows 8.3 registry shape under test.
            .expect("8.3 short-path handler detects CC Switch");

    assert_eq!(
        installation.executable,
        PathBuf::from(r"C:\Users\CHENGL~1\AppData\Local\Programs\CCSWIT~1\CC-SWI~1.EXE")
    );
    assert_eq!(installation.version.as_deref(), Some("3.20.0"));
}

#[test]
fn rejects_unrelated_or_spoofed_short_executable_names() {
    for command in [
        r#""C:\Tools\CC-SW1~1.EXE" "%1""#,
        r#""C:\Tools\CC-SWI~2.EXE" "%1""#,
        r#""C:\Tools\CC-SWI~1.BAT" "%1""#,
        r#""C:\Tools\CC-SWIT~1.EXE" "%1""#,
        r#""C:\Tools\CC-SWI~1.EXE.bak" "%1""#,
    ] {
        assert_eq!(parse_registered_executable(command), None);
    }
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
    // SAFE-EXPECT: compatibility decision requires a successfully parsed old-version fixture.
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
    // SAFE-EXPECT: the fixture path is constructed with a resources/app/package.json parent.
    fs::create_dir_all(package_json.parent().expect("package directory exists"))
        // SAFE-EXPECT: test cannot exercise metadata parsing without creating the fixture tree.
        .expect("fixture package directory is created");
    // SAFE-EXPECT: test cannot exercise metadata parsing without writing fixture metadata.
    fs::write(&package_json, r#"{"version":"3.20.0"}"#).expect("valid fixture metadata is written");

    assert_eq!(read_packaged_version(&executable), None);
    // SAFE-EXPECT: test cannot exercise executable-gated metadata parsing without a fixture exe.
    fs::write(&executable, []).expect("fixture executable is created");
    assert_eq!(
        read_packaged_version(&executable).as_deref(),
        Some("3.20.0")
    );
    // SAFE-EXPECT: test mutates the fixture metadata to verify malformed-package behavior.
    fs::write(&package_json, "{").expect("malformed fixture metadata is written");
    assert_eq!(read_packaged_version(&executable), None);

    // SAFE-EXPECT: cleanup failure should fail the test rather than hide leaked fixture files.
    fs::remove_dir_all(root).expect("version fixture is removed");
}

#[cfg(windows)]
#[test]
fn packaged_version_uses_product_version_reader_when_package_metadata_is_missing() {
    let root = std::env::temp_dir().join(format!(
        "yume-ccswitch-version-fallback-fixture-{}",
        uuid::Uuid::new_v4()
    ));
    let executable = root.join(CC_SWITCH_EXE);
    // SAFE-EXPECT: test cannot exercise fallback without creating the fixture directory.
    fs::create_dir_all(&root).expect("version fallback fixture directory is created");
    // SAFE-EXPECT: test cannot exercise fallback without an existing fixture executable.
    fs::write(&executable, []).expect("fixture executable is created");

    let version = read_packaged_version_with_product_reader(&executable, |path| {
        assert_eq!(path, executable.as_path());
        Some("3.20.1".to_owned())
    });

    assert_eq!(version.as_deref(), Some("3.20.1"));
    // SAFE-EXPECT: cleanup failure should fail the test rather than hide leaked fixture files.
    fs::remove_dir_all(root).expect("version fallback fixture is removed");
}
