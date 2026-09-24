use serde::{Deserialize, Serialize};

pub(crate) const SIDECAR_ID: &str = "managed-local-v1";

#[path = "catalog_path.rs"]
mod catalog_path;
pub(crate) use catalog_path::canonical_directory;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum CatalogIdentity {
    Native {
        sidecar_id: String,
        directory: String,
        session_id: String,
    },
    Legacy {
        history_id: String,
    },
}

impl CatalogIdentity {
    pub(crate) fn key(&self) -> String {
        match self {
            Self::Native {
                sidecar_id,
                directory,
                session_id,
            } => {
                let directory =
                    canonical_directory(directory).unwrap_or_else(|_| directory.clone());
                format!(
                    "native:{}:{}{}:{}{}:{}",
                    sidecar_id.len(),
                    sidecar_id,
                    directory.len(),
                    directory,
                    session_id.len(),
                    session_id
                )
            }
            Self::Legacy { history_id } => format!("legacy:{history_id}"),
        }
    }

    pub(crate) fn validate(&self) -> Result<(), ExclusionReason> {
        let valid = |value: &str| !value.trim().is_empty() && !value.chars().any(char::is_control);
        let safe_id = |value: &str| {
            !value.is_empty()
                && value.len() <= 256
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        };
        let accepted = match self {
            Self::Native {
                sidecar_id,
                directory,
                session_id,
            } => valid(sidecar_id) && canonical_directory(directory).is_ok() && safe_id(session_id),
            Self::Legacy { history_id } => safe_id(history_id),
        };
        accepted
            .then_some(())
            .ok_or(ExclusionReason::MalformedIdentity)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ConversationSource {
    LightChat,
    Workbench,
    Legacy,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Availability {
    Available,
    Stale,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Ownership {
    Unowned,
    Workbench,
    Agent,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuntimeState {
    Idle,
    Running,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeletionTombstone {
    pub requested_at: u64,
    pub remote_deleted: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogEntry {
    pub identity: CatalogIdentity,
    pub title: String,
    pub user_title: Option<String>,
    pub source: ConversationSource,
    pub created: u64,
    pub updated: u64,
    pub pinned: bool,
    pub archived: bool,
    pub availability: Availability,
    pub ownership: Ownership,
    pub runtime: RuntimeState,
    pub tombstone: Option<DeletionTombstone>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryCapabilities {
    pub open: bool,
    pub open_workbench: bool,
    pub send: bool,
    pub rename: bool,
    pub pin: bool,
    pub archive: bool,
    pub delete: bool,
    pub read_only_reason: Option<&'static str>,
}

impl CatalogEntry {
    pub(crate) fn key(&self) -> String {
        self.identity.key()
    }
    pub(crate) fn display_title(&self) -> &str {
        self.user_title.as_deref().unwrap_or(&self.title)
    }
    pub(crate) fn capabilities(&self) -> HistoryCapabilities {
        if self.tombstone.is_some() {
            return HistoryCapabilities {
                open: false,
                open_workbench: false,
                send: false,
                rename: false,
                pin: false,
                archive: false,
                delete: false,
                read_only_reason: Some("deleted"),
            };
        }
        let native = match self.identity {
            CatalogIdentity::Native { .. } => true,
            CatalogIdentity::Legacy { .. } => false,
        };
        let available = match self.availability {
            Availability::Available => true,
            Availability::Stale | Availability::Unavailable => !native,
        };
        let idle = match self.runtime {
            RuntimeState::Idle => true,
            RuntimeState::Running | RuntimeState::Unknown => false,
        };
        let read_only_reason = if !native {
            Some("legacy_text_only")
        } else if !available {
            Some("native_unavailable")
        } else if self.archived {
            Some("archived")
        } else {
            match self.runtime {
                RuntimeState::Running => Some("active_task"),
                RuntimeState::Unknown => Some("runtime_unknown"),
                RuntimeState::Idle => match self.ownership {
                    Ownership::Unowned => None,
                    Ownership::Workbench => Some("workbench_owned"),
                    Ownership::Agent => Some("agent_owned"),
                },
            }
        };
        HistoryCapabilities {
            open: available,
            open_workbench: native && available,
            send: read_only_reason.is_none(),
            rename: available,
            pin: true,
            archive: true,
            delete: available && idle,
            read_only_reason,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExclusionReason {
    MalformedIdentity,
    ChildSession,
    Deleted,
    UnknownDirectory,
}

pub(crate) struct DiscoveryCandidate<'a> {
    pub identity: &'a CatalogIdentity,
    pub parent_id: Option<&'a str>,
    pub deleted: bool,
}

pub(crate) fn exclusion_reason(
    candidate: &DiscoveryCandidate<'_>,
    known_directories: &[String],
) -> Option<ExclusionReason> {
    if let Err(reason) = candidate.identity.validate() {
        return Some(reason);
    }
    if candidate.deleted {
        return Some(ExclusionReason::Deleted);
    }
    if candidate.parent_id.is_some_and(|parent| !parent.is_empty()) {
        return Some(ExclusionReason::ChildSession);
    }
    match candidate.identity {
        CatalogIdentity::Native { directory, .. } => {
            let candidate_directory = canonical_directory(directory);
            (!known_directories
                .iter()
                .any(|known| canonical_directory(known) == candidate_directory))
            .then_some(ExclusionReason::UnknownDirectory)
        }
        CatalogIdentity::Legacy { .. } => None,
    }
}

#[cfg(test)]
#[path = "catalog_model_tests.rs"]
mod tests;
