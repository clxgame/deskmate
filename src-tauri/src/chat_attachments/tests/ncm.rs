use std::path::Path;

use crate::chat_attachments::ncm::{NcmRunError, NcmRunner, WorkDir};
use crate::chat_attachments::types::{
    ConvertStagedNcmRequest, DiscardChatAttachmentRequest, ReadChatAttachmentRequest,
    StageChatAttachmentRequest,
};
use crate::chat_attachments::{AttachmentStore, StagedChatAttachment};
use base64::Engine;
use sha2::{Digest, Sha256};

pub(super) const MP3_BYTES: &[u8] = b"native-mp3-bytes";
pub(super) const FLAC_BYTES: &[u8] = b"native-flac-bytes";

#[derive(Clone, Copy)]
pub(super) enum FakeRun {
    OneMp3,
    OneFlac,
    None,
    EmptyMp3,
    TwoOutputs,
    WrongExtension,
    Failure,
    MissingRunner,
    SizedMp3(usize),
}

pub(super) struct FakeRunner {
    pub(super) run: FakeRun,
}

impl NcmRunner for FakeRunner {
    fn run(&self, _source: &Path, output_dir: &Path) -> Result<(), NcmRunError> {
        match self.run {
            FakeRun::OneMp3 => write_output(output_dir, "Decoded Song.mp3", MP3_BYTES),
            FakeRun::OneFlac => write_output(output_dir, "Decoded Song.flac", FLAC_BYTES),
            FakeRun::None => Ok(()),
            FakeRun::EmptyMp3 => write_output(output_dir, "empty.mp3", b""),
            FakeRun::TwoOutputs => {
                write_output(output_dir, "one.mp3", MP3_BYTES)?;
                write_output(output_dir, "two.flac", FLAC_BYTES)
            }
            FakeRun::WrongExtension => write_output(output_dir, "song.wav", b"wav"),
            FakeRun::Failure => Err(NcmRunError::Failed),
            FakeRun::MissingRunner => Err(NcmRunError::Missing),
            FakeRun::SizedMp3(size) => write_output(output_dir, "sized.mp3", &vec![0xff; size]),
        }
    }
}

pub(super) struct TempAttachmentRoot {
    path: std::path::PathBuf,
}

impl TempAttachmentRoot {
    pub(super) fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "yume-chat-attachments-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp attachment root");
        Self { path }
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempAttachmentRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(super) fn stage_ncm(store: &AttachmentStore, root: &Path) -> StagedChatAttachment {
    stage_named_ncm(store, root, "source.ncm")
}

pub(super) fn stage_named_ncm(
    store: &AttachmentStore,
    root: &Path,
    file_name: &str,
) -> StagedChatAttachment {
    store
        .stage(
            root,
            stage_request("session-a", file_name, "application/x-ncm", b"ncm".to_vec()),
        )
        .expect("stage NCM")
}

pub(super) fn stage_request(
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

pub(super) fn read_request(session_id: &str, id: &str) -> ReadChatAttachmentRequest {
    ReadChatAttachmentRequest {
        session_id: session_id.to_string(),
        attachment_id: id.to_string(),
    }
}

pub(super) fn discard_request(session_id: &str, id: &str) -> DiscardChatAttachmentRequest {
    DiscardChatAttachmentRequest {
        session_id: session_id.to_string(),
        attachment_id: id.to_string(),
    }
}

pub(super) fn convert_request(persona_id: &str, id: &str) -> ConvertStagedNcmRequest {
    ConvertStagedNcmRequest {
        session_id: "session-a".to_string(),
        attachment_id: id.to_string(),
        persona_id: persona_id.to_string(),
    }
}

pub(super) fn write_output(output_dir: &Path, name: &str, bytes: &[u8]) -> Result<(), NcmRunError> {
    std::fs::write(output_dir.join(name), bytes).map_err(NcmRunError::Io)
}

pub(super) fn assert_source_retryable_without_artifact(
    store: &AttachmentStore,
    root: &Path,
    attachment_id: &str,
) {
    assert!(store.read(read_request("session-a", attachment_id)).is_ok());
    assert!(root.join(attachment_id).join("source").exists());
    assert!(!root.join(attachment_id).join("artifact.mp3").exists());
    assert!(!root.join(attachment_id).join("artifact.flac").exists());
    assert!(!root.join(attachment_id).join("work").exists());
}

pub(super) fn decoded_sha256(data_url: &str) -> String {
    let (_, encoded) = data_url
        .split_once(',')
        .expect("data URL should contain base64 delimiter");
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("decode data URL payload");
    format!("{:x}", Sha256::digest(decoded))
}

#[path = "ncm/budget.rs"]
mod budget;
#[path = "ncm/failures.rs"]
mod failures;
#[path = "ncm/happy.rs"]
mod happy;
#[path = "ncm/manual.rs"]
mod manual;
#[path = "ncm/work_dir.rs"]
mod work_dir;
