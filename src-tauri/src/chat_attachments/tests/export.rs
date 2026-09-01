use std::path::{Path, PathBuf};

use base64::Engine;

use crate::chat_attachments::types::{
    ArtifactRecord, AttachmentKind, ExportChatArtifactRequest, ReadChatAttachment,
    ReadyAttachmentStatus, StageChatAttachmentRequest,
};
use crate::chat_attachments::AttachmentStore;

pub(super) const AUDIO_BYTES: &[u8] = b"downloadable-audio";

pub(super) struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    pub(super) fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "yume-chat-attachment-export-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp root");
        Self { path }
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub(super) fn export_request(session_id: &str, artifact_id: &str) -> ExportChatArtifactRequest {
    ExportChatArtifactRequest {
        session_id: session_id.to_string(),
        artifact_id: artifact_id.to_string(),
    }
}

pub(super) fn insert_artifact(
    store: &AttachmentStore,
    cache_root: &Path,
    session_id: &str,
    display_name: &str,
    extension: &str,
) -> ReadChatAttachment {
    let staged = store
        .stage(
            cache_root,
            stage_request(
                session_id,
                "source.ncm",
                "application/x-ncm",
                b"ncm".to_vec(),
            ),
        )
        .expect("stage backing NCM");
    let mime = match extension {
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        value => panic!("unsupported test extension: {value}"),
    };
    let directory = cache_root.join(&staged.id);
    let artifact_path = directory.join(format!("artifact.{extension}"));
    std::fs::write(&artifact_path, AUDIO_BYTES).expect("write cached artifact");
    let data = base64::engine::general_purpose::STANDARD.encode(AUDIO_BYTES);
    let metadata = ReadChatAttachment {
        id: staged.id.clone(),
        session_id: session_id.to_string(),
        file_name: display_name.to_string(),
        mime: mime.to_string(),
        size: AUDIO_BYTES.len(),
        kind: AttachmentKind::Audio,
        status: ReadyAttachmentStatus::Ready,
        data_url: format!("data:{mime};base64,{data}"),
    };
    let mut state = store.state.lock().expect("lock store state");
    let record = state
        .records
        .get_mut(&staged.id)
        .expect("find staged record");
    record.artifact = Some(ArtifactRecord {
        metadata: metadata.clone(),
        path: artifact_path,
    });
    let _ = std::fs::remove_file(directory.join("source"));
    record.source = None;
    metadata
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

#[path = "export/failures.rs"]
mod failures;
#[path = "export/happy.rs"]
mod happy;
#[path = "export/manual.rs"]
mod manual;
