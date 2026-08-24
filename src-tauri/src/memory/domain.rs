//! Memory domain types. These mirror `src/lib/memory.ts` exactly.

use serde::{Deserialize, Serialize};

use super::error::{MemoryError, MemoryResult};

/// Maximum stored length of a single memory, in Unicode characters.
pub const MAX_CONTENT_CHARS: usize = 500;
/// Maximum stored length of a relationship summary.
pub const MAX_SUMMARY_CHARS: usize = 400;
/// Maximum stored length of a stable key.
pub const MAX_KEY_CHARS: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryScope {
    /// Shared by every persona: names, stable preferences, boundaries, goals.
    Global,
    /// Visible only to the persona that created it.
    Persona,
}

impl MemoryScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Persona => "persona",
        }
    }

    pub fn parse(value: &str) -> MemoryResult<Self> {
        match value {
            "global" => Ok(Self::Global),
            "persona" => Ok(Self::Persona),
            _ => Err(MemoryError::validation_failed("unknown scope")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryType {
    /// How the user wants to be addressed, and comparable stable identity.
    Identity,
    Preference,
    /// An explicit limit the companion must respect.
    Boundary,
    Routine,
    Goal,
    /// A dated thing that happened or will happen.
    Event,
    /// A moment shared with one persona.
    SharedMoment,
    /// Transient feeling: working context with a short TTL.
    Mood,
}

impl MemoryType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Identity => "identity",
            Self::Preference => "preference",
            Self::Boundary => "boundary",
            Self::Routine => "routine",
            Self::Goal => "goal",
            Self::Event => "event",
            Self::SharedMoment => "shared_moment",
            Self::Mood => "mood",
        }
    }

    pub fn parse(value: &str) -> MemoryResult<Self> {
        match value {
            "identity" => Ok(Self::Identity),
            "preference" => Ok(Self::Preference),
            "boundary" => Ok(Self::Boundary),
            "routine" => Ok(Self::Routine),
            "goal" => Ok(Self::Goal),
            "event" => Ok(Self::Event),
            "shared_moment" => Ok(Self::SharedMoment),
            "mood" => Ok(Self::Mood),
            _ => Err(MemoryError::validation_failed("unknown memory type")),
        }
    }

    /// `shared_moment` is inherently persona-bound; everything else may be
    /// global.
    pub fn requires_persona_scope(self) -> bool {
        matches!(self, Self::SharedMoment)
    }

    /// Types whose stable key replaces the previous value instead of appending.
    pub fn is_stable_fact(self) -> bool {
        matches!(
            self,
            Self::Identity | Self::Preference | Self::Boundary | Self::Routine
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryStatus {
    Active,
    /// Replaced by a newer value; kept so the user can see what changed.
    Superseded,
    Expired,
}

impl MemoryStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Superseded => "superseded",
            Self::Expired => "expired",
        }
    }

    pub fn parse(value: &str) -> MemoryResult<Self> {
        match value {
            "active" => Ok(Self::Active),
            "superseded" => Ok(Self::Superseded),
            "expired" => Ok(Self::Expired),
            _ => Err(MemoryError::validation_failed("unknown status")),
        }
    }
}

/// Privacy class. `Secret` exists only to be rejected: it is never a stored
/// value, which is why the SQLite CHECK constraint allows only the other two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sensitivity {
    Normal,
    /// Health, finance, identity numbers, address, intimate relationships,
    /// confidential work. Storable only after explicit user confirmation.
    Sensitive,
    /// Credentials. Rejected, never persisted, never sent to a model.
    Secret,
}

impl Sensitivity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Sensitive => "sensitive",
            Self::Secret => "secret",
        }
    }

    pub fn parse(value: &str) -> MemoryResult<Self> {
        match value {
            "normal" => Ok(Self::Normal),
            "sensitive" => Ok(Self::Sensitive),
            "secret" => Ok(Self::Secret),
            _ => Err(MemoryError::validation_failed("unknown sensitivity")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    /// The user asked for this in so many words.
    Explicit,
    /// Proposed by the extractor and accepted under policy.
    Extracted,
    Onboarding,
    FollowUp,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::Extracted => "extracted",
            Self::Onboarding => "onboarding",
            Self::FollowUp => "follow_up",
        }
    }

    pub fn parse(value: &str) -> MemoryResult<Self> {
        match value {
            "explicit" => Ok(Self::Explicit),
            "extracted" => Ok(Self::Extracted),
            "onboarding" => Ok(Self::Onboarding),
            "follow_up" => Ok(Self::FollowUp),
            _ => Err(MemoryError::validation_failed("unknown source kind")),
        }
    }
}

/// A stored memory as returned to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub scope: MemoryScope,
    pub persona_id: Option<String>,
    #[serde(rename = "type")]
    pub memory_type: MemoryType,
    pub memory_key: Option<String>,
    pub content: String,
    pub status: MemoryStatus,
    pub confidence: f64,
    pub importance: i64,
    pub sensitivity: Sensitivity,
    pub source_kind: SourceKind,
    pub valid_from: String,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
    pub supersedes_id: Option<String>,
}

/// Where a memory came from. Holds identifiers, never the original text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySource {
    pub conversation_id: Option<String>,
    pub message_id: Option<String>,
    pub source_kind: SourceKind,
    pub created_at: String,
}

/// A create request from the frontend. `sensitivity` is a *proposal*: policy
/// re-derives the real class and may reject the write.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMemory {
    pub scope: MemoryScope,
    pub persona_id: Option<String>,
    #[serde(rename = "type")]
    pub memory_type: MemoryType,
    pub memory_key: Option<String>,
    pub content: String,
    #[serde(default)]
    pub importance: Option<i64>,
    #[serde(default)]
    pub expires_at: Option<String>,
    pub source_kind: SourceKind,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
    /// Set by the UI only after the user saw and accepted the sensitive-storage
    /// disclosure.
    #[serde(default)]
    pub sensitive_confirmed: bool,
}

