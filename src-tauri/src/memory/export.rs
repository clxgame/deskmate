//! Export: everything the user has, in one inspectable JSON document.
//!
//! Exports carry no secret (none is ever stored), no deleted content, no audit
//! metadata, and no raw chat transcript — only memories, provenance ids,
//! relationship state, and task links.

use serde::Serialize;

use super::domain::{MemoryQuery, MemoryRecord, MemoryStatus, RelationshipState};
#[cfg(test)]
use super::error::MemoryError;
use super::error::MemoryResult;
use super::repository::{Clock, MemoryRepository};

/// Bumped when the export shape changes so an importer can tell versions apart.
pub const EXPORT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryExport {
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at: String,
    pub memories: Vec<MemoryRecord>,
    pub relationships: Vec<RelationshipState>,
}

/// Build the export document.
pub fn build<C: Clock>(
    repository: &MemoryRepository<C>,
    app_version: &str,
) -> MemoryResult<MemoryExport> {
    // Superseded and expired rows are part of the user's own history, so the
    // export includes them; hard-deleted content is gone and cannot appear.
    //
    // `export_records` rather than `list`: listings are row-capped for the UI,
    // and a capped export would hand the user a silently incomplete copy of
    // their own data.
    let memories = repository.export_records(&MemoryQuery {
        statuses: Some(vec![
            MemoryStatus::Active,
            MemoryStatus::Superseded,
            MemoryStatus::Expired,
        ]),
        ..MemoryQuery::default()
    })?;
    let relationships = repository.all_relationships()?;
    Ok(MemoryExport {
        schema_version: EXPORT_SCHEMA_VERSION,
        app_version: app_version.to_owned(),
        exported_at: repository.clock().now(),
        memories,
        relationships,
    })
}

/// Serialize the export to pretty JSON.
///
/// The Tauri command returns the struct and lets the frontend stringify it, so
/// this is the test-side view of the same bytes.
#[cfg(test)]
pub fn to_json(export: &MemoryExport) -> MemoryResult<String> {
    serde_json::to_string_pretty(export)
        .map_err(|error| MemoryError::export_failed(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::super::domain::{MemoryScope, MemoryType, NewMemory, SourceKind};
    use super::super::repository::SystemClock;
    use super::super::storage::MemoryStore;
    use super::*;

    fn repo() -> MemoryRepository<SystemClock> {
        MemoryRepository::new(MemoryStore::open_in_memory().expect("store"), SystemClock)
    }

    fn request(content: &str, key: Option<&str>) -> NewMemory {
        NewMemory {
            scope: MemoryScope::Global,
            persona_id: None,
            memory_type: MemoryType::Preference,
            memory_key: key.map(str::to_owned),
            content: content.into(),
            importance: None,
            expires_at: None,
            source_kind: SourceKind::Explicit,
            conversation_id: Some("ses_1".into()),
            message_id: Some("msg_1".into()),
            sensitive_confirmed: false,
        }
    }

    #[test]
    fn exports_history_provenance_and_relationships() {
        let repo = repo();
        repo.create(&request("不喜欢甜食", Some("food.sweets")))
            .expect("first");
        repo.create(&request("现在可以吃一点甜的", Some("food.sweets")))
            .expect("second");
        repo.relationship("aimisi").expect("relationship");

        let export = build(&repo, "0.1.5").expect("export");
        assert_eq!(export.schema_version, EXPORT_SCHEMA_VERSION);
        assert_eq!(export.app_version, "0.1.5");
        assert_eq!(export.memories.len(), 2, "superseded history is included");
        assert_eq!(export.relationships.len(), 1);

        let json = to_json(&export).expect("json");
        assert!(json.contains("ses_1"), "provenance id missing");
        assert!(json.contains("不喜欢甜食"));
    }

    #[test]
    fn a_forgotten_memory_is_absent_from_the_export() {
        let repo = repo();
        let kept = repo
            .create(&request("每天七点起床", Some("routine.wake")))
            .expect("kept");
        let forgotten = repo
            .create(&request("不喜欢甜食", Some("food.sweets")))
            .expect("forgotten");
        repo.forget(&forgotten.id).expect("forget");

        let json = to_json(&build(&repo, "0.1.5").expect("export")).expect("json");
        assert!(json.contains(&kept.id));
        assert!(!json.contains(&forgotten.id));
        assert!(
            !json.contains("不喜欢甜食"),
            "export leaked forgotten content"
        );
    }

    #[test]
    fn the_export_contains_no_audit_metadata() {
        let repo = repo();
        repo.create(&request("每天七点起床", Some("routine.wake")))
            .expect("create");
        let json = to_json(&build(&repo, "0.1.5").expect("export")).expect("json");
        assert!(!json.contains("memoryEvents"));
        assert!(!json.contains("\"action\""));
    }

    #[test]
    fn an_export_is_never_silently_truncated() {
        let repo = repo();
        // Comfortably past the Memory Center's per-page ceiling: an export that
        // quietly dropped rows would give the user an incomplete copy of their
        // own data while still looking successful.
        const TOTAL: usize = 620;
        for index in 0..TOTAL {
            repo.create(&request(
                &format!("第 {index} 条偏好"),
                Some(&format!("pref.{index}")),
            ))
            .expect("create");
        }

        let export = build(&repo, "0.1.5").expect("export");
        assert_eq!(
            export.memories.len(),
            TOTAL,
            "export dropped {} of {TOTAL} memories",
            TOTAL - export.memories.len()
        );
    }
}
