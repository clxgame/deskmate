use super::*;
use crate::history::catalog_model::{
    Availability, CatalogEntry, CatalogIdentity, ConversationSource, DeletionTombstone, Ownership,
    RuntimeState,
};
use crate::memory::domain::{MemoryType, SourceKind};

fn repository() -> MemoryRepository<SystemClock> {
    let repository = MemoryRepository::new(MemoryStore::open_in_memory().expect("store"), SystemClock);
    repository.create(&NewMemory {
        scope: MemoryScope::Global,
        persona_id: None,
        memory_type: MemoryType::Event,
        memory_key: None,
        content: "Synthetic appointment tomorrow".into(),
        importance: None,
        expires_at: None,
        source_kind: SourceKind::Explicit,
        conversation_id: Some("ses_shared".into()),
        message_id: Some("msg_test".into()),
        sensitive_confirmed: false,
    }).expect("memory");
    repository
}

fn entry(identity: CatalogIdentity) -> CatalogEntry {
    CatalogEntry {
        identity, title: "Synthetic".into(), user_title: None,
        source: ConversationSource::LightChat, created: 1, updated: 1,
        pinned: false, archived: false, availability: Availability::Available,
        ownership: Ownership::Unowned, runtime: RuntimeState::Idle,
        tombstone: Some(DeletionTombstone { requested_at: 2, remote_deleted: true }),
    }
}

fn native(directory: &str) -> CatalogEntry {
    entry(CatalogIdentity::Native {
        sidecar_id: "local".into(), directory: directory.into(), session_id: "ses_shared".into(),
    })
}

#[test]
fn cross_directory_collision_preserves_memory_including_deleted_rows() {
    // Given two identities sharing the legacy bare source ID, including tombstones.
    let repository = repository();
    let entries = [native("C:/one"), native("C:/two")];
    // When the command seam tries to clean one identity's memories.
    let result = forget_catalog_conversation(&repository, &entries, "ses_shared", &entries[0].key());
    // Then ambiguous source links are retained.
    assert_eq!(result.expect_err("ambiguous").message(), "memory_conversation_identity_ambiguous");
    assert_eq!(repository.list(&MemoryQuery::default()).expect("list").len(), 1);
}

#[test]
fn unique_deleted_native_identity_removes_sole_source_memory() {
    // Given one tombstoned native identity and a real SQLite memory source.
    let repository = repository();
    let entries = [native("C:/one")];
    // When deletion cleanup resolves the catalog key.
    let result = forget_catalog_conversation(&repository, &entries, "ses_shared", &entries[0].key());
    // Then the existing repository cleanup removes the memory.
    assert_eq!(result.expect("cleanup"), 1);
    assert!(repository.list(&MemoryQuery::default()).expect("list").is_empty());
}

#[test]
fn mismatched_catalog_key_preserves_memory() {
    // Given a catalog identity that does not match the supplied bare ID.
    let repository = repository();
    let entries = [entry(CatalogIdentity::Legacy { history_id: "different".into() })];
    // When a caller supplies that unrelated key.
    let result = forget_catalog_conversation(&repository, &entries, "ses_shared", &entries[0].key());
    // Then memory deletion is rejected before mutation.
    assert_eq!(result.expect_err("mismatch").message(), "memory_conversation_identity_invalid");
    assert_eq!(repository.list(&MemoryQuery::default()).expect("list").len(), 1);
}

#[test]
fn unique_legacy_identity_uses_existing_memory_cleanup() {
    // Given one legacy identity with the matching memory source ID.
    let repository = repository();
    let entries = [entry(CatalogIdentity::Legacy { history_id: "ses_shared".into() })];
    // When the organizer cleans its source memories.
    let result = forget_catalog_conversation(&repository, &entries, "ses_shared", &entries[0].key());
    // Then cleanup still works for legacy conversations.
    assert_eq!(result.expect("cleanup"), 1);
}
