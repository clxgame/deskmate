use std::fs;
use std::os::windows::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use tauri::Manager;
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

use super::download::ensure_cc_switch_package;
use super::{merge_user_path, CcSwitchPackage, LocalAiDeploymentError};
use crate::ccswitch::platform::{CcSwitchPlatform, SystemCcSwitchPlatform};
use crate::ccswitch::protocol::supports_version_for_deployment;

pub(super) const PINNED_OPENCODE_VERSION: &str = "1.18.21";
const CREATE_NO_WINDOW: u32 = 0x08000000;
const POWERSHELL: &str = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
const MSIEXEC: &str = r"C:\Windows\System32\msiexec.exe";

pub(super) fn installed_open_code_version(app: &tauri::AppHandle) -> Option<String> {
    open_code_target(app)
        .ok()
        .and_then(|path| executable_version(&path))
}

pub(super) fn install_open_code(app: &tauri::AppHandle) -> Result<String, LocalAiDeploymentError> {
    let source = bundled_open_code(app)?;
    if executable_version(&source).as_deref() != Some(PINNED_OPENCODE_VERSION) {
        return Err(LocalAiDeploymentError::new(
            "local_ai_opencode_resource_invalid",
        ));
    }
    let target = open_code_target(app)?;
    let bin_directory = target
        .parent()
        .ok_or_else(|| LocalAiDeploymentError::new("local_ai_opencode_install_failed"))?;
    fs::create_dir_all(bin_directory)
        .map_err(|_| LocalAiDeploymentError::new("local_ai_opencode_install_failed"))?;
    if !plain_directory(bin_directory) {
        return Err(LocalAiDeploymentError::new(
            "local_ai_opencode_install_failed",
        ));
    }
    if executable_version(&target).as_deref() != Some(PINNED_OPENCODE_VERSION) {
        if target.exists() && !regular_file(&target) {
            return Err(LocalAiDeploymentError::new(
                "local_ai_opencode_install_failed",
            ));
        }
        let partial = bin_directory.join(format!("opencode-{}.partial", uuid::Uuid::new_v4()));
        let install_result = (|| {
            fs::copy(&source, &partial)
                .map_err(|_| LocalAiDeploymentError::new("local_ai_opencode_install_failed"))?;
            if executable_version(&partial).as_deref() != Some(PINNED_OPENCODE_VERSION) {
                return Err(LocalAiDeploymentError::new(
                    "local_ai_opencode_install_unverified",
                ));
            }
            replace_file(&partial, &target)
        })();
        if install_result.is_err() {
            let _ = fs::remove_file(&partial);
        }
        install_result?;
    }
    let version = executable_version(&target)
        .filter(|version| version == PINNED_OPENCODE_VERSION)
        .ok_or_else(|| LocalAiDeploymentError::new("local_ai_opencode_install_unverified"))?;
    ensure_user_path(bin_directory)?;
    Ok(version)
}

pub(super) fn install_cc_switch(
    app: &tauri::AppHandle,
    package: CcSwitchPackage,
) -> Result<String, LocalAiDeploymentError> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_cache_failed"))?
        .join("installers");
    let installer = ensure_cc_switch_package(&cache, package)?;
    if !Path::new(MSIEXEC).is_file() {
        return Err(LocalAiDeploymentError::new(
            "local_ai_ccswitch_install_failed",
        ));
    }
    let status = Command::new(MSIEXEC)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "/i",
            installer.to_string_lossy().as_ref(),
            "/qn",
            "/norestart",
            "AUTOLAUNCHAPP=0",
        ])
        .status()
        .map_err(|_| LocalAiDeploymentError::new("local_ai_ccswitch_install_failed"))?;
    if !matches!(status.code(), Some(0 | 1641 | 3010)) {
        return Err(LocalAiDeploymentError::new(
            "local_ai_ccswitch_install_failed",
        ));
    }
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(20) {
        if let Ok(installation) = SystemCcSwitchPlatform.detect_installation() {
            if let Some(version) = installation
                .version
                .filter(|value| supports_version_for_deployment(value))
            {
                return Ok(version);
            }
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(LocalAiDeploymentError::new(
        "local_ai_ccswitch_install_unverified",
    ))
}

fn open_code_target(app: &tauri::AppHandle) -> Result<PathBuf, LocalAiDeploymentError> {
    Ok(app
        .path()
        .local_data_dir()
        .map_err(|_| LocalAiDeploymentError::new("local_ai_opencode_install_failed"))?
        .join("Programs")
        .join("YUME")
        .join("bin")
        .join("opencode.exe"))
}

fn bundled_open_code(app: &tauri::AppHandle) -> Result<PathBuf, LocalAiDeploymentError> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|_| LocalAiDeploymentError::new("local_ai_opencode_resource_missing"))?;
    [
        root.join("resources").join("opencode").join("opencode.exe"),
        root.join("opencode").join("opencode.exe"),
    ]
    .into_iter()
    .find(|candidate| regular_file(candidate))
    .ok_or_else(|| LocalAiDeploymentError::new("local_ai_opencode_resource_missing"))
}

fn regular_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    use std::os::windows::fs::MetadataExt as _;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.is_file()
        && !metadata.file_type().is_symlink()
        && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
}

fn plain_directory(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    use std::os::windows::fs::MetadataExt as _;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.is_dir()
        && !metadata.file_type().is_symlink()
        && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), LocalAiDeploymentError> {
    use std::os::windows::ffi::OsStrExt as _;

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(LocalAiDeploymentError::new(
            "local_ai_opencode_install_failed",
        ))
    } else {
        Ok(())
    }
}

fn executable_version(path: &Path) -> Option<String> {
    if !regular_file(path) {
        return None;
    }
    let output = Command::new(path)
        .creation_flags(CREATE_NO_WINDOW)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    stdout
        .split_whitespace()
        .find(|part| *part == PINNED_OPENCODE_VERSION)
        .map(str::to_owned)
}

fn ensure_user_path(bin_directory: &Path) -> Result<(), LocalAiDeploymentError> {
    if !Path::new(POWERSHELL).is_file() {
        return Err(LocalAiDeploymentError::new("local_ai_path_update_failed"));
    }
    let read = Command::new(POWERSHELL)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Environment]::GetEnvironmentVariable('Path', 'User')",
        ])
        .output()
        .map_err(|_| LocalAiDeploymentError::new("local_ai_path_update_failed"))?;
    if !read.status.success() {
        return Err(LocalAiDeploymentError::new("local_ai_path_update_failed"));
    }
    let current = String::from_utf8(read.stdout)
        .map_err(|_| LocalAiDeploymentError::new("local_ai_path_update_failed"))?
        .trim_end_matches(['\r', '\n'])
        .to_owned();
    let bin = bin_directory.to_string_lossy();
    let merged = merge_user_path(&current, &bin);
    if merged.len() > 30_000 || merged.chars().any(|character| character == '\0') {
        return Err(LocalAiDeploymentError::new("local_ai_path_update_failed"));
    }
    if merged != current {
        let write = Command::new(POWERSHELL)
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('YUME_OPENCODE_USER_PATH', 'Process'), 'User')",
            ])
            .env("YUME_OPENCODE_USER_PATH", &merged)
            .status()
            .map_err(|_| LocalAiDeploymentError::new("local_ai_path_update_failed"))?;
        if !write.success() {
            return Err(LocalAiDeploymentError::new("local_ai_path_update_failed"));
        }
    }
    let process_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", merge_user_path(&process_path, &bin));
    Ok(())
}
