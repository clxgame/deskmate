use crate::chat_attachments::{
    DiscardChatAttachmentRequest, ReadChatAttachmentRequest, StageChatAttachmentRequest,
};

use super::{stage_request, AttachmentStore, TempAttachmentRoot};

#[test]
fn ipc_stage_contract_uses_frontend_field_names_and_opaque_metadata() {
    // Given: the exact camelCase payload emitted by the frontend boundary.
    let request = serde_json::from_value::<StageChatAttachmentRequest>(serde_json::json!({
        "sessionId": "session-a",
        "fileName": "notes.txt",
        "mime": "text/plain",
        "size": 4,
        "bytes": [110, 111, 116, 101]
    }))
    .expect("deserialize frontend stage request");
    let root = TempAttachmentRoot::new("ipc-stage");
    let store = AttachmentStore::default();

    // When: native staging returns its public IPC metadata.
    let staged = store.stage(root.path(), request).expect("stage attachment");
    let serialized = serde_json::to_value(staged).expect("serialize staged response");

    // Then: the response matches the frontend contract and contains no path.
    assert_eq!(serialized["sessionId"], "session-a");
    assert_eq!(serialized["fileName"], "notes.txt");
    assert_eq!(serialized["kind"], "text");
    assert_eq!(serialized["status"], "staged");
    assert!(serialized.get("path").is_none());
    assert!(serialized.get("source").is_none());
}

#[test]
fn ipc_read_and_discard_contracts_use_attachment_id_and_typed_receipts() {
    // Given: a staged attachment and the exact frontend id request shape.
    let root = TempAttachmentRoot::new("ipc-read-discard");
    let store = AttachmentStore::default();
    let staged = store
        .stage(
            root.path(),
            stage_request("session-a", "notes.txt", "text/plain", b"note".to_vec()),
        )
        .expect("stage attachment");
    let request_value = serde_json::json!({
        "sessionId": "session-a",
        "attachmentId": staged.id
    });

    // When: native read and discard consume that typed request.
    let read_request = serde_json::from_value::<ReadChatAttachmentRequest>(request_value.clone())
        .expect("deserialize frontend read request");
    let read = store.read(read_request).expect("read attachment");
    let read_value = serde_json::to_value(read).expect("serialize ready response");
    let discard_request = serde_json::from_value::<DiscardChatAttachmentRequest>(request_value)
        .expect("deserialize frontend discard request");
    let receipt = store.discard(discard_request).expect("discard attachment");

    // Then: ready data is a data URL and discard returns a typed receipt.
    assert_eq!(read_value["sessionId"], "session-a");
    assert_eq!(read_value["fileName"], "notes.txt");
    assert_eq!(read_value["kind"], "text");
    assert_eq!(read_value["status"], "ready");
    assert_eq!(read_value["dataUrl"], "data:text/plain;base64,bm90ZQ==");
    assert!(read_value.get("bytes").is_none());
    assert_eq!(
        serde_json::to_value(receipt).expect("serialize discard receipt"),
        serde_json::json!({ "discarded": true })
    );
}
