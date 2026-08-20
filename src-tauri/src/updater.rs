use std::fmt;

use serde::{Serialize, Serializer};
use tauri::{ipc::Channel, AppHandle};
use tauri_plugin_updater::{Error as TauriUpdaterError, UpdaterExt};

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
        let name = raw_name
            .strip_suffix(".git")
            .map_or(raw_name, |value| value);

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
        url::Url::parse(&format!(
            "https://github.com/{}/{}/releases/latest/download/latest.json",
            self.owner, self.name
        ))
        .map_err(|_| UpdateError::InvalidRepository)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum UpdateError {
    InvalidRepository,
    PlaceholderRepository,
    ManifestNotFound,
    Network,
    InvalidSignature,
    UpdateFailed,
}

impl UpdateError {
    const fn code(&self) -> &'static str {
        match self {
            Self::InvalidRepository => "invalid_repo",
            Self::PlaceholderRepository => "placeholder",
            Self::ManifestNotFound => "manifest_not_found",
            Self::Network => "network",
            Self::InvalidSignature => "invalid_signature",
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
            TauriUpdaterError::ReleaseNotFound
            | TauriUpdaterError::TargetNotFound(_)
            | TauriUpdaterError::TargetsNotFound(_) => Self::ManifestNotFound,
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
        downloaded: u64,
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Installing {
        version: String,
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

fn send_event(channel: &Channel<UpdateEvent>, event: UpdateEvent) {
    if let Err(error) = channel.send(event) {
        eprintln!("updater progress channel closed: {error}");
    }
}

#[tauri::command]
pub async fn update_app(
    app: AppHandle,
    repo: String,
    on_event: Channel<UpdateEvent>,
) -> Result<UpdateOutcome, UpdateError> {
    let endpoint = Repository::parse(&repo)?.endpoint()?;
    send_event(&on_event, UpdateEvent::Checking);

    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
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
        return Ok(UpdateOutcome::UpToDate {
            current_version: app.package_info().version.to_string(),
        });
    };

    let version = update.version.clone();
    let progress_version = version.clone();
    let installing_version = version.clone();
    let mut downloaded = 0_u64;
    let mut started = false;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    send_event(
                        &on_event,
                        UpdateEvent::DownloadStarted {
                            version: progress_version.clone(),
                            content_length,
                        },
                    );
                    started = true;
                }
                let chunk = u64::try_from(chunk_length).unwrap_or(u64::MAX);
                downloaded = downloaded.saturating_add(chunk);
                send_event(
                    &on_event,
                    UpdateEvent::DownloadProgress {
                        downloaded,
                        content_length,
                    },
                );
            },
            || {
                send_event(
                    &on_event,
                    UpdateEvent::Installing {
                        version: installing_version,
                    },
                );
            },
        )
        .await
        .map_err(|error| {
            eprintln!("update install failed: {error}");
            UpdateError::from(error)
        })?;

    #[cfg(not(windows))]
    app.restart();

    #[cfg(windows)]
    Ok(UpdateOutcome::Installed { version })
}

#[cfg(test)]
mod tests;
