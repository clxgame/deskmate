use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::ccswitch::protocol::CcSwitchCommandError;

#[cfg(windows)]
mod download;
mod manifest;
#[cfg(windows)]
mod windows_automation;
#[cfg(windows)]
mod windows_install;

use manifest::{ccswitch_package_for_arch, CcSwitchPackage};

const PROGRESS_EVENT: &str = "deskmate://local-ai-deploy-progress";
static DEPLOYMENT_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DeploymentStep {
    InstallOpenCode,
    InstallCcSwitch,
    ImportProvider,
    VerifyConfiguration,
}

fn deployment_steps(cc_switch_ready: bool, open_code_ready: bool) -> Vec<DeploymentStep> {
    let mut steps = Vec::with_capacity(4);
    if !open_code_ready {
        steps.push(DeploymentStep::InstallOpenCode);
    }
    if !cc_switch_ready {
        steps.push(DeploymentStep::InstallCcSwitch);
    }
    steps.push(DeploymentStep::ImportProvider);
    steps.push(DeploymentStep::VerifyConfiguration);
    steps
}

fn normalized_path_entry(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

fn merge_user_path(current: &str, bin_directory: &str) -> String {
    let wanted = normalized_path_entry(bin_directory);
    if current
        .split(';')
        .any(|entry| normalized_path_entry(entry) == wanted)
    {
        return current.to_owned();
    }
    if current.trim().is_empty() {
        bin_directory.to_owned()
    } else {
        format!("{};{}", current.trim_end_matches(';'), bin_directory)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalAiDeploymentRequest {
    model_id: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum LocalAiDeploymentStage {
    InstallingOpenCode,
    InstallingCcSwitch,
    ImportingProvider,
    VerifyingConfiguration,
    SyncingModelCatalog,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAiDeploymentProgress {
    stage: LocalAiDeploymentStage,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDeploymentReceipt {
    cc_switch_version: String,
    open_code_version: String,
    model_id: String,
    /// Models configured for the imported provider. Falls back to 1 when the
    /// catalog expansion could not run, so the UI never overstates the result.
    model_count: usize,
    /// True while CC Switch still has to re-import before its own database
    /// reflects the expanded model list.
    ccswitch_sync_required: bool,
    /// True when a CC Switch window is live, so the user has to restart it (or
    /// import manually) instead of waiting for the next launch.
    ccswitch_running: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct LocalAiDeploymentError {
    code: &'static str,
}

impl LocalAiDeploymentError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }
}

impl From<CcSwitchCommandError> for LocalAiDeploymentError {
    fn from(error: CcSwitchCommandError) -> Self {
        Self::new(error.code)
    }
}

struct DeploymentGuard;

impl DeploymentGuard {
    fn acquire() -> Result<Self, LocalAiDeploymentError> {
        DEPLOYMENT_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| LocalAiDeploymentError::new("local_ai_deploy_busy"))
    }
}

impl Drop for DeploymentGuard {
    fn drop(&mut self) {
        DEPLOYMENT_ACTIVE.store(false, Ordering::Release);
    }
}

fn emit_progress(app: &tauri::AppHandle, stage: LocalAiDeploymentStage) {
    let _ = app.emit(PROGRESS_EVENT, LocalAiDeploymentProgress { stage });
}

#[tauri::command]
pub async fn deploy_local_ai_stack(
    app: tauri::AppHandle,
    request: LocalAiDeploymentRequest,
) -> Result<LocalAiDeploymentReceipt, LocalAiDeploymentError> {
    let _guard = DeploymentGuard::acquire()?;
    #[cfg(windows)]
    {
        let worker_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || run_windows_deployment(&worker_app, request))
            .await
            .map_err(|_| LocalAiDeploymentError::new("local_ai_deploy_task_failed"))?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, request);
        Err(LocalAiDeploymentError::new(
            "local_ai_deploy_unsupported_platform",
        ))
    }
}

#[cfg(windows)]
fn run_windows_deployment(
    app: &tauri::AppHandle,
    request: LocalAiDeploymentRequest,
) -> Result<LocalAiDeploymentReceipt, LocalAiDeploymentError> {
    use crate::ccswitch::platform::{CcSwitchPlatform, SystemCcSwitchPlatform};
    use crate::ccswitch::protocol::supports_version_for_deployment;
    use crate::ccswitch::protocol::{
        abandon_automatic_deployment, expand_deployed_provider_catalog,
        launch_automatic_deployment, prepare_automatic_deployment, verify_automatic_deployment,
        ModelCatalogSyncOutcome,
    };

    let platform = SystemCcSwitchPlatform;
    let current_cc_switch = platform.detect_installation().ok().filter(|installation| {
        installation
            .version
            .as_deref()
            .is_some_and(supports_version_for_deployment)
    });
    let current_open_code = windows_install::installed_open_code_version(app);
    let steps = deployment_steps(current_cc_switch.is_some(), current_open_code.is_some());
    let mut open_code_version = current_open_code;
    let mut cc_switch_version = current_cc_switch.and_then(|item| item.version);

    for step in steps {
        match step {
            DeploymentStep::InstallOpenCode => {
                emit_progress(app, LocalAiDeploymentStage::InstallingOpenCode);
                open_code_version = Some(windows_install::install_open_code(app)?);
            }
            DeploymentStep::InstallCcSwitch => {
                emit_progress(app, LocalAiDeploymentStage::InstallingCcSwitch);
                let package =
                    ccswitch_package_for_arch(std::env::consts::ARCH).ok_or_else(|| {
                        LocalAiDeploymentError::new("local_ai_deploy_unsupported_arch")
                    })?;
                cc_switch_version = Some(windows_install::install_cc_switch(app, package)?);
            }
            DeploymentStep::ImportProvider => {
                emit_progress(app, LocalAiDeploymentStage::ImportingProvider);
                let prepared = prepare_automatic_deployment(app, &request.model_id)?;
                let installation = platform.detect_installation().map_err(|_| {
                    LocalAiDeploymentError::new("local_ai_ccswitch_install_unverified")
                })?;
                let launched = match launch_automatic_deployment(app, &prepared) {
                    Ok(receipt) => receipt,
                    Err(error) => {
                        abandon_automatic_deployment(app, &prepared);
                        return Err(error.into());
                    }
                };
                if let Err(error) = windows_automation::confirm_cc_switch_import(
                    &installation,
                    &launched.provider_name,
                    &launched.endpoint,
                    &launched.selected_model,
                ) {
                    abandon_automatic_deployment(app, &prepared);
                    return Err(error);
                }
                emit_progress(app, LocalAiDeploymentStage::VerifyingConfiguration);
                verify_automatic_deployment(app, &prepared, &launched)?;
                // cc-switch's deep link can only carry one model, so widen the
                // provider now that the import is verified. A failure here is
                // not fatal: OpenCode, CC Switch and the provider are all
                // genuinely in place, and reporting failure would be a lie.
                emit_progress(app, LocalAiDeploymentStage::SyncingModelCatalog);
                let sync = expand_deployed_provider_catalog(
                    app,
                    &launched.provider_name,
                    &launched.endpoint,
                    &launched.selected_model,
                )
                .unwrap_or_else(|error| {
                    eprintln!("local AI model catalog expansion skipped: {}", error.code);
                    ModelCatalogSyncOutcome {
                        model_count: 1,
                        ccswitch_sync_required: true,
                    }
                });
                return Ok(LocalAiDeploymentReceipt {
                    cc_switch_version: cc_switch_version.ok_or_else(|| {
                        LocalAiDeploymentError::new("local_ai_ccswitch_install_unverified")
                    })?,
                    open_code_version: open_code_version.ok_or_else(|| {
                        LocalAiDeploymentError::new("local_ai_opencode_install_unverified")
                    })?,
                    model_id: launched.selected_model,
                    model_count: sync.model_count,
                    ccswitch_sync_required: sync.ccswitch_sync_required,
                    ccswitch_running: windows_automation::cc_switch_is_running(&installation),
                });
            }
            DeploymentStep::VerifyConfiguration => {}
        }
    }
    // `deployment_steps` always includes `ImportProvider`, whose branch returns on every path.
    unreachable!("ImportProvider must complete the deployment")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_machine_plan_installs_both_clients_before_import_and_verification() {
        assert_eq!(
            deployment_steps(false, false),
            vec![
                DeploymentStep::InstallOpenCode,
                DeploymentStep::InstallCcSwitch,
                DeploymentStep::ImportProvider,
                DeploymentStep::VerifyConfiguration,
            ]
        );
    }

    #[test]
    fn repair_plan_is_idempotent_when_both_clients_are_ready() {
        assert_eq!(
            deployment_steps(true, true),
            vec![
                DeploymentStep::ImportProvider,
                DeploymentStep::VerifyConfiguration,
            ]
        );
    }

    #[test]
    fn user_path_merge_is_case_insensitive_and_idempotent() {
        let bin = r"C:\Users\Test\AppData\Local\Programs\YUME\bin";
        let existing = r"C:\Windows\System32;C:\USERS\TEST\APPDATA\LOCAL\PROGRAMS\YUME\BIN\";
        assert_eq!(merge_user_path(existing, bin), existing);
        assert_eq!(
            merge_user_path(r"C:\Windows\System32", bin),
            format!(r"C:\Windows\System32;{bin}")
        );
    }

    #[test]
    fn official_cc_switch_packages_are_version_and_digest_pinned() {
        let x64 = ccswitch_package_for_arch("x86_64").expect("x64 package");
        assert_eq!(x64.version, "3.20.1");
        assert_eq!(x64.size, 13_553_664);
        assert_eq!(
            x64.sha256,
            "b2a958ccd2bbfd1c44c614d9bebb0dd9f4a55066deed2962511032a487f7ab90"
        );
        assert!(x64.url.starts_with("https://dl.ccswitch.io/v3.20.1/"));

        let arm64 = ccswitch_package_for_arch("aarch64").expect("arm64 package");
        assert_eq!(arm64.version, "3.20.1");
        assert_eq!(arm64.size, 12_836_864);
        assert_eq!(
            arm64.sha256,
            "101a42cd7f554754d68d5a124305d3d71a3b417e69a64ea4d2b6f475e3b271e7"
        );
        assert!(ccswitch_package_for_arch("x86").is_none());
    }
}
