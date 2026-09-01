use std::path::{Path, PathBuf};

use super::AttachmentStore;
use crate::chat_attachments::types::{
    DiscardChatAttachmentRequest, ReadChatAttachmentRequest, StageChatAttachmentRequest,
};

pub(crate) const MIB: usize = 1024 * 1024;

pub(crate) struct TempAttachmentRoot {
    path: PathBuf,
}

pub(crate) fn stage_request(
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

pub(crate) fn read_request(session_id: &str, id: &str) -> ReadChatAttachmentRequest {
    ReadChatAttachmentRequest {
        session_id: session_id.to_string(),
        attachment_id: id.to_string(),
    }
}

pub(crate) fn discard_request(session_id: &str, id: &str) -> DiscardChatAttachmentRequest {
    DiscardChatAttachmentRequest {
        session_id: session_id.to_string(),
        attachment_id: id.to_string(),
    }
}

impl TempAttachmentRoot {
    pub(crate) fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "yume-chat-attachments-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create temp attachment root");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempAttachmentRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[path = "tests/input_validation.rs"]
mod input_validation;
#[path = "tests/ipc.rs"]
mod ipc;
#[path = "tests/manual.rs"]
mod manual;
#[path = "tests/quotas.rs"]
mod quotas;
#[path = "tests/storage.rs"]
mod storage;
