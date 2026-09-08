use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorklogError {
    pub code: String,
    pub message: String,
}
pub type WorklogResult<T> = Result<T, WorklogError>;
impl WorklogError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
    pub fn validation(message: &str) -> Self {
        Self::new("VALIDATION_FAILED", message)
    }
    pub fn conflict() -> Self {
        Self::new("CONFLICT", "The record changed; refresh before saving")
    }
    pub fn missing() -> Self {
        Self::new("NOT_FOUND", "Record is unavailable")
    }
}
impl std::fmt::Display for WorklogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for WorklogError {}
impl From<rusqlite::Error> for WorklogError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new(
            "STORAGE_UNAVAILABLE",
            "Work journal database operation failed",
        )
    }
}
impl From<serde_json::Error> for WorklogError {
    fn from(_: serde_json::Error) -> Self {
        Self::new("STORAGE_UNAVAILABLE", "Work journal data is invalid")
    }
}
