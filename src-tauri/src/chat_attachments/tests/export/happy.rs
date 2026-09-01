use std::sync::Arc;

use super::*;
use crate::chat_attachments::AttachmentStore;

#[test]
fn exports_first_available_download_name_when_artifact_is_ready() {
    // Given: an audio artifact is cached under an opaque attachment id.
    let cache = TempRoot::new("first-cache");
    let downloads = TempRoot::new("first-downloads");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", "Decoded Song.mp3", "mp3");

    // When: the artifact is exported to the injected Downloads root.
    let receipt = store
        .export_artifact(downloads.path(), export_request("session-a", &artifact.id))
        .expect("export artifact");

    // Then: Downloads receives only the public file name and exact bytes.
    assert_eq!(receipt.artifact_id, artifact.id);
    assert_eq!(receipt.session_id, "session-a");
    assert_eq!(receipt.file_name, "Decoded Song.mp3");
    assert_eq!(receipt.mime, "audio/mpeg");
    assert_eq!(receipt.size, AUDIO_BYTES.len());
    assert_eq!(
        std::fs::read(downloads.path().join("Decoded Song.mp3")).expect("read exported artifact"),
        AUDIO_BYTES
    );
}

#[test]
fn concurrent_exports_create_distinct_byte_identical_files() {
    // Given: two export requests target the same cached artifact and empty Downloads root.
    let cache = TempRoot::new("concurrent-cache");
    let downloads = TempRoot::new("concurrent-downloads");
    let store = Arc::new(AttachmentStore::default());
    let artifact = insert_artifact(&store, cache.path(), "session-a", "Decoded Song.mp3", "mp3");
    let first_store = Arc::clone(&store);
    let second_store = Arc::clone(&store);
    let first_downloads = downloads.path().to_path_buf();
    let second_downloads = downloads.path().to_path_buf();
    let first_id = artifact.id.clone();
    let second_id = artifact.id.clone();

    // When: both exports race through the same create_new naming loop.
    let first = std::thread::spawn(move || {
        first_store.export_artifact(&first_downloads, export_request("session-a", &first_id))
    });
    let second = std::thread::spawn(move || {
        second_store.export_artifact(&second_downloads, export_request("session-a", &second_id))
    });
    let mut receipts = [
        first
            .join()
            .expect("join first export")
            .expect("first export"),
        second
            .join()
            .expect("join second export")
            .expect("second export"),
    ];
    receipts.sort_by_key(|receipt| receipt.file_name.len());

    // Then: no overwrite occurs; both files contain the same artifact bytes.
    assert_eq!(receipts[0].file_name, "Decoded Song.mp3");
    assert_eq!(receipts[1].file_name, "Decoded Song (1).mp3");
    for receipt in receipts {
        assert_eq!(
            std::fs::read(downloads.path().join(receipt.file_name)).expect("read exported file"),
            AUDIO_BYTES
        );
    }
}

#[test]
fn existing_download_is_not_overwritten_and_suffix_preserves_bytes() {
    // Given: Downloads already contains the artifact's display name.
    let cache = TempRoot::new("collision-cache");
    let downloads = TempRoot::new("collision-downloads");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", "Decoded Song.mp3", "mp3");
    std::fs::write(
        downloads.path().join("Decoded Song.mp3"),
        b"do-not-overwrite",
    )
    .expect("write existing download");

    // When: exporting the cached artifact encounters the existing name.
    let receipt = store
        .export_artifact(downloads.path(), export_request("session-a", &artifact.id))
        .expect("export with collision");

    // Then: the original file is untouched and the suffix file has artifact bytes.
    assert_eq!(receipt.file_name, "Decoded Song (1).mp3");
    assert_eq!(
        std::fs::read(downloads.path().join("Decoded Song.mp3")).expect("read original download"),
        b"do-not-overwrite"
    );
    assert_eq!(
        std::fs::read(downloads.path().join("Decoded Song (1).mp3")).expect("read suffixed export"),
        AUDIO_BYTES
    );
}

