use std::{
    ffi::OsStr,
    fs,
    io::Cursor,
    path::{Component, Path, PathBuf},
    process::{Command, Output},
};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::UpdateError;

const RECEIPT_NAME: &str = "pending-macos-update.json";
const PRIVILEGED_SWAP_SCRIPT: &str = r#"
on run argv
  set candidatePath to quoted form of item 1 of argv
  set currentPath to quoted form of item 2 of argv
  set stagePath to quoted form of item 3 of argv
  set backupPath to quoted form of item 4 of argv
  set commandText to "/usr/bin/ditto " & candidatePath & " " & stagePath & " && /bin/mv " & currentPath & " " & backupPath & " && ( /bin/mv " & stagePath & " " & currentPath & " || ( /bin/mv " & backupPath & " " & currentPath & "; exit 1 ) )"
  do shell script commandText with administrator privileges
end run
"#;
const PRIVILEGED_RESTORE_SCRIPT: &str = r#"
on run argv
  set currentPath to quoted form of item 1 of argv
  set backupPath to quoted form of item 2 of argv
  set failedPath to quoted form of item 3 of argv
  set commandText to "if test -e " & currentPath & "; then /bin/mv " & currentPath & " " & failedPath & "; fi; /bin/mv " & backupPath & " " & currentPath
  do shell script commandText with administrator privileges
end run
"#;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallReceipt {
    current_app: PathBuf,
    backup_app: PathBuf,
    expected_version: String,
}

pub(super) fn install_update_archive(
    app: &AppHandle,
    archive: &[u8],
    expected_version: &str,
) -> Result<(), UpdateError> {
    let current_app = current_app_path().ok_or(UpdateError::UnsafeInstall)?;
    validate_install_location(&current_app)?;
    let parent = current_app.parent().ok_or(UpdateError::UnsafeInstall)?;
    let name = current_app
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|name| !name.is_empty())
        .ok_or(UpdateError::UnsafeInstall)?;
    let transaction = uuid::Uuid::new_v4().simple().to_string();
    let stage = parent.join(format!(".{name}.update-stage-{transaction}.app"));
    let backup = parent.join(format!(".{name}.update-backup-{transaction}.app"));
    let failed = parent.join(format!(".{name}.update-failed-{transaction}.app"));

    let extracted = tempfile::Builder::new()
        .prefix("yume-verified-update-")
        .tempdir()
        .map_err(|_| UpdateError::UpdateFailed)?;
    let candidate = extract_single_app(archive, extracted.path())?;
    let expected_identifier = app.config().identifier.as_str();
    let expected_team = signing_team(&current_app)?;
    validate_candidate(
        &candidate,
        expected_version,
        expected_identifier,
        &expected_team,
    )?;

    let receipt = InstallReceipt {
        current_app: current_app.clone(),
        backup_app: backup.clone(),
        expected_version: expected_version.to_owned(),
    };
    write_receipt(app, &receipt)?;

    let result = if parent_is_writable(parent) {
        unprivileged_swap(&candidate, &current_app, &stage, &backup)
    } else {
        privileged_swap(&candidate, &current_app, &stage, &backup)
    };
    if let Err(error) = result {
        if current_app.exists() {
            let _ = remove_receipt(app);
            return Err(error);
        }
        return Err(UpdateError::RestoreFailed);
    }

    if validate_candidate(
        &current_app,
        expected_version,
        expected_identifier,
        &expected_team,
    )
    .is_err()
    {
        let restored = if parent_is_writable(parent) {
            unprivileged_restore(&current_app, &backup, &failed)
        } else {
            privileged_restore(&current_app, &backup, &failed)
        };
        if restored.is_err() || !current_app.exists() {
            return Err(UpdateError::RestoreFailed);
        }
        let _ = remove_receipt(app);
        return Err(UpdateError::UnsafeInstall);
    }
    Ok(())
}

pub(super) fn confirm_installed_update(app: &AppHandle) -> Result<(), UpdateError> {
    let Some(receipt) = read_receipt(app)? else {
        return Ok(());
    };
    let Some(current) = current_app_path() else {
        return Ok(());
    };
    if current != receipt.current_app
        || app.package_info().version.to_string() != receipt.expected_version
        || !safe_backup_for(&receipt.backup_app, &receipt.current_app)
    {
        return Ok(());
    }
    if receipt.backup_app.exists() {
        fs::remove_dir_all(&receipt.backup_app).map_err(|_| UpdateError::UpdateFailed)?;
    }
    remove_receipt(app)
}

