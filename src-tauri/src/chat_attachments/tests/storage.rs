use serde_json::Value;

use super::{discard_request, read_request, stage_request, AttachmentStore, TempAttachmentRoot};

#[test]
fn stages_to_opaque_uuid_source_and_read_never_serializes_native_paths() {
    let root = TempAttachmentRoot::new("opaque");
    let store = AttachmentStore::default();

    let staged = store
        .stage(
            root.path(),
            stage_request("session-a", "notes.txt", "text/plain", b"# plan".to_vec()),
        )
        .expect("stage attachment");
    let id = uuid::Uuid::parse_str(&staged.id).expect("opaque id should be a UUID");
    let source = root.path().join(id.to_string()).join("source");
    let canonical_root = std::fs::canonicalize(root.path()).expect("canonicalize staging root");
    let canonical_source = std::fs::canonicalize(&source).expect("canonicalize staged source");
    assert!(canonical_source.starts_with(canonical_root));
    assert_eq!(
        std::fs::read(&source).expect("read staged source"),
        b"# plan"
    );
    assert!(!source.to_string_lossy().contains("notes.txt"));

    let read = store
        .read(read_request("session-a", &staged.id))
        .expect("read staged attachment");
    assert_eq!(read.data_url, "data:text/plain;base64,IyBwbGFu");
    let value = serde_json::to_value(&read).expect("serialize read response");
    assert_eq!(
        value.get("fileName"),
        Some(&Value::String("notes.txt".into()))
    );
    assert!(value.get("path").is_none());
    assert!(value.get("source").is_none());
    assert!(!serde_json::to_string(&value)
        .expect("serialize IPC value")
        .contains(&root.path().to_string_lossy().to_string()));
}

#[test]
fn denies_cross_session_reads_and_discards() {
    let root = TempAttachmentRoot::new("session");
    let store = AttachmentStore::default();
    let staged = store
        .stage(
            root.path(),
            stage_request("session-a", "notes.md", "text/plain", b"x".to_vec()),
        )
        .expect("stage attachment");

    assert!(store
        .read(read_request("session-b", &staged.id))
        .expect_err("wrong session")
        .to_string()
        .contains("session"));
    assert!(store
        .discard(discard_request("session-b", &staged.id))
        .expect_err("wrong discard session")
        .to_string()
        .contains("session"));
    assert!(store.read(read_request("session-a", &staged.id)).is_ok());
}

#[test]
fn discard_invalidates_read() {
    let root = TempAttachmentRoot::new("discard");
    let store = AttachmentStore::default();
    let staged = store
        .stage(
            root.path(),
            stage_request("session-a", "notes.md", "text/plain", b"x".to_vec()),
        )
        .expect("stage attachment");

    store
        .discard(discard_request("session-a", &staged.id))
        .expect("discard attachment");

    assert!(store
        .read(read_request("session-a", &staged.id))
        .expect_err("read after discard must fail")
        .to_string()
        .contains("unknown"));
}
