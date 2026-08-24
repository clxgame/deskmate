//! Stable, serializable error envelope for every memory command.
//!
//! Codes are part of the frontend contract: `src/lib/memory.ts` mirrors this
//! enum exactly. Messages are diagnostics for developers and MUST NOT contain
//! memory content, candidate text, or any user secret.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MemoryErrorCode {
    /// Memory is switched off, or storage failed to initialize this run.
    MemoryDisabled,
    /// The request violated a domain invariant (scope, length, enum, bounds).
    ValidationFailed,
    /// Sensitive content requires an explicit user confirmation first.
    SensitiveConfirmationRequired,
    /// Credential-like content: rejected outright, never persisted.
    SecretRejected,
    /// The caller's `expected_revision` no longer matches the stored record.
    Conflict,
    NotFound,
    MigrationFailed,
    StorageUnavailable,
    ExportFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryError {
    code: MemoryErrorCode,
    /// Content-free diagnostic detail.
    message: String,
}

impl MemoryError {
    fn new(code: MemoryErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// The stable code, for tests and for callers that branch on the reason.
    /// The wire form the frontend sees comes from `Serialize`.
    #[cfg(test)]
    pub fn code(&self) -> MemoryErrorCode {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn memory_disabled(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::MemoryDisabled, message)
    }

    pub fn validation_failed(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::ValidationFailed, message)
    }

    pub fn sensitive_confirmation_required(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::SensitiveConfirmationRequired, message)
    }

    pub fn secret_rejected(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::SecretRejected, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::Conflict, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::NotFound, message)
    }

    pub fn migration_failed(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::MigrationFailed, message)
    }

    pub fn storage_unavailable(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::StorageUnavailable, message)
    }

    /// Serialization of an export failed. Only the test-side `to_json` path can
    /// reach this: the Tauri command hands the struct to the frontend instead.
    #[cfg(test)]
    pub fn export_failed(message: impl Into<String>) -> Self {
        Self::new(MemoryErrorCode::ExportFailed, message)
    }
}

impl std::fmt::Display for MemoryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for MemoryError {}

pub type MemoryResult<T> = Result<T, MemoryError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_codes_as_screaming_snake_case() {
        let json = serde_json::to_string(&MemoryError::secret_rejected("no detail"))
            .expect("serialize");
        assert!(json.contains("\"code\":\"SECRET_REJECTED\""), "{json}");
        assert!(json.contains("\"message\":\"no detail\""), "{json}");
    }

    #[test]
    fn round_trips_every_code() {
        for code in [
            MemoryErrorCode::MemoryDisabled,
            MemoryErrorCode::ValidationFailed,
            MemoryErrorCode::SensitiveConfirmationRequired,
            MemoryErrorCode::SecretRejected,
            MemoryErrorCode::Conflict,
            MemoryErrorCode::NotFound,
            MemoryErrorCode::MigrationFailed,
            MemoryErrorCode::StorageUnavailable,
            MemoryErrorCode::ExportFailed,
        ] {
            let json = serde_json::to_string(&code).expect("serialize");
            let parsed: MemoryErrorCode = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(parsed, code);
        }
    }
}