/// An edit request. `expected_revision` makes concurrent window edits safe.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUpdate {
    pub id: String,
    pub content: String,
    pub expected_revision: i64,
    #[serde(default)]
    pub importance: Option<i64>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub sensitive_confirmed: bool,
}

/// Query filters for the Memory Center and for retrieval.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryQuery {
    #[serde(default)]
    pub persona_id: Option<String>,
    #[serde(default)]
    pub scope: Option<MemoryScope>,
    #[serde(default)]
    pub types: Option<Vec<MemoryType>>,
    #[serde(default)]
    pub statuses: Option<Vec<MemoryStatus>>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// A memory plus its provenance, as shown in the Memory Center.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    #[serde(flatten)]
    pub memory: Memory,
    pub sources: Vec<MemorySource>,
    pub linked_task_ids: Vec<String>,
}

/// Bounded, per-persona relationship state. No score is shown to the user.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipState {
    pub persona_id: String,
    pub familiarity: i64,
    pub summary: String,
    pub revision: i64,
    pub updated_at: String,
}

/// What changed, for the `deskmate://memory-changed` event. Carries no content.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryChange {
    pub version: u32,
    pub action: MemoryAction,
    pub memory_id: Option<String>,
    pub scope: Option<MemoryScope>,
    pub persona_id: Option<String>,
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryAction {
    Created,
    Updated,
    Superseded,
    Forgotten,
    Cleared,
    RelationshipUpdated,
}

/// Event payload version. Bump when the shape changes so old listeners can
/// ignore payloads they do not understand.
pub const MEMORY_CHANGE_VERSION: u32 = 1;

impl MemoryChange {
    pub fn new(action: MemoryAction) -> Self {
        Self {
            version: MEMORY_CHANGE_VERSION,
            action,
            memory_id: None,
            scope: None,
            persona_id: None,
            revision: None,
        }
    }

    pub fn for_memory(action: MemoryAction, memory: &Memory) -> Self {
        Self {
            version: MEMORY_CHANGE_VERSION,
            action,
            memory_id: Some(memory.id.clone()),
            scope: Some(memory.scope),
            persona_id: memory.persona_id.clone(),
            revision: Some(memory.revision),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_enum_round_trips_through_its_wire_string() {
        for scope in [MemoryScope::Global, MemoryScope::Persona] {
            assert_eq!(MemoryScope::parse(scope.as_str()).expect("scope"), scope);
        }
        for memory_type in [
            MemoryType::Identity,
            MemoryType::Preference,
            MemoryType::Boundary,
            MemoryType::Routine,
            MemoryType::Goal,
            MemoryType::Event,
            MemoryType::SharedMoment,
            MemoryType::Mood,
        ] {
            assert_eq!(
                MemoryType::parse(memory_type.as_str()).expect("type"),
                memory_type
            );
        }
        for status in [
            MemoryStatus::Active,
            MemoryStatus::Superseded,
            MemoryStatus::Expired,
        ] {
            assert_eq!(MemoryStatus::parse(status.as_str()).expect("status"), status);
        }
        for sensitivity in [
            Sensitivity::Normal,
            Sensitivity::Sensitive,
            Sensitivity::Secret,
        ] {
            assert_eq!(
                Sensitivity::parse(sensitivity.as_str()).expect("sensitivity"),
                sensitivity
            );
        }
        for source in [
            SourceKind::Explicit,
            SourceKind::Extracted,
            SourceKind::Onboarding,
            SourceKind::FollowUp,
        ] {
            assert_eq!(SourceKind::parse(source.as_str()).expect("source"), source);
        }
    }

    #[test]
    fn rejects_unknown_enum_values_instead_of_defaulting() {
        assert!(MemoryScope::parse("everyone").is_err());
        assert!(MemoryType::parse("diagnosis").is_err());
        assert!(MemoryStatus::parse("deleted").is_err());
        assert!(Sensitivity::parse("public").is_err());
        assert!(SourceKind::parse("model").is_err());
    }

    #[test]
    fn change_events_carry_ids_but_never_content() {
        let memory = Memory {
            id: "m1".into(),
            scope: MemoryScope::Persona,
            persona_id: Some("aimisi".into()),
            memory_type: MemoryType::SharedMoment,
            memory_key: None,
            content: "一起看了流星雨".into(),
            status: MemoryStatus::Active,
            confidence: 0.9,
            importance: 3,
            sensitivity: Sensitivity::Normal,
            source_kind: SourceKind::Explicit,
            valid_from: "2026-01-01T00:00:00Z".into(),
            expires_at: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            revision: 1,
            supersedes_id: None,
        };
        let json = serde_json::to_string(&MemoryChange::for_memory(MemoryAction::Created, &memory))
            .expect("serialize");
        assert!(json.contains("\"memoryId\":\"m1\""), "{json}");
        assert!(json.contains("\"personaId\":\"aimisi\""), "{json}");
        assert!(!json.contains("流星雨"), "event leaked memory content: {json}");
    }

    #[test]
    fn shared_moments_are_persona_bound_and_stable_facts_are_marked() {
        assert!(MemoryType::SharedMoment.requires_persona_scope());
        assert!(!MemoryType::Goal.requires_persona_scope());
        assert!(MemoryType::Identity.is_stable_fact());
        assert!(!MemoryType::Event.is_stable_fact());
    }
}
