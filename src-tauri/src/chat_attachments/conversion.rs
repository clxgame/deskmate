use std::path::Path;

use super::ncm::{self, NcmRunner, StagedNcmArtifactInput};
use super::store::AttachmentStore;
use super::types::{
    ArtifactRecord, AttachmentError, ConvertStagedNcmRequest, ReadChatAttachment, SessionId,
};
use super::validation::{parse_attachment_id, SESSION_TOTAL_BYTES};

impl AttachmentStore {
    pub(crate) fn convert_staged_ncm<R: NcmRunner>(
        &self,
        cache_root: &Path,
        request: ConvertStagedNcmRequest,
        runner: &R,
    ) -> Result<ReadChatAttachment, AttachmentError> {
        if request.persona_id != ncm::XIAOZHU_PERSONA_ID {
            return Err(AttachmentError::UnauthorizedNcm);
        }
        let session_id = SessionId::parse(request.session_id)?;
        let id = parse_attachment_id(&request.attachment_id)?;
        let (record_session, source_name, source, directory) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| AttachmentError::StatePoisoned)?;
            let record = state
                .records
                .get_mut(&id)
                .ok_or(AttachmentError::UnknownId)?;
            if record.session_id != session_id {
                return Err(AttachmentError::WrongSession);
            }
            if record.converting {
                return Err(AttachmentError::ConversionInProgress);
            }
            if let Some(artifact) = &record.artifact {
                return Ok(artifact.metadata.clone());
            }
            if record.metadata.mime != "application/x-ncm" {
                return Err(AttachmentError::NotNcm);
            }
            let source = record.source.clone().ok_or(AttachmentError::NoNcmOutput)?;
            let directory = record.directory.clone();
            if !directory.starts_with(cache_root) {
                return Err(AttachmentError::InvalidId);
            }
            record.converting = true;
            (
                record.session_id.0.clone(),
                record.metadata.file_name.clone(),
                source,
                directory,
            )
        };
        let _lease = ConversionLease::new(self, session_id.clone(), id.clone());

        let prepared = ncm::prepare_artifact(
            StagedNcmArtifactInput {
                attachment_id: &id,
                session_id: &record_session,
                source_file_name: &source_name,
                source_path: &source,
                attachment_dir: &directory,
            },
            runner,
        )?;
        let commit = (|| {
            let mut state = self
                .state
                .lock()
                .map_err(|_| AttachmentError::StatePoisoned)?;
            let (source_path, source_size, ordinary_bytes, next_total) = {
                let record = state.records.get(&id).ok_or(AttachmentError::UnknownId)?;
                if record.session_id != session_id {
                    return Err(AttachmentError::WrongSession);
                }
                if let Some(artifact) = &record.artifact {
                    return Ok(artifact.metadata.clone());
                }
                let source_path = record.source.clone().ok_or(AttachmentError::NoNcmOutput)?;
                let usage = state.sessions.get(&session_id).copied().unwrap_or_default();
                let next_total = usage
                    .total
                    .checked_sub(record.metadata.size)
                    .and_then(|total| total.checked_add(prepared.metadata.size))
                    .ok_or(AttachmentError::AggregateTooLarge { limit_mib: 64 })?;
                (
                    source_path,
                    record.metadata.size,
                    record.ordinary_bytes,
                    next_total,
                )
            };
            if next_total > SESSION_TOTAL_BYTES {
                return Err(AttachmentError::AggregateTooLarge { limit_mib: 64 });
            }
            std::fs::remove_file(source_path)?;
            let record = state
                .records
                .get_mut(&id)
                .ok_or(AttachmentError::UnknownId)?;
            if record.session_id != session_id {
                return Err(AttachmentError::WrongSession);
            }
            if record.source.is_none() || record.metadata.size != source_size {
                return Err(AttachmentError::NoNcmOutput);
            }
            record.artifact = Some(ArtifactRecord {
                metadata: prepared.metadata.clone(),
                path: prepared.artifact_path.clone(),
            });
            record.source = None;
            if let Some(usage) = state.sessions.get_mut(&session_id) {
                usage.total = next_total;
                usage.ordinary = usage.ordinary.saturating_sub(ordinary_bytes);
            }
            Ok(prepared.metadata.clone())
        })();
        if commit.is_err() {
            let _ = std::fs::remove_file(&prepared.artifact_path);
        }
        commit
    }
}

struct ConversionLease<'store> {
    store: &'store AttachmentStore,
    session_id: SessionId,
    id: String,
}

impl<'store> ConversionLease<'store> {
    fn new(store: &'store AttachmentStore, session_id: SessionId, id: String) -> Self {
        Self {
            store,
            session_id,
            id,
        }
    }
}

impl Drop for ConversionLease<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.store.state.lock() {
            if let Some(record) = state.records.get_mut(&self.id) {
                if record.session_id == self.session_id {
                    record.converting = false;
                }
            }
        }
    }
}
