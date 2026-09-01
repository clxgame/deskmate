use sha2::{Digest, Sha256};

use super::*;
use crate::chat_attachments::AttachmentStore;

#[test]
#[ignore]
fn manual_qa_exports_two_files_and_keeps_artifact_after_failed_export() {
    // Given: the QA harness supplies a real writable Downloads-like directory.
    let downloads = std::env::var_os("YUME_TASK6_DOWNLOAD_QA_DIR")
        .map(PathBuf::from)
        .expect("YUME_TASK6_DOWNLOAD_QA_DIR must point at the evidence download root");
    std::fs::create_dir_all(&downloads).expect("create evidence download root");
    let cache = TempRoot::new("manual-cache");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", "Manual QA.mp3", "mp3");

    // When: exporting twice succeeds and exporting to a missing directory fails.
    let first = store
        .export_artifact(&downloads, export_request("session-a", &artifact.id))
        .expect("first manual export");
    let second = store
        .export_artifact(&downloads, export_request("session-a", &artifact.id))
        .expect("second manual export");
    let missing = downloads.join("missing-download-root");
    let failed = store
        .export_artifact(&missing, export_request("session-a", &artifact.id))
        .expect_err("manual missing Downloads export fails");

    // Then: both exported files are byte-identical, and the failed path creates no fallback.
    let first_path = downloads.join(&first.file_name);
    let second_path = downloads.join(&second.file_name);
    let first_bytes = std::fs::read(&first_path).expect("read first manual export");
    let second_bytes = std::fs::read(&second_path).expect("read second manual export");
    assert_eq!(first_bytes, AUDIO_BYTES);
    assert_eq!(second_bytes, AUDIO_BYTES);
    assert!(!missing.exists());
    assert!(store
        .read(crate::chat_attachments::types::ReadChatAttachmentRequest {
            session_id: "session-a".to_string(),
            attachment_id: artifact.id.clone(),
        })
        .is_ok());
    println!(
        "TASK6_MANUAL_EXPORT first={} second={} sha256={} failure={} missing_exists={}",
        first_path.display(),
        second_path.display(),
        format!("{:x}", Sha256::digest(&first_bytes)),
        failed,
        missing.exists()
    );
}
