use uuid::Uuid;

use super::types::{AttachmentError, AttachmentKind, SessionId, StageChatAttachmentRequest};

const MIB: usize = 1024 * 1024;
const ORDINARY_ITEM_BYTES: usize = 20 * MIB;
pub(super) const ORDINARY_AGGREGATE_BYTES: usize = 20 * MIB;
const NCM_ITEM_BYTES: usize = 64 * MIB;
pub(super) const SESSION_TOTAL_BYTES: usize = 64 * MIB;
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "COM¹", "COM²",
    "COM³", "LPT¹", "LPT²", "LPT³", "CLOCK$", "CONIN$", "CONOUT$",
];

pub(super) struct ValidatedStageRequest {
    pub(super) session_id: SessionId,
    pub(super) file_name: String,
    pub(super) mime: String,
    pub(super) size: usize,
    pub(super) bytes: Vec<u8>,
    pub(super) kind: AttachmentKind,
    pub(super) ordinary_bytes: usize,
}

impl ValidatedStageRequest {
    pub(super) fn parse(request: StageChatAttachmentRequest) -> Result<Self, AttachmentError> {
        let session_id = SessionId::parse(request.session_id)?;
        let file_name = sanitize_filename(&request.file_name)?;
        let (mime, kind) = parse_mime(&request.mime)?;
        let size = request.bytes.len();
        if size == 0 {
            return Err(AttachmentError::EmptyData);
        }
        if request.size != size {
            return Err(AttachmentError::SizeMismatch);
        }
        let is_ncm = is_ncm_filename(&file_name);
        if is_ncm != (mime == "application/x-ncm") {
            return Err(AttachmentError::InconsistentNcmMetadata);
        }
        let ordinary_bytes = if is_ncm {
            enforce_item_budget(size, NCM_ITEM_BYTES)?;
            0
        } else {
            enforce_item_budget(size, ORDINARY_ITEM_BYTES)?;
            size
        };
        Ok(Self {
            session_id,
            file_name,
            mime,
            size,
            bytes: request.bytes,
            kind,
            ordinary_bytes,
        })
    }
}

impl SessionId {
    pub(super) fn parse(value: String) -> Result<Self, AttachmentError> {
        if value.trim().is_empty()
            || value.chars().any(char::is_control)
            || value.contains(['/', '\\'])
        {
            return Err(AttachmentError::InvalidSession);
        }
        Ok(Self(value))
    }
}

pub(super) fn parse_attachment_id(value: &str) -> Result<String, AttachmentError> {
    Uuid::parse_str(value)
        .map(|id| id.to_string())
        .map_err(|_| AttachmentError::InvalidId)
}

pub(super) fn has_windows_reserved_stem(value: &str) -> bool {
    let Some(stem) = value.split('.').next() else {
        return false;
    };
    let normalized = stem.trim_end_matches([' ', '.']).to_ascii_uppercase();
    WINDOWS_RESERVED_NAMES.contains(&normalized.as_str())
}

fn sanitize_filename(value: &str) -> Result<String, AttachmentError> {
    const RESERVED_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

    if value.trim().is_empty()
        || value.chars().any(char::is_control)
        || value.chars().any(|ch| RESERVED_CHARS.contains(&ch))
    {
        return Err(AttachmentError::InvalidFilename);
    }
    let trimmed = value.trim_end_matches([' ', '.']);
    if trimmed != value || trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(AttachmentError::InvalidFilename);
    }
    if has_windows_reserved_stem(trimmed) {
        return Err(AttachmentError::InvalidFilename);
    }
    Ok(value.to_string())
}

fn parse_mime(value: &str) -> Result<(String, AttachmentKind), AttachmentError> {
    let kind = match value {
        "image/gif" | "image/jpeg" | "image/png" | "image/webp" => AttachmentKind::Image,
        "audio/flac" | "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/wav" | "audio/webm"
        | "application/x-ncm" => AttachmentKind::Audio,
        "application/pdf"
        | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        | "text/plain" => AttachmentKind::Text,
        _ => return Err(AttachmentError::InvalidMime),
    };
    Ok((value.to_string(), kind))
}

fn is_ncm_filename(filename: &str) -> bool {
    filename.to_ascii_lowercase().ends_with(".ncm")
}

fn enforce_item_budget(size: usize, limit: usize) -> Result<(), AttachmentError> {
    if size > limit {
        return Err(AttachmentError::ItemTooLarge {
            limit_mib: limit / MIB,
        });
    }
    Ok(())
}

pub(super) fn enforce_aggregate_budget(
    current: usize,
    next: usize,
    limit: usize,
) -> Result<(), AttachmentError> {
    let total = current
        .checked_add(next)
        .ok_or(AttachmentError::AggregateTooLarge {
            limit_mib: limit / MIB,
        })?;
    if total > limit {
        return Err(AttachmentError::AggregateTooLarge {
            limit_mib: limit / MIB,
        });
    }
    Ok(())
}
