use super::*;

#[test]
fn conversion_failures_keep_source_retryable_without_artifact() {
    for run in [
        FakeRun::MissingRunner,
        FakeRun::Failure,
        FakeRun::None,
        FakeRun::TwoOutputs,
        FakeRun::EmptyMp3,
        FakeRun::WrongExtension,
    ] {
        let root = TempAttachmentRoot::new("ncm-failure");
        let store = AttachmentStore::default();
        let staged = stage_ncm(&store, root.path());

        store
            .convert_staged_ncm(
                root.path(),
                convert_request("xiaozhu", &staged.id),
                &FakeRunner { run },
            )
            .expect_err("conversion must fail");

        assert_source_retryable_without_artifact(&store, root.path(), &staged.id);
        let retry = store
            .convert_staged_ncm(
                root.path(),
                convert_request("xiaozhu", &staged.id),
                &FakeRunner {
                    run: FakeRun::OneMp3,
                },
            )
            .expect("retry succeeds without restaging");
        assert_eq!(retry.mime, "audio/mpeg");
    }
}

#[test]
fn cleans_private_work_dir_after_success_and_failure() {
    for run in [FakeRun::OneMp3, FakeRun::Failure] {
        let root = TempAttachmentRoot::new("ncm-work-dir");
        let store = AttachmentStore::default();
        let staged = stage_ncm(&store, root.path());

        let _ = store.convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner { run },
        );

        assert!(!root.path().join(&staged.id).join("work").exists());
    }
}
