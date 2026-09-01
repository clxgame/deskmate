use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use crate::chat_attachments::types::{CleanupChatSessionRequest, StageChatAttachmentRequest};
use crate::chat_attachments::AttachmentStore;

struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "yume-chat-attachment-cleanup-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp root");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn cleanup_session_removes_only_target_session_cache_records() {
    // Given: two sessions have independently staged attachments.
    let cache = TempRoot::new("session-cache");
    let store = AttachmentStore::default();
    let first = stage_text(&store, cache.path(), "session-a", "a.txt");
    let second = stage_text(&store, cache.path(), "session-b", "b.txt");

    // When: session-a is cleaned.
    let receipt = store
        .cleanup_session(cache.path(), cleanup_request("session-a"))
        .expect("cleanup session-a");

    // Then: only session-a's cache is gone; session-b remains readable.
    assert_eq!(receipt.removed, 1);
    assert!(!cache.path().join(&first.id).exists());
    assert!(cache.path().join(&second.id).exists());
    assert!(store
        .read(crate::chat_attachments::types::ReadChatAttachmentRequest {
            session_id: "session-b".to_string(),
            attachment_id: second.id.clone(),
        })
        .is_ok());
}

#[test]
fn cleanup_missing_directory_is_nonfatal_and_removes_record() {
    // Given: a staged attachment record points at a cache directory that is already gone.
    let cache = TempRoot::new("missing-dir-cache");
    let store = AttachmentStore::default();
    let staged = stage_text(&store, cache.path(), "session-a", "gone.txt");
    std::fs::remove_dir_all(cache.path().join(&staged.id)).expect("remove cache dir first");

    // When: the owning session is cleaned.
    let receipt = store
        .cleanup_session(cache.path(), cleanup_request("session-a"))
        .expect("missing directory cleanup still succeeds");

    // Then: the in-memory record is removed and future reads see an unknown id.
    assert_eq!(receipt.removed, 1);
    assert!(store
        .read(crate::chat_attachments::types::ReadChatAttachmentRequest {
            session_id: "session-a".to_string(),
            attachment_id: staged.id.clone(),
        })
        .expect_err("cleaned record is unavailable")
        .to_string()
        .contains("unknown"));
}

#[test]
fn stale_sweep_removes_exactly_24h_or_older_orphans_and_keeps_newer_dirs() {
    // Given: an orphan cache directory with a known modification time.
    let exact_cache = TempRoot::new("stale-sweep-exact");
    let exact = exact_cache.path().join("exact");
    std::fs::create_dir_all(&exact).expect("create exact stale dir");
    let exact_modified = std::fs::metadata(&exact)
        .expect("stat exact dir")
        .modified()
        .expect("exact modified time");
    let exact_now = exact_modified + Duration::from_secs(24 * 60 * 60);

    // When: the sweep cutoff is exactly 24 hours after that directory mtime.
    let removed =
        crate::chat_attachments::sweep_stale_chat_attachments_at(exact_cache.path(), exact_now)
            .expect("sweep exact stale attachments");

    // Then: the exactly-24h directory is stale.
    assert_eq!(removed, 1);
    assert!(!exact.exists());

    // Given: another orphan directory is just under the 24-hour cutoff.
    let newer_cache = TempRoot::new("stale-sweep-newer");
    let newer = newer_cache.path().join("newer");
    std::fs::create_dir_all(&newer).expect("create newer dir");
    let newer_modified = std::fs::metadata(&newer)
        .expect("stat newer dir")
        .modified()
        .expect("newer modified time");
    let newer_now = newer_modified + Duration::from_secs(24 * 60 * 60 - 1);

    // When: the sweep runs one second before the cutoff.
    let removed =
        crate::chat_attachments::sweep_stale_chat_attachments_at(newer_cache.path(), newer_now)
            .expect("sweep newer attachments");

    // Then: the newer directory survives.
    assert_eq!(removed, 0);
    assert!(newer.exists());
}

