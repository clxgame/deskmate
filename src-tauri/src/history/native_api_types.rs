use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct NativeSession {
    pub id: String,
    pub title: String,
    pub directory: String,
    #[serde(rename = "parentID")]
    pub parent_id: Option<String>,
    pub time: NativeSessionTime,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct NativeSessionTime {
    pub created: u64,
    pub updated: u64,
    pub archived: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum NativeStatus {
    Idle,
    Busy,
    Retry {
        attempt: u64,
        message: String,
        next: u64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeApiError {
    Forbidden,
    InvalidRequest,
    ScopeMismatch,
    Unauthorized,
    Missing,
    Timeout,
    Unavailable,
    InvalidResponse,
    Incomplete,
    #[cfg(test)]
    UnsupportedRestore,
    Http(u16),
}

impl std::fmt::Display for NativeApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let code = match self {
            Self::Forbidden => "history_forbidden",
            Self::InvalidRequest => "history_native_invalid_request",
            Self::ScopeMismatch => "history_native_scope_mismatch",
            Self::Unauthorized => "history_native_unauthorized",
            Self::Missing => "history_native_missing",
            Self::Timeout => "history_native_timeout",
            Self::Unavailable => "history_native_unavailable",
            Self::InvalidResponse => "history_native_invalid_response",
            Self::Incomplete => "history_native_listing_incomplete",
            #[cfg(test)]
            Self::UnsupportedRestore => "history_native_restore_unsupported",
            Self::Http(status) => return write!(f, "history_native_http_{status}"),
        };
        f.write_str(code)
    }
}

impl std::error::Error for NativeApiError {}

