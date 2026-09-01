use super::*;
use crate::chat_attachments::AttachmentStore;

#[test]
fn export_denies_unknown_wrong_session_and_unready_sources() {
    // Given: one staged source and one ready artifact belong to session-a.
    let cache = TempRoot::new("denial-cache");
    let downloads = TempRoot::new("denial-downloads");
    let store = AttachmentStore::default();
    let source = store
        .stage(
            cache.path(),
            stage_request("session-a", "notes.txt", "text/plain", b"notes".to_vec()),
        )
        .expect("stage source only");
    let artifact = insert_artifact(&store, cache.path(), "session-a", "Decoded Song.mp3", "mp3");

    // When/Then: only a ready artifact in the same session can export.
    assert!(store
        .export_artifact(downloads.path(), export_request("session-b", &artifact.id))
        .expect_err("wrong session denied")
        .to_string()
        .contains("session"));
    assert!(store
        .export_artifact(
            downloads.path(),
            export_request("session-a", &uuid::Uuid::new_v4().to_string()),
        )
        .expect_err("unknown artifact denied")
        .to_string()
        .contains("unknown"));
    assert!(store
        .export_artifact(downloads.path(), export_request("session-a", &source.id))
        .expect_err("source-only export denied")
        .to_string()
        .contains("ready"));
}

#[test]
fn missing_download_root_retains_cached_artifact_and_writes_nowhere_else() {
    // Given: an artifact is cached but the injected Downloads directory does not exist.
    let cache = TempRoot::new("missing-download-cache");
    let downloads = TempRoot::new("missing-downloads");
    let missing_downloads = downloads.path().join("missing");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", "Decoded Song.mp3", "mp3");

    // When: export cannot resolve a real Downloads directory.
    let error = store
        .export_artifact(
            &missing_downloads,
            export_request("session-a", &artifact.id),
        )
        .expect_err("missing Downloads root fails");

    // Then: the cached artifact is still readable and no fallback directory is created.
    assert!(error.to_string().contains("Downloads"));
    assert!(store
        .read(crate::chat_attachments::types::ReadChatAttachmentRequest {
            session_id: "session-a".to_string(),
            attachment_id: artifact.id.clone(),
        })
        .is_ok());
    assert!(!missing_downloads.exists());
}

#[test]
fn create_new_permission_denied_retains_artifact_and_writes_no_download() {
    // Given: Downloads exists, but reserving any destination file fails deterministically.
    let cache = TempRoot::new("permission-cache");
    let downloads = TempRoot::new("permission-downloads");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", "Decoded Song.mp3", "mp3");

    // When: export reaches create_new and receives PermissionDenied.
    let error = store
        .export_artifact_with_file_system(
            downloads.path(),
            export_request("session-a", &artifact.id),
            &FailingCreateNew,
        )
        .expect_err("permission-denied create_new fails");

    // Then: the error is retryable/user-safe, the artifact remains, and Downloads stays empty.
    assert_eq!(error.to_string(), "could not write attachment to Downloads");
    assert!(store
        .read(crate::chat_attachments::types::ReadChatAttachmentRequest {
            session_id: "session-a".to_string(),
            attachment_id: artifact.id.clone(),
        })
        .is_ok());
    assert_eq!(
        std::fs::read_dir(downloads.path())
            .expect("read downloads")
            .count(),
        0
    );
}

struct FailingCreateNew;

impl crate::chat_attachments::export_io::ExportFileSystem for FailingCreateNew {
    type Writer = Vec<u8>;

    fn create_new(&self, _path: &Path) -> std::io::Result<Self::Writer> {
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "permission denied by test seam",
        ))
    }

    fn remove_file(&self, path: &Path) -> std::io::Result<()> {
        std::fs::remove_file(path)
    }
}
