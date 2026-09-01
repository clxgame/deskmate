use super::*;

#[test]
fn authorizes_only_xiaozhu_with_declared_skill() {
    assert!(crate::chat_attachments::ncm::is_authorized("xiaozhu", true));
    assert!(!crate::chat_attachments::ncm::is_authorized(
        "xiaozhu", false
    ));
    assert!(!crate::chat_attachments::ncm::is_authorized("other", true));
}

#[test]
fn converts_staged_ncm_to_persistent_mp3_artifact() {
    let root = TempAttachmentRoot::new("ncm-mp3");
    let store = AttachmentStore::default();
    let staged = stage_named_ncm(&store, root.path(), "Annabel - 遠雷.ncm");

    let artifact = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect("convert staged NCM");

    assert_eq!(artifact.id, staged.id);
    assert_eq!(artifact.file_name, "Annabel - 遠雷.mp3");
    assert_eq!(artifact.mime, "audio/mpeg");
    assert_eq!(artifact.size, MP3_BYTES.len());
    assert_eq!(
        decoded_sha256(&artifact.data_url),
        format!("{:x}", Sha256::digest(MP3_BYTES))
    );
    assert_eq!(
        artifact.data_url,
        "data:audio/mpeg;base64,bmF0aXZlLW1wMy1ieXRlcw=="
    );
    assert!(!root.path().join(&staged.id).join("source").exists());
    assert_eq!(
        std::fs::read(root.path().join(&staged.id).join("artifact.mp3"))
            .expect("read persistent artifact"),
        MP3_BYTES
    );
}

#[test]
fn converts_staged_ncm_to_persistent_flac_artifact() {
    let root = TempAttachmentRoot::new("ncm-flac");
    let store = AttachmentStore::default();
    let staged = stage_named_ncm(&store, root.path(), "Annabel.final.mix.ncm");

    let artifact = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu", &staged.id),
            &FakeRunner {
                run: FakeRun::OneFlac,
            },
        )
        .expect("convert staged NCM");

    assert_eq!(artifact.file_name, "Annabel.final.mix.flac");
    assert_eq!(artifact.mime, "audio/flac");
    assert_eq!(artifact.size, FLAC_BYTES.len());
    assert_eq!(
        decoded_sha256(&artifact.data_url),
        format!("{:x}", Sha256::digest(FLAC_BYTES))
    );
    assert_eq!(
        artifact.data_url,
        "data:audio/flac;base64,bmF0aXZlLWZsYWMtYnl0ZXM="
    );
    assert_eq!(
        std::fs::read(root.path().join(&staged.id).join("artifact.flac"))
            .expect("read persistent artifact"),
        FLAC_BYTES
    );
}

#[test]
fn artifact_filename_sanitizer_keeps_reserved_windows_stems_safe() {
    assert_eq!(
        super::super::sanitize_artifact_filename("CON", "mp3"),
        "converted-audio.mp3"
    );
    assert_eq!(
        super::super::sanitize_artifact_filename("CON.song", "flac"),
        "converted-audio.flac"
    );
}
