use super::{discard_request, read_request, stage_request, AttachmentStore, TempAttachmentRoot};

#[test]
fn rejects_empty_data() {
    let root = TempAttachmentRoot::new("empty");
    let store = AttachmentStore::default();

    let error = store
        .stage(
            root.path(),
            stage_request("session-a", "notes.txt", "text/plain", Vec::new()),
        )
        .expect_err("empty data must be rejected");

    assert!(error.to_string().contains("empty"));
}

#[test]
fn rejects_size_mime_and_ncm_metadata_mismatches() {
    // Given: malformed metadata that disagrees with the supplied bytes or file kind.
    let root = TempAttachmentRoot::new("metadata-mismatch");
    let store = AttachmentStore::default();
    let mut wrong_size = stage_request("session-a", "notes.txt", "text/plain", b"x".to_vec());
    wrong_size.size = 2;

    // When: each malformed request crosses the native store boundary.
    let size_error = store
        .stage(root.path(), wrong_size)
        .expect_err("mismatched size must fail");
    let mime_error = store
        .stage(
            root.path(),
            stage_request("session-a", "notes.txt", "text/html", b"x".to_vec()),
        )
        .expect_err("unsupported mime must fail");
    let ncm_error = store
        .stage(
            root.path(),
            stage_request("session-a", "song.ncm", "text/plain", b"x".to_vec()),
        )
        .expect_err("NCM extension and mime must agree");

    // Then: all malformed requests fail before any staged directory is created.
    assert!(size_error.to_string().contains("size"));
    assert!(mime_error.to_string().contains("mime"));
    assert!(ncm_error.to_string().contains("agree"));
    assert_eq!(
        std::fs::read_dir(root.path())
            .expect("read empty staging root")
            .count(),
        0
    );
}

#[test]
fn rejects_separator_control_and_reserved_filenames() {
    let root = TempAttachmentRoot::new("filename");
    let store = AttachmentStore::default();
    let bad_names = [
        "folder/notes.md",
        "folder\\notes.md",
        "..\\CON.ncm",
        "CON.ncm",
        "CON .ncm",
        "COM¹.txt",
        "CLOCK$.txt",
        "trailing.txt.",
        "trailing.txt ",
        "   ",
        "bad\u{0007}.txt",
    ];

    for filename in bad_names {
        let error = store
            .stage(
                root.path(),
                stage_request("session-a", filename, "text/plain", b"x".to_vec()),
            )
            .expect_err("unsafe display filename must be rejected");
        assert!(
            error.to_string().contains("filename"),
            "{filename}: {error}"
        );
    }
}

#[test]
fn rejects_unknown_and_malformed_ids() {
    let store = AttachmentStore::default();

    assert!(store
        .read(read_request(
            "../session-a",
            &uuid::Uuid::new_v4().to_string(),
        ))
        .expect_err("path-like session id should fail")
        .to_string()
        .contains("session"));
    assert!(store
        .read(read_request("   ", &uuid::Uuid::new_v4().to_string()))
        .expect_err("blank session id should fail")
        .to_string()
        .contains("session"));
    assert!(store
        .read(read_request("session-a", &uuid::Uuid::new_v4().to_string(),))
        .expect_err("unknown id should fail")
        .to_string()
        .contains("unknown"));
    assert!(store
        .discard(discard_request("session-a", "not-a-uuid"))
        .expect_err("malformed id should fail")
        .to_string()
        .contains("id"));
}
