mod config;
mod poll;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

use super::recovery::{
    read_observed_file, FileObservation, ObservedFiles, OpenCodeFile, OpenCodePaths,
};
use config::classify_changed_config;
pub(crate) use poll::poll_with;
pub use poll::{PollClock, PollPolicy, VerificationError};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationTarget {
    pub provider_name: String,
    pub endpoint: String,
    pub model_id: String,
    pub initial: ObservedFiles,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VerificationProblem {
    MalformedConfig,
    AuthChanged,
    ProviderMissing,
    ModelMissing,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalVerification {
    Pending {
        current_hash: Option<String>,
    },
    Verified {
        provider_name: String,
        model_id: String,
        current_hash: String,
    },
    ChangedInvalid {
        reason: VerificationProblem,
        current_hash: Option<String>,
    },
    ReadFailure {
        changed: Option<bool>,
        current_hash: Option<String>,
    },
    Timeout {
        changed: bool,
        current_hash: Option<String>,
    },
}

impl ExternalVerification {
    pub fn current_observation(&self) -> Option<FileObservation> {
        let hash = match self {
            Self::Pending { current_hash }
            | Self::ChangedInvalid { current_hash, .. }
            | Self::ReadFailure { current_hash, .. }
            | Self::Timeout { current_hash, .. } => current_hash.as_deref(),
            Self::Verified { current_hash, .. } => Some(current_hash.as_str()),
        }?;
        Some(FileObservation::Present {
            sha256: hash.to_owned(),
        })
    }
}

pub fn poll_external_change(
    paths: &OpenCodePaths,
    target: &VerificationTarget,
) -> ExternalVerification {
    let mut clock = poll::SystemPollClock::start();
    let mut probe = || verify_once(paths, target);
    poll_with(&mut probe, &mut clock, PollPolicy::production())
}

pub fn verify_once(paths: &OpenCodePaths, target: &VerificationTarget) -> ExternalVerification {
    let config = match read_observed_file(paths, OpenCodeFile::Config) {
        Ok(config) => config,
        Err(_) => {
            return ExternalVerification::ReadFailure {
                changed: None,
                current_hash: None,
            };
        }
    };
    let auth = match read_observed_file(paths, OpenCodeFile::Auth) {
        Ok(auth) => auth,
        Err(_) => {
            return ExternalVerification::ReadFailure {
                changed: Some(config.observation != target.initial.config),
                current_hash: config.observation.hash().map(str::to_owned),
            };
        }
    };
    if auth.observation != target.initial.auth {
        return ExternalVerification::ChangedInvalid {
            reason: VerificationProblem::AuthChanged,
            current_hash: config.observation.hash().map(str::to_owned),
        };
    }
    if config.observation == target.initial.config {
        return ExternalVerification::Pending {
            current_hash: config.observation.hash().map(str::to_owned),
        };
    }
    classify_changed_config(config.observation, config.bytes.as_deref(), target)
}
