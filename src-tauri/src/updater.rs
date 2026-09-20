use std::{
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};

use serde::{Serialize, Serializer};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_updater::{Error as TauriUpdaterError, UpdaterExt};

#[cfg(target_os = "macos")]
mod macos;

static UPDATE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static UPDATE_INSTALLING: AtomicBool = AtomicBool::new(false);
static CANCEL_WAIT: AtomicBool = AtomicBool::new(false);
static UPDATE_STATUS: OnceLock<Mutex<UpdateStatus>> = OnceLock::new();

#[derive(Debug)]
struct UpdateGuard;

impl UpdateGuard {
    fn acquire() -> Result<Self, UpdateError> {
        UPDATE_IN_PROGRESS
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| UpdateError::InProgress)
    }
}

impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATE_IN_PROGRESS.store(false, Ordering::Release);
    }
}

#[cfg(target_os = "macos")]
struct InstallGate;

#[cfg(target_os = "macos")]
impl Drop for InstallGate {
    fn drop(&mut self) {
        UPDATE_INSTALLING.store(false, Ordering::Release);
    }
}

pub(crate) fn installation_in_progress() -> bool {
    UPDATE_INSTALLING.load(Ordering::Acquire)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Repository {
    owner: String,
    name: String,
}

impl Repository {
    fn parse(raw: &str) -> Result<Self, UpdateError> {
        let trimmed = raw.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            return Err(UpdateError::InvalidRepository);
        }
        let slug = match url::Url::parse(trimmed) {
            Ok(parsed) => {
                if parsed.scheme() != "https"
                    || parsed.host_str() != Some("github.com")
                    || !parsed.username().is_empty()
                    || parsed.password().is_some()
                    || parsed.port().is_some()
                    || parsed.query().is_some()
                    || parsed.fragment().is_some()
                {
                    return Err(UpdateError::InvalidRepository);
                }
                parsed.path().trim_matches('/').to_owned()
            }
            Err(_) => trimmed.to_owned(),
        };
        let mut parts = slug.split('/');
        let owner = parts.next().ok_or(UpdateError::InvalidRepository)?;
        let raw_name = parts.next().ok_or(UpdateError::InvalidRepository)?;
        if parts.next().is_some() {
            return Err(UpdateError::InvalidRepository);
        }
        let name = raw_name.strip_suffix(".git").unwrap_or(raw_name);
        if owner.eq_ignore_ascii_case("yourname") {
            return Err(UpdateError::PlaceholderRepository);
        }
        let owner_is_valid = !owner.is_empty()
            && owner.len() <= 39
            && !owner.starts_with('-')
            && !owner.ends_with('-')
            && owner
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
        let name_is_valid = !name.is_empty()
            && name.len() <= 100
            && name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
        if !owner_is_valid || !name_is_valid {
            return Err(UpdateError::InvalidRepository);
        }
        Ok(Self {
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }

    fn endpoint(&self) -> Result<url::Url, UpdateError> {
        #[cfg(feature = "updater-qa")]
        if let Some(endpoint) = option_env!("YUME_UPDATER_QA_ENDPOINT") {
            let parsed = url::Url::parse(endpoint).map_err(|_| UpdateError::InvalidRepository)?;
            let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
            if parsed.scheme() != "http"
                || !loopback
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.fragment().is_some()
            {
                return Err(UpdateError::InvalidRepository);
            }
            return Ok(parsed);
        }
        url::Url::parse(&format!(
            "https://github.com/{}/{}/releases/latest/download/latest.json",
            self.owner, self.name
        ))
        .map_err(|_| UpdateError::InvalidRepository)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum UpdateError {
    InProgress,
    InvalidRepository,
    PlaceholderRepository,
    ManifestNotFound,
    PlatformNotAvailable,
    Network,
    InvalidSignature,
    UnsafeInstall,
    PermissionDenied,
    RestoreFailed,
    Canceled,
    UpdateFailed,
}

impl UpdateError {
    const fn code(&self) -> &'static str {
        match self {
            Self::InProgress => "in_progress",
            Self::InvalidRepository => "invalid_repo",
            Self::PlaceholderRepository => "placeholder",
            Self::ManifestNotFound => "manifest_not_found",
            Self::PlatformNotAvailable => "platform_not_available",
            Self::Network => "network",
            Self::InvalidSignature => "invalid_signature",
            Self::UnsafeInstall => "unsafe_install",
            Self::PermissionDenied => "permission_denied",
            Self::RestoreFailed => "restore_failed",
            Self::Canceled => "canceled",
            Self::UpdateFailed => "update_failed",
        }
    }
}

impl fmt::Display for UpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for UpdateError {}

impl Serialize for UpdateError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.code())
    }
}