#[test]
fn sanitizes_reserved_display_name_and_preserves_verified_artifact_extension() {
    // Given: artifact metadata has a Windows reserved display stem while the stored artifact is FLAC.
    let cache = TempRoot::new("reserved-cache");
    let downloads = TempRoot::new("reserved-downloads");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", "CON.mp3", "flac");

    // When: the artifact is exported.
    let receipt = store
        .export_artifact(downloads.path(), export_request("session-a", &artifact.id))
        .expect("export reserved display name");

    // Then: the public name is safe and keeps the artifact file extension.
    assert_eq!(receipt.file_name, "converted-audio.flac");
    assert_eq!(receipt.mime, "audio/flac");
    assert!(downloads.path().join("converted-audio.flac").is_file());
    assert!(!downloads.path().join("CON.mp3").exists());
}

#[test]
fn sanitizes_separator_characters_without_treating_metadata_as_a_path() {
    // Given: artifact metadata contains path separators but the stored artifact extension is FLAC.
    let cache = TempRoot::new("separator-cache");
    let downloads = TempRoot::new("separator-downloads");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(
        &store,
        cache.path(),
        "session-a",
        "folder\\Unsafe:Song.mp3",
        "flac",
    );

    // When: the artifact is exported.
    let receipt = store
        .export_artifact(downloads.path(), export_request("session-a", &artifact.id))
        .expect("export separator display name");

    // Then: the whole display stem is sanitized and no path-shaped output is created.
    assert_eq!(receipt.file_name, "folder_Unsafe_Song.flac");
    assert!(downloads.path().join("folder_Unsafe_Song.flac").is_file());
    assert!(!downloads.path().join("Unsafe_Song.flac").exists());
}

#[test]
fn sanitizes_windows_reserved_dot_stems_before_creating_download() {
    // Given: artifact metadata begins with a dotted Windows reserved stem.
    let cache = TempRoot::new("reserved-dot-cache");
    let downloads = TempRoot::new("reserved-dot-downloads");
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", "CON.song.mp3", "mp3");

    // When: the artifact is exported on a Windows host.
    let receipt = store
        .export_artifact(downloads.path(), export_request("session-a", &artifact.id))
        .expect("export dotted reserved display name");

    // Then: the returned safe filename exists and contains the artifact bytes.
    assert_eq!(receipt.file_name, "converted-audio.mp3");
    assert_eq!(
        std::fs::read(downloads.path().join(&receipt.file_name))
            .expect("read dotted reserved export"),
        AUDIO_BYTES
    );
    assert!(!downloads.path().join("CON.song.mp3").exists());
}

#[test]
fn sanitizes_conout_dollar_dotted_device_before_creating_download() {
    assert_reserved_display_exports_safe("CONOUT$.song.mp3", "conout-dollar-dot");
}

#[test]
fn sanitizes_conin_dollar_device_before_creating_download() {
    assert_reserved_display_exports_safe("CONIN$.mp3", "conin-dollar");
}

#[test]
fn sanitizes_clock_dollar_device_before_creating_download() {
    assert_reserved_display_exports_safe("CLOCK$.mp3", "clock-dollar");
}

#[test]
fn sanitizes_superscript_com_device_before_creating_download() {
    assert_reserved_display_exports_safe("COM¹.mp3", "superscript-com");
}

#[test]
fn sanitizes_superscript_lpt_device_before_creating_download() {
    assert_reserved_display_exports_safe("LPT¹.mp3", "superscript-lpt");
}

fn assert_reserved_display_exports_safe(display_name: &str, label: &str) {
    // Given: artifact metadata begins with a Windows device stem.
    let cache = TempRoot::new(label);
    let downloads = TempRoot::new(label);
    let store = AttachmentStore::default();
    let artifact = insert_artifact(&store, cache.path(), "session-a", display_name, "mp3");

    // When: the artifact is exported to a real Downloads test directory.
    let receipt = store
        .export_artifact(downloads.path(), export_request("session-a", &artifact.id))
        .expect("export device display name");

    // Then: the returned safe filename exists, has exact bytes, and the device path is absent.
    assert_eq!(receipt.file_name, "converted-audio.mp3");
    assert_eq!(
        std::fs::read(downloads.path().join(&receipt.file_name)).expect("read device-safe export"),
        AUDIO_BYTES
    );
    assert!(!downloads.path().join(display_name).exists());
}
