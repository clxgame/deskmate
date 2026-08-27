use std::path::{Component, Path, PathBuf};
use std::process::Command;

use super::protocol::SecretImportUrl;

const WINDOWS_PROTOCOL_KEY: &str = r"HKEY_CLASSES_ROOT\ccswitch\shell\open\command";
const CC_SWITCH_EXE: &str = "CC-Switch.exe";
const WINDOWS_FILE_PROTOCOL_HANDLER_ARG: &str = "url.dll,FileProtocolHandler";
const WINDOWS_SYSTEM_ROOT: &str = r"C:\Windows";

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
    fn open_import_url(&self, url: &SecretImportUrl) -> Result<(), CcSwitchPlatformError>;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemCcSwitchPlatform;

impl CcSwitchPlatform for SystemCcSwitchPlatform {
    fn detect_installation(&self) -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
        detect_system_installation()
    }

    fn open_import_url(&self, url: &SecretImportUrl) -> Result<(), CcSwitchPlatformError> {
        open_system_url(url)
    }
}

#[cfg(windows)]
fn detect_system_installation() -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
    let registry_query = Path::new(WINDOWS_SYSTEM_ROOT)
        .join("System32")
        .join("reg.exe");
    if !registry_query.is_file() {
        return Err(CcSwitchPlatformError::MissingProtocol);
    }
    let output = Command::new(registry_query)
        .args(["query", WINDOWS_PROTOCOL_KEY, "/ve"])
        .output()
        .map_err(|_| CcSwitchPlatformError::MissingProtocol)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    detect_installation_from_registry_output(
        output.status.success(),
        &stdout,
        read_packaged_version,
    )
}

#[cfg(not(windows))]
fn detect_system_installation() -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
    Err(CcSwitchPlatformError::UnsupportedPlatform {
        platform: std::env::consts::OS.to_string(),
    })
}

#[cfg(windows)]
fn open_system_url(url: &SecretImportUrl) -> Result<(), CcSwitchPlatformError> {
    let opener = trusted_system_url_open_command()?;
    Command::new(&opener.program)
        .args(opener.args_for(url))
        .spawn()
        .map(|_| ())
        .map_err(|_| CcSwitchPlatformError::OpenFailed)
}

#[cfg(not(windows))]
fn open_system_url(_url: &SecretImportUrl) -> Result<(), CcSwitchPlatformError> {
    Err(CcSwitchPlatformError::UnsupportedPlatform {
        platform: std::env::consts::OS.to_string(),
    })
}

fn registry_command_value(stdout: &str) -> Option<&str> {
    stdout
        .lines()
        .find_map(|line| line.split_once("REG_SZ").map(|(_, value)| value.trim()))
        .filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn read_packaged_version(executable: &Path) -> Option<String> {
    if !executable.is_file() {
        return None;
    }
    let package_json = executable
        .parent()?
        .join("resources")
        .join("app")
        .join("package.json");
    let raw = std::fs::read_to_string(package_json).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

fn detect_installation_from_registry_output(
    query_succeeded: bool,
    stdout: &str,
    read_version: impl FnOnce(&Path) -> Option<String>,
) -> Result<CcSwitchInstallation, CcSwitchPlatformError> {
    if !query_succeeded {
        return Err(CcSwitchPlatformError::MissingProtocol);
    }
    let command = registry_command_value(stdout).ok_or(CcSwitchPlatformError::MissingProtocol)?;
    let executable = parse_registered_executable(command)
        .ok_or(CcSwitchPlatformError::MalformedProtocolCommand)?;
    let version =
        read_version(&executable).ok_or(CcSwitchPlatformError::MalformedProtocolCommand)?;
    Ok(CcSwitchInstallation {
        executable,
        version: Some(version),
    })
}

pub(crate) fn parse_registered_executable(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return None;
    }
    let (candidate, arguments) = if let Some(rest) = trimmed.strip_prefix('"') {
        let end = rest.find('"')?;
        (&rest[..end], &rest[end.saturating_add(1)..])
    } else {
        let lower = trimmed.to_ascii_lowercase();
        let end = lower.find(".exe")?.saturating_add(4);
        (&trimmed[..end], &trimmed[end..])
    };
    if !arguments.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    let arguments = arguments.trim();
    if arguments != "%1" && arguments != r#""%1""# {
        return None;
    }
    let path = PathBuf::from(candidate.trim());
    if !path.is_absolute() {
        return None;
    }
    let file_name = path.file_name()?.to_str()?;
    if !file_name.eq_ignore_ascii_case(CC_SWITCH_EXE) {
        return None;
    }
    Some(path)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct UrlOpenCommand {
    pub program: PathBuf,
    pub handler_arg: &'static str,
}

impl UrlOpenCommand {
    pub(crate) fn args_for<'a>(&self, url: &'a SecretImportUrl) -> [&'a str; 2] {
        [self.handler_arg, url.expose_for_platform()]
    }
}

#[cfg(windows)]
fn trusted_system_url_open_command() -> Result<UrlOpenCommand, CcSwitchPlatformError> {
    trusted_system_url_open_command_from_root(Path::new(WINDOWS_SYSTEM_ROOT))
}

pub(crate) fn trusted_system_url_open_command_from_root(
    system_root: &Path,
) -> Result<UrlOpenCommand, CcSwitchPlatformError> {
    let opener = build_url_open_command(system_root)?;
    if opener.program.is_file() {
        Ok(opener)
    } else {
        Err(CcSwitchPlatformError::InvalidSystemOpener)
    }
}

pub(crate) fn build_url_open_command(
    system_root: &Path,
) -> Result<UrlOpenCommand, CcSwitchPlatformError> {
    if !is_safe_absolute_root(system_root)
        || !system_root
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(WINDOWS_SYSTEM_ROOT)
    {
        return Err(CcSwitchPlatformError::InvalidSystemOpener);
    }
    let program = system_root.join("System32").join("rundll32.exe");
    if program
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("rundll32.exe"))
    {
        Ok(UrlOpenCommand {
            program,
            handler_arg: WINDOWS_FILE_PROTOCOL_HANDLER_ARG,
        })
    } else {
        Err(CcSwitchPlatformError::InvalidSystemOpener)
    }
}

fn is_safe_absolute_root(path: &Path) -> bool {
    path.is_absolute()
        && !path
            .as_os_str()
            .to_string_lossy()
            .chars()
            .any(char::is_control)
        && path
            .components()
            .all(|component| !matches!(component, Component::ParentDir))
}

#[cfg(test)]
mod opener_tests;
#[cfg(test)]
mod registry_tests;
