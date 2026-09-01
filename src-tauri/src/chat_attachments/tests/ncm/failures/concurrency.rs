use super::*;

const SESSION_TOTAL_BYTES: usize = 64 * 1024 * 1024;

#[test]
fn containment_failure_clears_conversion_reservation_for_retry() {
    let root = TempAttachmentRoot::new("ncm-containment-source");
    let wrong_root = TempAttachmentRoot::new("ncm-containment-wrong-root");
    let store = AttachmentStore::default();
    let staged = stage_ncm(&store, root.path());
    let calls = std::sync::atomic::AtomicUsize::new(0);

    let error = store
        .convert_staged_ncm(
            wrong_root.path(),
            convert_request("xiaozhu", &staged.id),
            &CountingRunner(&calls),
        )
        .expect_err("cache containment mismatch must fail");
    assert!(error.to_string().contains("invalid attachment id"));
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);

    let artifact = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect("retry after containment failure succeeds");
    assert_eq!(artifact.mime, "audio/mpeg");
}

#[test]
fn rejects_duplicate_conversion_while_first_is_in_progress() {
    let root = TempAttachmentRoot::new("ncm-duplicate");
    let store = std::sync::Arc::new(AttachmentStore::default());
    let staged = stage_ncm(&store, root.path());
    let root_path = root.path().to_path_buf();
    let first_store = std::sync::Arc::clone(&store);
    let first_id = staged.id.clone();
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
    let first = std::thread::spawn(move || {
        first_store.convert_staged_ncm(
            &root_path,
            convert_request("xiaozhu", &first_id),
            &BlockingRunner {
                started: started_tx,
                release: release_rx,
            },
        )
    });
    started_rx.recv().expect("first conversion reached runner");

    let duplicate_calls = std::sync::atomic::AtomicUsize::new(0);
    let duplicate = store.convert_staged_ncm(
        root.path(),
        convert_request("xiaozhu", &staged.id),
        &CountingRunner(&duplicate_calls),
    );
    release_tx.send(()).expect("release first conversion");
    let first_result = first.join().expect("first conversion thread");
    assert!(duplicate
        .expect_err("duplicate conversion must be rejected")
        .to_string()
        .contains("in progress"));
    assert_eq!(duplicate_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    let first_artifact = first_result.expect("first conversion succeeds");
    assert_eq!(first_artifact.mime, "audio/mpeg");
    assert_eq!(
        store
            .read(read_request("session-a", &staged.id))
            .expect("successful first artifact remains registered")
            .mime,
        "audio/mpeg"
    );
    assert!(!root.path().join(&staged.id).join("source").exists());
    assert_eq!(
        std::fs::read(root.path().join(&staged.id).join("artifact.mp3"))
            .expect("successful first artifact remains persisted"),
        MP3_BYTES
    );
}

#[test]
fn conversion_counts_same_session_stage_while_runner_is_blocked() {
    let root = TempAttachmentRoot::new("ncm-stage-during-conversion");
    let store = std::sync::Arc::new(AttachmentStore::default());
    let staged = stage_ncm(&store, root.path());
    let root_path = root.path().to_path_buf();
    let first_store = std::sync::Arc::clone(&store);
    let first_id = staged.id.clone();
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
    let first = std::thread::spawn(move || {
        first_store.convert_staged_ncm(
            &root_path,
            convert_request("xiaozhu", &first_id),
            &BlockingRunner {
                started: started_tx,
                release: release_rx,
            },
        )
    });
    started_rx
        .recv()
        .expect("conversion reached blocking runner");

    let filler = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "same-session-filler.ncm",
                "application/x-ncm",
                vec![1; SESSION_TOTAL_BYTES - staged.size],
            ),
        )
        .expect("same-session stage can fill the budget while conversion is running");
    release_tx.send(()).expect("release conversion runner");
    let error = first
        .join()
        .expect("conversion thread")
        .expect_err("conversion must count concurrent same-session stage");

    assert!(error.to_string().contains("64 MiB"));
    assert_source_retryable_without_artifact(&store, root.path(), &staged.id);
    let full_error = store
        .stage(
            root.path(),
            stage_request("session-a", "still-full.ncm", "application/x-ncm", vec![1]),
        )
        .expect_err("failed conversion must not undercount the full session");
    assert!(full_error.to_string().contains("64 MiB"));
    store
        .discard(discard_request("session-a", &filler.id))
        .expect("discard concurrent filler to free retry budget");
    let retry = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect("retry succeeds after freeing concurrent filler");
    assert_eq!(retry.mime, "audio/mpeg");
}

#[test]
fn conversion_counts_same_session_discard_while_runner_is_blocked() {
    let root = TempAttachmentRoot::new("ncm-discard-during-conversion");
    let store = std::sync::Arc::new(AttachmentStore::default());
    let staged = stage_ncm(&store, root.path());
    let filler = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "discarded-filler.ncm",
                "application/x-ncm",
                vec![1; SESSION_TOTAL_BYTES - staged.size],
            ),
        )
        .expect("same-session filler starts at the session ceiling");
    let root_path = root.path().to_path_buf();
    let first_store = std::sync::Arc::clone(&store);
    let first_id = staged.id.clone();
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
    let first = std::thread::spawn(move || {
        first_store.convert_staged_ncm(
            &root_path,
            convert_request("xiaozhu", &first_id),
            &BlockingRunner {
                started: started_tx,
                release: release_rx,
            },
        )
    });
    started_rx
        .recv()
        .expect("conversion reached blocking runner");

    store
        .discard(discard_request("session-a", &filler.id))
        .expect("same-session discard can free budget while conversion is running");
    release_tx.send(()).expect("release conversion runner");
    let artifact = first
        .join()
        .expect("conversion thread")
        .expect("conversion must count concurrent same-session discard");

    assert_eq!(artifact.mime, "audio/mpeg");
    store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "remaining-after-discard.ncm",
                "application/x-ncm",
                vec![1; SESSION_TOTAL_BYTES - MP3_BYTES.len()],
            ),
        )
        .expect("artifact accounting leaves exactly the remaining session budget");
    let full_error = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "over-after-discard.ncm",
                "application/x-ncm",
                vec![1],
            ),
        )
        .expect_err("artifact plus remaining filler reaches the ceiling");
    assert!(full_error.to_string().contains("64 MiB"));
}
