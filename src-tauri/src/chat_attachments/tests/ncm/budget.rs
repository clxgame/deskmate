use super::*;

const MIB: usize = 1024 * 1024;
const SESSION_TOTAL_BYTES: usize = 64 * MIB;

#[test]
fn converted_artifact_counts_toward_session_total_budget() {
    let root = TempAttachmentRoot::new("ncm-artifact-budget");
    let store = AttachmentStore::default();
    let staged = stage_ncm(&store, root.path());

    store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect("convert small NCM to retained artifact");

    let error = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "exact-limit.ncm",
                "application/x-ncm",
                vec![1; 64 * MIB],
            ),
        )
        .expect_err("retained artifact bytes must reduce remaining session budget");
    assert!(error.to_string().contains("64 MiB"));
}

#[test]
fn smaller_artifact_releases_source_budget() {
    let root = TempAttachmentRoot::new("ncm-smaller-artifact-budget");
    let store = AttachmentStore::default();
    let staged = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "large-source.ncm",
                "application/x-ncm",
                vec![1; 2 * MIB],
            ),
        )
        .expect("stage larger NCM source");

    let artifact = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::SizedMp3(MIB),
            },
        )
        .expect("smaller artifact should replace source budget");

    assert_eq!(artifact.size, MIB);
    assert_eq!(session_usage(&store), (0, MIB));
    store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "remaining-budget.ncm",
                "application/x-ncm",
                vec![1; SESSION_TOTAL_BYTES - MIB],
            ),
        )
        .expect("released source bytes make exact remaining budget available");
    let error = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "one-byte-too-many.ncm",
                "application/x-ncm",
                vec![1],
            ),
        )
        .expect_err("session total should now be exactly full");
    assert!(error.to_string().contains("64 MiB"));
}

#[test]
fn exact_session_limit_replacement_succeeds() {
    let root = TempAttachmentRoot::new("ncm-exact-replacement-budget");
    let store = AttachmentStore::default();
    let staged = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "one-meg-source.ncm",
                "application/x-ncm",
                vec![1; MIB],
            ),
        )
        .expect("stage NCM source");
    store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "budget-filler.ncm",
                "application/x-ncm",
                vec![1; SESSION_TOTAL_BYTES - (2 * MIB)],
            ),
        )
        .expect("stage filler leaving room for exact replacement");

    let artifact = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::SizedMp3(2 * MIB),
            },
        )
        .expect("replacement that lands exactly on 64 MiB should pass");

    assert_eq!(artifact.size, 2 * MIB);
    assert_eq!(session_usage(&store), (0, SESSION_TOTAL_BYTES));
}

#[test]
fn oversized_artifact_output_rolls_back_usage_and_keeps_source_retryable() {
    let root = TempAttachmentRoot::new("ncm-over-budget-artifact");
    let store = AttachmentStore::default();
    let staged = stage_ncm(&store, root.path());
    let filler = store
        .stage(
            root.path(),
            stage_request(
                "session-a",
                "filler.ncm",
                "application/x-ncm",
                vec![1; SESSION_TOTAL_BYTES - staged.size],
            ),
        )
        .expect("stage filler up to the session ceiling");
    assert_eq!(session_usage(&store), (0, SESSION_TOTAL_BYTES));

    let error = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect_err("larger artifact must exceed the session ceiling");

    assert!(error.to_string().contains("64 MiB"));
    assert_eq!(session_usage(&store), (0, SESSION_TOTAL_BYTES));
    assert_source_retryable_without_artifact(&store, root.path(), &staged.id);
    store
        .discard(discard_request("session-a", &filler.id))
        .expect("discard unrelated filler to free budget");
    let retry = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect("retry succeeds after freeing budget");
    assert_eq!(retry.file_name, "source.mp3");
}

fn session_usage(store: &AttachmentStore) -> (usize, usize) {
    let session_id = crate::chat_attachments::types::SessionId::parse("session-a".to_string())
        .expect("parse test session id");
    let state = store.state.lock().expect("lock store state");
    let usage = state
        .sessions
        .get(&session_id)
        .copied()
        .expect("session usage exists");
    (usage.ordinary, usage.total)
}
