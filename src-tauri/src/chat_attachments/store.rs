use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use uuid::Uuid;

use super::types::{
    AttachmentError, DiscardChatAttachmentReceipt, DiscardChatAttachmentRequest,
    ReadChatAttachment, ReadChatAttachmentRequest, ReadyAttachmentStatus, SessionId,
    StageChatAttachmentRequest, StagedChatAttachment,
};
use super::validation::{
    enforce_aggregate_budget, parse_attachment_id, ValidatedStageRequest, ORDINARY_AGGREGATE_BYTES,
    SESSION_TOTAL_BYTES,
};

#[derive(Default)]
pub struct AttachmentStore {
    pub(super) state: Mutex<StoreState>,
}

#[derive(Default)]
pub(super) struct StoreState {
    pub(super) records: HashMap<String, AttachmentRecord>,
    pub(super) sessions: HashMap<SessionId, SessionUsage>,
}

#[derive(Clone, Debug)]
pub(super) struct AttachmentRecord {
    pub(super) session_id: SessionId,
    pub(super) metadata: StagedChatAttachment,
    pub(super) directory: PathBuf,
    pub(super) source: Option<PathBuf>,
    pub(super) artifact: Option<super::types::ArtifactRecord>,
    pub(super) converting: bool,
    pub(super) ordinary_bytes: usize,
}

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct SessionUsage {
    pub(super) ordinary: usize,
    pub(super) total: usize,
}

impl AttachmentStore {
    pub(crate) fn stage(
        &self,
        cache_root: &Path,
        request: StageChatAttachmentRequest,
    ) -> Result<StagedChatAttachment, AttachmentError> {
        let ValidatedStageRequest {
            session_id,
            file_name,
            mime,
            size,
            bytes,
            kind,
            ordinary_bytes,
        } = ValidatedStageRequest::parse(request)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| AttachmentError::StatePoisoned)?;
        let usage = state.sessions.get(&session_id).copied().unwrap_or_default();
        enforce_aggregate_budget(usage.ordinary, ordinary_bytes, ORDINARY_AGGREGATE_BYTES)?;
        enforce_aggregate_budget(usage.total, size, SESSION_TOTAL_BYTES)?;

        let id = state.unused_id();
        let directory = cache_root.join(&id);
        let source = directory.join("source");
        std::fs::create_dir_all(&directory)?;
        if let Err(error) = std::fs::write(&source, bytes) {
            let _ = std::fs::remove_dir_all(&directory);
            return Err(AttachmentError::Io(error));
        }

        let metadata = StagedChatAttachment::new(
            id.clone(),
            session_id.0.clone(),
            file_name,
            mime,
            size,
            kind,
        );
        let record = AttachmentRecord {
            session_id: session_id.clone(),
            metadata: metadata.clone(),
            directory,
            source: Some(source),
            artifact: None,
            converting: false,
            ordinary_bytes,
        };
        state.records.insert(id, record);
        state.sessions.insert(
            session_id,
            SessionUsage {
                ordinary: usage.ordinary + ordinary_bytes,
                total: usage.total + size,
            },
        );
        Ok(metadata)
    }

    pub(crate) fn read(
        &self,
        request: ReadChatAttachmentRequest,
    ) -> Result<ReadChatAttachment, AttachmentError> {
        let session_id = SessionId::parse(request.session_id)?;
        let id = parse_attachment_id(&request.attachment_id)?;
        let (id, session_id, file_name, mime, size, kind, path) = {
            let state = self
                .state
                .lock()
                .map_err(|_| AttachmentError::StatePoisoned)?;
            let record = state.records.get(&id).ok_or(AttachmentError::UnknownId)?;
            if record.session_id != session_id {
                return Err(AttachmentError::WrongSession);
            }
            match &record.artifact {
                Some(artifact) => {
                    let metadata = &artifact.metadata;
                    (
                        metadata.id.clone(),
                        metadata.session_id.clone(),
                        metadata.file_name.clone(),
                        metadata.mime.clone(),
                        metadata.size,
                        metadata.kind,
                        artifact.path.clone(),
                    )
                }
                None => {
                    let metadata = &record.metadata;
                    (
                        metadata.id.clone(),
                        metadata.session_id.clone(),
                        metadata.file_name.clone(),
                        metadata.mime.clone(),
                        metadata.size,
                        metadata.kind,
                        record.source.clone().ok_or(AttachmentError::NoNcmOutput)?,
                    )
                }
            }
        };
        let bytes = std::fs::read(path)?;
        let data_url = format!(
            "data:{};base64,{}",
            mime,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        Ok(ReadChatAttachment {
            id,
            session_id,
            file_name,
            mime,
            size,
            kind,
            status: ReadyAttachmentStatus::Ready,
            data_url,
        })
    }

    pub(crate) fn discard(
        &self,
        request: DiscardChatAttachmentRequest,
    ) -> Result<DiscardChatAttachmentReceipt, AttachmentError> {
        let session_id = SessionId::parse(request.session_id)?;
        let id = parse_attachment_id(&request.attachment_id)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| AttachmentError::StatePoisoned)?;
        let record = state.records.get(&id).ok_or(AttachmentError::UnknownId)?;
        if record.session_id != session_id {
            return Err(AttachmentError::WrongSession);
        }
        match std::fs::remove_dir_all(&record.directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(AttachmentError::Io(error)),
        }
        let removed = state
            .records
            .remove(&id)
            .ok_or(AttachmentError::UnknownId)?;
        if let Some(usage) = state.sessions.get_mut(&session_id) {
            usage.ordinary = usage.ordinary.saturating_sub(removed.ordinary_bytes);
            usage.total = usage.total.saturating_sub(removed.current_total_bytes());
            if usage.ordinary == 0 && usage.total == 0 {
                state.sessions.remove(&session_id);
            }
        }
        Ok(DiscardChatAttachmentReceipt { discarded: true })
    }
}

impl AttachmentRecord {
    fn current_total_bytes(&self) -> usize {
        self.artifact
            .as_ref()
            .map(|artifact| artifact.metadata.size)
            .unwrap_or(self.metadata.size)
    }
}

impl StoreState {
    fn unused_id(&self) -> String {
        loop {
            let id = Uuid::new_v4().to_string();
            if !self.records.contains_key(&id) {
                return id;
            }
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
