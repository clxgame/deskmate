use std::path::PathBuf;

use tauri::{Manager, State};

mod cleanup;
mod conversion;
mod export;
#[cfg(test)]
pub(crate) mod export_io;
#[cfg(not(test))]
mod export_io;
mod ncm;
mod store;
mod types;
mod validation;

use ncm::BinaryNcmRunner;
pub use store::AttachmentStore;
use types::AttachmentError;
pub use types::{
    CleanupChatSessionReceipt, CleanupChatSessionRequest, ConvertStagedNcmRequest,
    DiscardChatAttachmentReceipt, DiscardChatAttachmentRequest, ExportChatArtifactReceipt,
    ExportChatArtifactRequest, ReadChatAttachment, ReadChatAttachmentRequest,
    StageChatAttachmentRequest, StagedChatAttachment,
};

fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, AttachmentError> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| AttachmentError::Io(std::io::Error::other(error)))?
        .join("chat-attachments"))
}

#[tauri::command]
pub fn stage_chat_attachment(
    app: tauri::AppHandle,
    store: State<AttachmentStore>,
    request: StageChatAttachmentRequest,
) -> Result<StagedChatAttachment, String> {
    store
        .stage(
            &cache_root(&app).map_err(|error| error.to_string())?,
            request,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_chat_attachment(
    store: State<AttachmentStore>,
    request: ReadChatAttachmentRequest,
) -> Result<ReadChatAttachment, String> {
    store.read(request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn discard_chat_attachment(
    store: State<AttachmentStore>,
    request: DiscardChatAttachmentRequest,
) -> Result<DiscardChatAttachmentReceipt, String> {
    store.discard(request).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn convert_staged_ncm(
    app: tauri::AppHandle,
    store: State<AttachmentStore>,
    request: ConvertStagedNcmRequest,
) -> Result<ReadChatAttachment, String> {
    let has_skill =
        crate::packs::persona_grants_skill(&app, &request.persona_id, ncm::NCM_SKILL_FILE);
    if !ncm::is_authorized(request.persona_id.as_str(), has_skill) {
        return Err(AttachmentError::UnauthorizedNcm.to_string());
    }
    let runner = BinaryNcmRunner::resolve(&app)
        .ok_or(AttachmentError::MissingNcmRunner)
        .map_err(|error| error.to_string())?;
    store
        .convert_staged_ncm(
            &cache_root(&app).map_err(|error| error.to_string())?,
            request,
            &runner,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_chat_artifact(
    app: tauri::AppHandle,
    store: State<AttachmentStore>,
    request: ExportChatArtifactRequest,
) -> Result<ExportChatArtifactReceipt, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| AttachmentError::DownloadsUnavailable)
        .map_err(|error| error.to_string())?;
    store
        .export_artifact(&downloads, request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cleanup_chat_session(
    app: tauri::AppHandle,
    store: State<AttachmentStore>,
    request: CleanupChatSessionRequest,
) -> Result<CleanupChatSessionReceipt, String> {
    store
        .cleanup_session(
            &cache_root(&app).map_err(|error| error.to_string())?,
            request,
        )
        .map_err(|error| error.to_string())
}

pub(crate) fn start_stale_sweep(app: &tauri::AppHandle) {
    let cache = match cache_root(app) {
        Ok(cache) => cache,
        Err(error) => {
            eprintln!("chat attachment stale sweep skipped: {error}");
            return;
        }
    };
    std::thread::spawn(move || {
        if let Err(error) = cleanup::sweep_stale_at(&cache, std::time::SystemTime::now()) {
            eprintln!("chat attachment stale sweep failed: {error}");
        }
    });
}

#[cfg(test)]
pub(crate) fn sweep_stale_chat_attachments_at(
    cache_root: &std::path::Path,
    now: std::time::SystemTime,
) -> Result<usize, AttachmentError> {
    cleanup::sweep_stale_at(cache_root, now)
}