fn current_app_path() -> Option<PathBuf> {
    app_path_from_executable(&std::env::current_exe().ok()?)
}

fn app_path_from_executable(executable: &Path) -> Option<PathBuf> {
    executable
        .ancestors()
        .find(|path| path.extension().and_then(OsStr::to_str) == Some("app"))
        .map(Path::to_path_buf)
}

fn validate_install_location(app: &Path) -> Result<(), UpdateError> {
    if !app.is_absolute()
        || app.extension().and_then(OsStr::to_str) != Some("app")
        || app
            .components()
            .any(|part| matches!(part, Component::Normal(value) if value == "AppTranslocation"))
        || app.starts_with("/Volumes")
        || !app.join("Contents/MacOS").is_dir()
    {
        return Err(UpdateError::UnsafeInstall);
    }
    Ok(())
}

fn extract_single_app(archive: &[u8], destination: &Path) -> Result<PathBuf, UpdateError> {
    let decoder = GzDecoder::new(Cursor::new(archive));
    let mut tar = tar::Archive::new(decoder);
    let mut root: Option<PathBuf> = None;
    for entry in tar.entries().map_err(|_| UpdateError::UnsafeInstall)? {
        let mut entry = entry.map_err(|_| UpdateError::UnsafeInstall)?;
        let path = entry.path().map_err(|_| UpdateError::UnsafeInstall)?;
        let mut components = path.components();
        let first = match components.next() {
            Some(Component::CurDir) => components.next(),
            other => other,
        };
        let Some(Component::Normal(first)) = first else {
            return Err(UpdateError::UnsafeInstall);
        };
        let first = PathBuf::from(first);
        if first.extension().and_then(OsStr::to_str) != Some("app")
            || root.as_ref().is_some_and(|known| known != &first)
        {
            return Err(UpdateError::UnsafeInstall);
        }
        root.get_or_insert(first);
        if !entry
            .unpack_in(destination)
            .map_err(|_| UpdateError::UnsafeInstall)?
        {
            return Err(UpdateError::UnsafeInstall);
        }
    }
    let candidate = destination.join(root.ok_or(UpdateError::UnsafeInstall)?);
    if !candidate.join("Contents/MacOS").is_dir() {
        return Err(UpdateError::UnsafeInstall);
    }
    Ok(candidate)
}

fn validate_candidate(
    app: &Path,
    expected_version: &str,
    expected_identifier: &str,
    expected_team: &str,
) -> Result<(), UpdateError> {
    let plist = app.join("Contents/Info.plist");
    if plist_value(&plist, "CFBundleIdentifier")? != expected_identifier
        || plist_value(&plist, "CFBundleShortVersionString")? != expected_version
    {
        return Err(UpdateError::UnsafeInstall);
    }
    let executable = app
        .join("Contents/MacOS")
        .join(plist_value(&plist, "CFBundleExecutable")?);
    let archs = successful_output(Command::new("/usr/bin/lipo").arg("-archs").arg(&executable))?;
    if !String::from_utf8_lossy(&archs.stdout)
        .split_whitespace()
        .any(|arch| arch == "arm64")
    {
        return Err(UpdateError::UnsafeInstall);
    }
    successful_output(
        Command::new("/usr/bin/codesign")
            .args(["--verify", "--deep", "--strict", "--verbose=2"])
            .arg(app),
    )?;
    if signing_team(app)? != expected_team {
        return Err(UpdateError::UnsafeInstall);
    }
    Ok(())
}

fn plist_value(plist: &Path, key: &str) -> Result<String, UpdateError> {
    let output = successful_output(
        Command::new("/usr/libexec/PlistBuddy")
            .arg("-c")
            .arg(format!("Print :{key}"))
            .arg(plist),
    )?;
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_owned())
        .map_err(|_| UpdateError::UnsafeInstall)
}

fn signing_team(app: &Path) -> Result<String, UpdateError> {
    let output = Command::new("/usr/bin/codesign")
        .args(["-dv", "--verbose=4"])
        .arg(app)
        .output()
        .map_err(|_| UpdateError::UnsafeInstall)?;
    if !output.status.success() {
        return Err(UpdateError::UnsafeInstall);
    }
    String::from_utf8_lossy(&output.stderr)
        .lines()
        .find_map(|line| line.strip_prefix("TeamIdentifier="))
        .filter(|team| !team.is_empty() && *team != "not set")
        .map(str::to_owned)
        .ok_or(UpdateError::UnsafeInstall)
}