impl From<TauriUpdaterError> for UpdateError {
    fn from(error: TauriUpdaterError) -> Self {
        match error {
            TauriUpdaterError::ReleaseNotFound => Self::ManifestNotFound,
            TauriUpdaterError::TargetNotFound(_) | TauriUpdaterError::TargetsNotFound(_) => {
                Self::PlatformNotAvailable
            }
            TauriUpdaterError::Reqwest(_) | TauriUpdaterError::Network(_) => Self::Network,
            TauriUpdaterError::Minisign(_)
            | TauriUpdaterError::Base64(_)
            | TauriUpdaterError::SignatureUtf8(_) => Self::InvalidSignature,
            _ => Self::UpdateFailed,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum UpdateEvent {
    Checking,
    #[serde(rename_all = "camelCase")]
    DownloadStarted {
        version: String,
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    DownloadProgress {
        version: String,
        downloaded: u64,
        content_length: Option<u64>,
    },
    Verifying {
        version: String,
    },
    WaitingForIdle {
        version: String,
    },
    Installing {
        version: String,
    },
    Restarting {
        version: String,
    },
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateStatus {
    #[default]
    Idle,
    Checking,
    #[serde(rename_all = "camelCase")]
    Downloading {
        version: String,
        downloaded: u64,
        content_length: Option<u64>,
    },
    Verifying {
        version: String,
    },
    WaitingForIdle {
        version: String,
    },
    Installing {
        version: String,
    },
    Restarting {
        version: String,
    },
    #[serde(rename_all = "camelCase")]
    UpToDate {
        current_version: String,
    },
    Error {
        code: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateOutcome {
    #[serde(rename_all = "camelCase")]
    UpToDate {
        current_version: String,
    },
    Installed {
        version: String,
    },
}

fn status_cell() -> &'static Mutex<UpdateStatus> {
    UPDATE_STATUS.get_or_init(|| Mutex::new(UpdateStatus::Idle))
}

fn set_status(status: UpdateStatus) {
    if let Ok(mut current) = status_cell().lock() {
        *current = status;
    }
}

fn send_event(channel: &Channel<UpdateEvent>, event: UpdateEvent, status: UpdateStatus) {
    set_status(status);
    if let Err(error) = channel.send(event) {
        eprintln!("updater progress channel closed: {error}");
    }
}

fn require_settings(window: &tauri::WebviewWindow) -> Result<(), UpdateError> {
    (window.label() == "settings")
        .then_some(())
        .ok_or(UpdateError::UpdateFailed)
}

#[tauri::command]
pub fn update_status(window: tauri::WebviewWindow) -> Result<UpdateStatus, UpdateError> {
    require_settings(&window)?;
    status_cell()
        .lock()
        .map(|status| status.clone())
        .map_err(|_| UpdateError::UpdateFailed)
}

#[tauri::command]
pub fn cancel_update(window: tauri::WebviewWindow) -> Result<(), UpdateError> {
    require_settings(&window)?;
    let waiting = status_cell()
        .lock()
        .map(|status| matches!(*status, UpdateStatus::WaitingForIdle { .. }))
        .map_err(|_| UpdateError::UpdateFailed)?;
    if !waiting {
        return Err(UpdateError::UpdateFailed);
    }
    CANCEL_WAIT.store(true, Ordering::Release);
    set_status(UpdateStatus::Error {
        code: UpdateError::Canceled.code().to_owned(),
    });
    Ok(())
}

#[tauri::command]
pub async fn update_app(
    app: AppHandle,
    window: tauri::WebviewWindow,
    repo: String,
    on_event: Channel<UpdateEvent>,
) -> Result<UpdateOutcome, UpdateError> {
    require_settings(&window)?;
    let _guard = UpdateGuard::acquire()?;
    CANCEL_WAIT.store(false, Ordering::Release);
    let repository = Repository::parse(&repo)?;
    send_event(&on_event, UpdateEvent::Checking, UpdateStatus::Checking);
    let result = automatic_update(app, repository, on_event).await;
    if let Err(error) = &result {
        set_status(UpdateStatus::Error {
            code: error.code().to_owned(),
        });
    }
    result
}

async fn automatic_update(
    app: AppHandle,
    repository: Repository,
    on_event: Channel<UpdateEvent>,
) -> Result<UpdateOutcome, UpdateError> {
    let update = app
        .updater_builder()
        .endpoints(vec![repository.endpoint()?])
        .map_err(UpdateError::from)?
        .build()
        .map_err(UpdateError::from)?
        .check()
        .await
        .map_err(|error| {
            eprintln!("update check failed: {error}");
            UpdateError::from(error)
        })?;
    let Some(update) = update else {
        let current_version = app.package_info().version.to_string();
        set_status(UpdateStatus::UpToDate {
            current_version: current_version.clone(),
        });
        return Ok(UpdateOutcome::UpToDate { current_version });
    };

    let version = update.version.clone();
    let progress_version = version.clone();
    let verify_version = version.clone();
    let mut downloaded = 0_u64;
    let mut started = false;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    send_event(
                        &on_event,
                        UpdateEvent::DownloadStarted {
                            version: progress_version.clone(),
                            content_length,
                        },
                        UpdateStatus::Downloading {
                            version: progress_version.clone(),
                            downloaded: 0,
                            content_length,
                        },
                    );
                    started = true;
                }
                downloaded =
                    downloaded.saturating_add(u64::try_from(chunk_length).unwrap_or(u64::MAX));
                send_event(
                    &on_event,
                    UpdateEvent::DownloadProgress {
                        version: progress_version.clone(),
                        downloaded,
                        content_length,
                    },
                    UpdateStatus::Downloading {
                        version: progress_version.clone(),
                        downloaded,
                        content_length,
                    },
                );
            },
            || {
                send_event(
                    &on_event,
                    UpdateEvent::Verifying {
                        version: verify_version.clone(),
                    },
                    UpdateStatus::Verifying {
                        version: verify_version,
                    },
                );
            },
        )
        .await
        .map_err(UpdateError::from)?;

    #[cfg(target_os = "macos")]
    {
        let _install_gate = wait_for_idle(&app, &on_event, &version).await?;
        send_event(
            &on_event,
            UpdateEvent::Installing {
                version: version.clone(),
            },
            UpdateStatus::Installing {
                version: version.clone(),
            },
        );
        let install_app = app.clone();
        let install_version = version.clone();
        tauri::async_runtime::spawn_blocking(move || {
            macos::install_update_archive(&install_app, &bytes, &install_version)
        })
        .await
        .map_err(|_| UpdateError::UpdateFailed)??;
        send_event(
            &on_event,
            UpdateEvent::Restarting {
                version: version.clone(),
            },
            UpdateStatus::Restarting {
                version: version.clone(),
            },
        );
        // The on-disk bundle has already been replaced. Keep new task starts
        // gated until this process actually terminates, even if restart
        // dispatch returns before the event loop exits.
        std::mem::forget(_install_gate);
        app.request_restart();
        return Ok(UpdateOutcome::Installed { version });
    }

    #[cfg(not(target_os = "macos"))]
    {
        send_event(
            &on_event,
            UpdateEvent::Installing {
                version: version.clone(),
            },
            UpdateStatus::Installing {
                version: version.clone(),
            },
        );
        update.install(bytes).map_err(UpdateError::from)?;
        #[cfg(not(windows))]
        {
            send_event(
                &on_event,
                UpdateEvent::Restarting {
                    version: version.clone(),
                },
                UpdateStatus::Restarting {
                    version: version.clone(),
                },
            );
            app.request_restart();
        }
        #[cfg(windows)]
        set_status(UpdateStatus::Restarting {
            version: version.clone(),
        });
        Ok(UpdateOutcome::Installed { version })
    }
}

#[cfg(target_os = "macos")]
async fn wait_for_idle(
    app: &AppHandle,
    on_event: &Channel<UpdateEvent>,
    version: &str,
) -> Result<InstallGate, UpdateError> {
    let wait_app = app.clone();
    let wait_channel = on_event.clone();
    let wait_version = version.to_owned();
    tauri::async_runtime::spawn_blocking(move || loop {
        if CANCEL_WAIT.load(Ordering::Acquire) {
            return Err(UpdateError::Canceled);
        }
        let active = active_work(&wait_app)?;
        if !active {
            UPDATE_INSTALLING.store(true, Ordering::Release);
            let raced = if let Some(state) = wait_app.try_state::<crate::agent::AgentRunState>() {
                let _operation = state
                    .lock_operation()
                    .map_err(|_| UpdateError::UpdateFailed)?;
                state
                    .read()
                    .map(|listing| listing.active.is_some())
                    .map_err(|_| UpdateError::UpdateFailed)?
            } else {
                false
            };
            let worklog_raced = wait_app
                .try_state::<crate::worklog::commands::WorklogState>()
                .map(|state| state.has_running_run())
                .transpose()
                .map_err(|_| UpdateError::UpdateFailed)?
                .unwrap_or(false);
            if !raced && !worklog_raced {
                return Ok(InstallGate);
            }
            UPDATE_INSTALLING.store(false, Ordering::Release);
        }
        send_event(
            &wait_channel,
            UpdateEvent::WaitingForIdle {
                version: wait_version.clone(),
            },
            UpdateStatus::WaitingForIdle {
                version: wait_version.clone(),
            },
        );
        std::thread::sleep(Duration::from_millis(500));
    })
    .await
    .map_err(|_| UpdateError::UpdateFailed)?
}

#[cfg(target_os = "macos")]
fn active_work(app: &AppHandle) -> Result<bool, UpdateError> {
    let agent = app
        .try_state::<crate::agent::AgentRunState>()
        .map(|state| state.read().map(|listing| listing.active.is_some()))
        .transpose()
        .map_err(|_| UpdateError::UpdateFailed)?
        .unwrap_or(false);
    let worklog = app
        .try_state::<crate::worklog::commands::WorklogState>()
        .map(|state| state.has_running_run())
        .transpose()
        .map_err(|_| UpdateError::UpdateFailed)?
        .unwrap_or(false);
    Ok(agent || worklog)
}

pub(crate) fn confirm_installed_update(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = macos::confirm_installed_update(app) {
        eprintln!("could not confirm installed update: {error}");
    }
}

#[cfg(test)]
mod tests;
