use super::*;

#[test]
fn rejects_non_xiaozhu_persona_before_running_converter() {
    let root = TempAttachmentRoot::new("ncm-persona");
    let store = AttachmentStore::default();
    let staged = stage_ncm(&store, root.path());

    let error = store
        .convert_staged_ncm(
            root.path(),
            convert_request("not-xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect_err("only xiaozhu may convert");

    assert!(error.to_string().contains("xiaozhu"));
    assert_source_retryable_without_artifact(&store, root.path(), &staged.id);
}

#[test]
fn rejects_wrong_session_unknown_id_and_non_ncm_sources() {
    let root = TempAttachmentRoot::new("ncm-identity");
    let store = AttachmentStore::default();
    let staged = stage_ncm(&store, root.path());
    let text = store
        .stage(
            root.path(),
            stage_request("session-a", "notes.txt", "text/plain", b"text".to_vec()),
        )
        .expect("stage ordinary text");
    let mut wrong_session = convert_request("xiaozhu", &staged.id);
    wrong_session.session_id = "session-b".to_string();
    let unknown = convert_request("xiaozhu", &uuid::Uuid::new_v4().to_string());

    assert!(store
        .convert_staged_ncm(
            root.path(),
            wrong_session,
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect_err("wrong session must fail")
        .to_string()
        .contains("session"));
    assert!(store
        .convert_staged_ncm(
            root.path(),
            unknown,
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect_err("unknown id must fail")
        .to_string()
        .contains("unknown"));
    assert!(store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &text.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect_err("ordinary source must fail")
        .to_string()
        .contains("NCM"));
    assert_source_retryable_without_artifact(&store, root.path(), &staged.id);
    assert!(store.read(read_request("session-a", &text.id)).is_ok());
}