fn successful_output(command: &mut Command) -> Result<Output, UpdateError> {
    let output = command.output().map_err(|_| UpdateError::UnsafeInstall)?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(UpdateError::UnsafeInstall)
    }
}

fn parent_is_writable(parent: &Path) -> bool {
    let probe = parent.join(format!(
        ".yume-update-write-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => fs::remove_file(probe).is_ok(),
        Err(_) => false,
    }
}

fn run_ditto(source: &Path, destination: &Path) -> Result<(), UpdateError> {
    let status = Command::new("/usr/bin/ditto")
        .arg(source)
        .arg(destination)
        .status()
        .map_err(|_| UpdateError::UpdateFailed)?;
    if status.success() {
        Ok(())
    } else {
        Err(UpdateError::UpdateFailed)
    }
}

fn unprivileged_swap(
    candidate: &Path,
    current: &Path,
    stage: &Path,
    backup: &Path,
) -> Result<(), UpdateError> {
    run_ditto(candidate, stage)?;
    if let Err(error) = fs::rename(current, backup) {
        let _ = fs::remove_dir_all(stage);
        return Err(if error.kind() == std::io::ErrorKind::PermissionDenied {
            UpdateError::PermissionDenied
        } else {
            UpdateError::UpdateFailed
        });
    }
    if fs::rename(stage, current).is_err() {
        return match fs::rename(backup, current) {
            Ok(()) => Err(UpdateError::UpdateFailed),
            Err(_) => Err(UpdateError::RestoreFailed),
        };
    }
    Ok(())
}

fn unprivileged_restore(current: &Path, backup: &Path, failed: &Path) -> Result<(), UpdateError> {
    if current.exists() {
        fs::rename(current, failed).map_err(|_| UpdateError::RestoreFailed)?;
    }
    fs::rename(backup, current).map_err(|_| UpdateError::RestoreFailed)?;
    let _ = fs::remove_dir_all(failed);
    Ok(())
}

fn privileged_swap(
    candidate: &Path,
    current: &Path,
    stage: &Path,
    backup: &Path,
) -> Result<(), UpdateError> {
    run_osascript(PRIVILEGED_SWAP_SCRIPT, [candidate, current, stage, backup])
}

fn privileged_restore(current: &Path, backup: &Path, failed: &Path) -> Result<(), UpdateError> {
    run_osascript(PRIVILEGED_RESTORE_SCRIPT, [current, backup, failed])
        .map_err(|_| UpdateError::RestoreFailed)
}

fn run_osascript<const N: usize>(script: &str, paths: [&Path; N]) -> Result<(), UpdateError> {
    let mut command = Command::new("/usr/bin/osascript");
    command.arg("-e").arg(script);
    for path in paths {
        command.arg(path);
    }
    let output = command
        .output()
        .map_err(|_| UpdateError::PermissionDenied)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(UpdateError::PermissionDenied)
    }
}

fn receipt_path(app: &AppHandle) -> Result<PathBuf, UpdateError> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("updater").join(RECEIPT_NAME))
        .map_err(|_| UpdateError::UpdateFailed)
}

fn write_receipt(app: &AppHandle, receipt: &InstallReceipt) -> Result<(), UpdateError> {
    let path = receipt_path(app)?;
    let directory = path.parent().ok_or(UpdateError::UpdateFailed)?;
    fs::create_dir_all(directory).map_err(|_| UpdateError::UpdateFailed)?;
    let temporary = directory.join(format!(".{RECEIPT_NAME}.tmp"));
    let bytes = serde_json::to_vec(receipt).map_err(|_| UpdateError::UpdateFailed)?;
    fs::write(&temporary, bytes).map_err(|_| UpdateError::UpdateFailed)?;
    fs::rename(temporary, path).map_err(|_| UpdateError::UpdateFailed)
}

fn read_receipt(app: &AppHandle) -> Result<Option<InstallReceipt>, UpdateError> {
    let path = receipt_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|_| UpdateError::UpdateFailed)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| UpdateError::UpdateFailed)
}

fn remove_receipt(app: &AppHandle) -> Result<(), UpdateError> {
    let path = receipt_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| UpdateError::UpdateFailed)?;
    }
    Ok(())
}

fn safe_backup_for(backup: &Path, current: &Path) -> bool {
    backup.parent() == current.parent()
        && backup.extension().and_then(OsStr::to_str) == Some("app")
        && backup
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|name| name.starts_with(".YUME.update-backup-"))
}

#[cfg(test)]
#[path = "macos/tests.rs"]
mod tests;
