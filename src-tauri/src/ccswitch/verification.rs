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

/// Mirrors cc-switch v3.20.1 `import_provider_from_deeplink`, which derives the
/// OpenCode provider key as `<sanitized-name>-<unix-millis>` and writes no `name`.
pub(crate) fn ccswitch_generated_id_prefix(provider_name: &str) -> String {
    provider_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>()
        .to_lowercase()
}

/// Returns the trailing millisecond stamp when `id` matches `<prefix>-<digits>`.
pub(crate) fn generated_id_generation(id: &str, prefix: &str) -> Option<u64> {
    let rest = id.strip_prefix(prefix)?.strip_prefix('-')?;
    if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    rest.parse::<u64>().ok()
}

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