#[test]
fn cleanup_rejects_invalid_session_without_touching_cache() {
    // Given: cache has an attachment under a valid session.
    let cache = TempRoot::new("invalid-session");
    let store = AttachmentStore::default();
    let staged = stage_text(&store, cache.path(), "session-a", "keep.txt");

    // When/Then: invalid cleanup input fails before deleting anything.
    assert!(store
        .cleanup_session(cache.path(), cleanup_request("../session-a"))
        .expect_err("invalid session rejected")
        .to_string()
        .contains("invalid"));
    assert!(cache.path().join(&staged.id).exists());
}

#[test]
fn cleanup_removal_failure_is_logged_nonfatal_and_not_counted_removed() {
    // Given: session cleanup reaches a deterministic non-NotFound removal failure.
    let cache = TempRoot::new("failed-remove");
    let store = AttachmentStore::default();
    let staged = stage_text(&store, cache.path(), "session-a", "stuck.txt");
    let cleanup = FailingCleanup::default();

    // When: the owning session is cleaned.
    let receipt = store
        .cleanup_session_with_file_system(cache.path(), cleanup_request("session-a"), &cleanup)
        .expect("cleanup is nonfatal");

    // Then: physical removal is not counted, the failure is logged, and the orphan remains retryable.
    assert_eq!(receipt.removed, 0);
    assert!(cache.path().join(&staged.id).exists());
    assert!(store
        .read(crate::chat_attachments::types::ReadChatAttachmentRequest {
            session_id: "session-a".to_string(),
            attachment_id: staged.id.clone(),
        })
        .expect_err("record was released despite nonfatal cleanup failure")
        .to_string()
        .contains("unknown"));
    assert_eq!(
        cleanup
            .failures
            .lock()
            .expect("read cleanup failures")
            .as_slice(),
        [cache.path().join(&staged.id).to_string_lossy().to_string()]
    );
    let removed = crate::chat_attachments::sweep_stale_chat_attachments_at(
        cache.path(),
        std::fs::metadata(cache.path().join(&staged.id))
            .expect("stat orphan")
            .modified()
            .expect("orphan modified")
            + Duration::from_secs(24 * 60 * 60),
    )
    .expect("stale sweep retries orphan");
    assert_eq!(removed, 1);
    assert!(!cache.path().join(&staged.id).exists());
}

fn stage_text(
    store: &AttachmentStore,
    cache_root: &Path,
    session_id: &str,
    name: &str,
) -> crate::chat_attachments::StagedChatAttachment {
    store
        .stage(
            cache_root,
            stage_request(session_id, name, "text/plain", b"notes".to_vec()),
        )
        .expect("stage text")
}

fn cleanup_request(session_id: &str) -> CleanupChatSessionRequest {
    CleanupChatSessionRequest {
        session_id: session_id.to_string(),
    }
}

fn stage_request(
    session_id: &str,
    file_name: &str,
    mime: &str,
    bytes: Vec<u8>,
) -> StageChatAttachmentRequest {
    let size = bytes.len();
    StageChatAttachmentRequest {
        session_id: session_id.to_string(),
        file_name: file_name.to_string(),
        mime: mime.to_string(),
        size,
        bytes,
    }
}

#[derive(Default)]
struct FailingCleanup {
    failures: Mutex<Vec<String>>,
}

impl crate::chat_attachments::cleanup::CleanupFileSystem for FailingCleanup {
    fn remove_dir_all(&self, _directory: &Path) -> std::io::Result<()> {
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "permission denied by test seam",
        ))
    }

    fn cleanup_failed(&self, directory: &Path, _error: &std::io::Error) {
        self.failures
            .lock()
            .expect("record cleanup failure")
            .push(directory.to_string_lossy().to_string());
    }

    fn sweep_failed(&self, _directory: &Path, _error: &std::io::Error) {}
}
