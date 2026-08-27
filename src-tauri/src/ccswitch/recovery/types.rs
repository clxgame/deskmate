use std::fmt;
use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileObservation {
    Missing,
    Present { sha256: String },
}

impl FileObservation {
    pub fn hash(&self) -> Option<&str> {
        match self {
            Self::Missing => None,
            Self::Present { sha256 } => Some(sha256),
        }
    }

    pub(crate) fn is_valid(&self) -> bool {
        match self {
            Self::Missing => true,
            Self::Present { sha256 } => {
                sha256.len() == 64 && sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            }
        }
    }

    pub(crate) fn aad_token(&self) -> &str {
        match self {
            Self::Missing => "missing",
            Self::Present { sha256 } => sha256,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ObservedFiles {
    pub config: FileObservation,
    pub auth: FileObservation,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SnapshotId(String);

impl SnapshotId {
    pub(crate) fn generate() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }

    pub fn parse(value: &str) -> Result<Self, RecoveryError> {
        let parsed = uuid::Uuid::parse_str(value).map_err(|_| RecoveryError::InvalidSnapshot)?;
        Ok(Self(parsed.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotHandle {
    pub id: SnapshotId,
    pub original: ObservedFiles,
}

pub struct RecoveryLocations {
    pub(crate) home: PathBuf,
    pub(crate) app_data: PathBuf,
}

impl RecoveryLocations {
    pub fn new(home: PathBuf, app_data: PathBuf) -> Self {
        Self { home, app_data }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecoveryCompletion {
    Verified,
    Cancelled(Option<ObservedFiles>),
    TimedOut(Option<ObservedFiles>),
    ReadFailed(Option<ObservedFiles>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryRetention {
    Destroyed,
    Retained,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiscardConfirmation {
    Unconfirmed,
    Confirmed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecoveryError {
    PathRejected,
    ReadFailed,
    WriteFailed,
    InvalidSnapshot,
    SnapshotMissing,
    KeyUnavailable,
    KeyStoreFailed,
    AuthenticationFailed,
    ConfirmationRequired,
    StaleConflict { current_hash: Option<String> },
}

impl fmt::Display for RecoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::PathRejected => "recovery path rejected",
            Self::ReadFailed => "recovery read failed",
            Self::WriteFailed => "recovery write failed",
            Self::InvalidSnapshot => "recovery snapshot invalid",
            Self::SnapshotMissing => "recovery snapshot missing",
            Self::KeyUnavailable => "recovery key unavailable",
            Self::KeyStoreFailed => "credential storage failed",
            Self::AuthenticationFailed => "recovery authentication failed",
            Self::ConfirmationRequired => "explicit confirmation required",
            Self::StaleConflict { .. } => "recovery refused because external state changed",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for RecoveryError {}
