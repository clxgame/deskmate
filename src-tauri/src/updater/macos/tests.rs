use std::{fs, path::Path};

use flate2::{write::GzEncoder, Compression};

use super::{app_path_from_executable, safe_backup_for};

#[test]
fn finds_the_owning_app_bundle_from_its_executable() {
    let executable = Path::new("/Applications/YUME.app/Contents/MacOS/yume");
    assert_eq!(
        app_path_from_executable(executable).as_deref(),
        Some(Path::new("/Applications/YUME.app"))
    );
}

#[test]
fn refuses_to_treat_an_unrelated_directory_as_the_update_backup() {
    let current = Path::new("/Applications/YUME.app");
    assert!(safe_backup_for(
        Path::new("/Applications/.YUME.update-backup-123.app"),
        current
    ));
    assert!(!safe_backup_for(
        Path::new("/Applications/Other.app"),
        current
    ));
    assert!(!safe_backup_for(
        Path::new("/tmp/.YUME.update-backup-123.app"),
        current
    ));
}

#[test]
fn privileged_scripts_receive_paths_as_arguments() {
    assert!(super::PRIVILEGED_SWAP_SCRIPT.contains("item 1 of argv"));
    assert!(super::PRIVILEGED_SWAP_SCRIPT.contains("quoted form"));
    assert!(!super::PRIVILEGED_SWAP_SCRIPT.contains("YUME.app"));
}

#[test]
fn archive_must_contain_exactly_one_app_root() {
    let mut bytes = Vec::new();
    {
        let encoder = GzEncoder::new(&mut bytes, Compression::default());
        let mut archive = tar::Builder::new(encoder);
        for path in [
            "YUME.app/Contents/MacOS/yume",
            "Other.app/Contents/MacOS/other",
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_mode(0o755);
            header.set_size(1);
            header.set_cksum();
            archive.append_data(&mut header, path, &[0_u8][..]).unwrap();
        }
        archive.into_inner().unwrap().finish().unwrap();
    }
    let destination = tempfile::tempdir().unwrap();
    assert_eq!(
        super::extract_single_app(&bytes, destination.path()).unwrap_err(),
        super::UpdateError::UnsafeInstall
    );
}

#[test]
fn restore_puts_the_backup_back_at_the_original_path() {
    let root = tempfile::tempdir().unwrap();
    let current = root.path().join("YUME.app");
    let backup = root.path().join(".YUME.update-backup-test.app");
    let failed = root.path().join(".YUME.update-failed-test.app");
    fs::create_dir(&current).unwrap();
    fs::write(current.join("version"), "new").unwrap();
    fs::create_dir(&backup).unwrap();
    fs::write(backup.join("version"), "old").unwrap();

    super::unprivileged_restore(&current, &backup, &failed).unwrap();

    assert_eq!(fs::read_to_string(current.join("version")).unwrap(), "old");
    assert!(!backup.exists());
    assert!(!failed.exists());
}
