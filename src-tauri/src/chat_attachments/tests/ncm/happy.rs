use super::*;

#[test]
fn authorizes_third_generation_only_with_declared_skill() {
    let persona_id = "xiaozhu-sandaime";
    assert!(crate::chat_attachments::ncm::is_authorized(
        persona_id, true
    ));
    assert!(!crate::chat_attachments::ncm::is_authorized(
        persona_id, false
    ));
    for lookalike in [
        "xiaozhu-sandaime-fake",
        "xiaozhu-sandaime ",
        "Xiaozhu-sandaime",
    ] {
        assert!(!crate::chat_attachments::ncm::is_authorized(
            lookalike, true
        ));
    }
}
#[test]
fn authorizes_only_xiaozhu_with_declared_skill() {
    assert!(crate::chat_attachments::ncm::is_authorized("xiaozhu", true));
    assert!(!crate::chat_attachments::ncm::is_authorized(
        "xiaozhu", false
    ));
    assert!(!crate::chat_attachments::ncm::is_authorized("other", true));
    assert!(crate::chat_attachments::ncm::is_authorized(
        "xiaozhu-nidaime",
        true
    ));
    assert!(!crate::chat_attachments::ncm::is_authorized(
        "xiaozhu-nidaime",
        false
    ));
    assert!(!crate::chat_attachments::ncm::is_authorized(
        "xiaozhu-fake",
        true
    ));
}

#[test]
fn second_generation_converts_staged_music() {
    let root = TempAttachmentRoot::new("ncm-nidaime");
    let store = AttachmentStore::default();
    let staged = stage_named_ncm(&store, root.path(), "music.ncm");
    let artifact = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu-nidaime", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect("convert music with second generation");
    assert_eq!(artifact.file_name, "music.mp3");
    assert_eq!(artifact.mime, "audio/mpeg");
    assert_eq!(
        decoded_sha256(&artifact.data_url),
        format!("{:x}", Sha256::digest(MP3_BYTES))
    );
}

#[test]
fn third_generation_converts_staged_music() {
    let root = TempAttachmentRoot::new("ncm-sandaime");
    let store = AttachmentStore::default();
    let staged = stage_named_ncm(&store, root.path(), "music.ncm");
    let artifact = store
        .convert_staged_ncm(
            root.path(),
            convert_request("xiaozhu-sandaime", &staged.id),
            &FakeRunner {
                run: FakeRun::OneMp3,
            },
        )
        .expect("convert music with third generation");
    assert_eq!(artifact.file_name, "music.mp3");
    assert_eq!(artifact.mime, "audio/mpeg");
    assert_eq!(
        decoded_sha256(&artifact.data_url),
        format!("{:x}", Sha256::digest(MP3_BYTES))
    );
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
