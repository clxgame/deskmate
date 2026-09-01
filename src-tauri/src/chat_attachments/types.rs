use std::fmt;

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum AttachmentKind {
    Image,
    Text,
    Audio,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
enum StagedAttachmentStatus {
    Staged,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum ReadyAttachmentStatus {
    Ready,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct SessionId(pub(super) String);

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedChatAttachment {
    pub(super) id: String,
    pub(super) session_id: String,
    pub(super) file_name: String,
    pub(super) mime: String,
    pub(super) size: usize,
    pub(super) kind: AttachmentKind,
    status: StagedAttachmentStatus,
}

impl StagedChatAttachment {
    pub(super) fn new(
        id: String,
        session_id: String,
        file_name: String,
        mime: String,
        size: usize,
        kind: AttachmentKind,
    ) -> Self {
        Self {
            id,
            session_id,
            file_name,
            mime,
            size,
            kind,
            status: StagedAttachmentStatus::Staged,
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadChatAttachment {
    pub(super) id: String,
    pub(super) session_id: String,
    pub(super) file_name: String,
    pub(super) mime: String,
    pub(super) size: usize,
    pub(super) kind: AttachmentKind,
    pub(super) status: ReadyAttachmentStatus,
    pub(super) data_url: String,
}

#[derive(Clone, Debug)]
pub(super) struct ArtifactRecord {
    pub(super) metadata: ReadChatAttachment,
    pub(super) path: std::path::PathBuf,
}

#[derive(Debug, serde::Serialize)]
pub struct DiscardChatAttachmentReceipt {
    pub(super) discarded: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StageChatAttachmentRequest {
    pub(super) session_id: String,
    pub(super) file_name: String,
    pub(super) mime: String,
    pub(super) size: usize,
    pub(super) bytes: Vec<u8>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ReadChatAttachmentRequest {
    pub(super) session_id: String,
    pub(super) attachment_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DiscardChatAttachmentRequest {
    pub(super) session_id: String,
    pub(super) attachment_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ConvertStagedNcmRequest {
    pub(super) session_id: String,
    pub(super) attachment_id: String,
    pub(super) persona_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ExportChatArtifactRequest {
    pub(super) session_id: String,
    pub(super) artifact_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CleanupChatSessionRequest {
    pub(super) session_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportChatArtifactReceipt {
    pub(super) artifact_id: String,
    pub(super) session_id: String,
    pub(super) file_name: String,
    pub(super) mime: String,
    pub(super) size: usize,
    pub(super) exported_at: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupChatSessionReceipt {
    pub(super) removed: usize,
}

#[derive(Debug)]
pub(crate) enum AttachmentError {
    EmptyData,
    SizeMismatch,
    InvalidSession,
    InvalidFilename,
    InvalidMime,
    InconsistentNcmMetadata,
    InvalidId,
    UnknownId,
    WrongSession,
    NotNcm,
    UnauthorizedNcm,
    ConversionInProgress,
    MissingNcmRunner,
    NcmRunnerFailed,
    NoNcmOutput,
    MultipleNcmOutputs,
    EmptyNcmOutput,
    InvalidNcmOutput,
    ArtifactExists,
    ArtifactNotReady,
    DownloadsUnavailable,
    ExportFailed,
    ExportNameUnavailable,
    ItemTooLarge { limit_mib: usize },
    AggregateTooLarge { limit_mib: usize },
    Io(std::io::Error),
    StatePoisoned,
}

impl fmt::Display for AttachmentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyData => formatter.write_str("attachment data must not be empty"),
            Self::SizeMismatch => formatter.write_str("attachment size does not match data"),
            Self::InvalidSession => formatter.write_str("invalid attachment session"),
            Self::InvalidFilename => formatter.write_str("invalid attachment filename"),
            Self::InvalidMime => formatter.write_str("invalid attachment mime"),
            Self::InconsistentNcmMetadata => {
                formatter.write_str("NCM filename and mime must agree")
            }
            Self::InvalidId => formatter.write_str("invalid attachment id"),
            Self::UnknownId => formatter.write_str("unknown attachment id"),
            Self::WrongSession => formatter.write_str("attachment belongs to another session"),
            Self::NotNcm => formatter.write_str("attachment is not a staged NCM source"),
            Self::UnauthorizedNcm => formatter.write_str("xiaozhu NCM skill is required"),
            Self::ConversionInProgress => {
                formatter.write_str("NCM conversion is already in progress")
            }
            Self::MissingNcmRunner => formatter.write_str("bundled ncmdump runner is unavailable"),
            Self::NcmRunnerFailed => formatter.write_str("ncmdump could not convert this file"),
            Self::NoNcmOutput => formatter.write_str("ncmdump did not produce an audio file"),
            Self::MultipleNcmOutputs => {
                formatter.write_str("ncmdump produced multiple audio files")
            }
            Self::EmptyNcmOutput => formatter.write_str("ncmdump produced an empty audio file"),
            Self::InvalidNcmOutput => formatter.write_str("ncmdump produced an unsupported file"),
            Self::ArtifactExists => formatter.write_str("attachment artifact already exists"),
            Self::ArtifactNotReady => formatter.write_str("attachment artifact is not ready"),
            Self::DownloadsUnavailable => formatter.write_str("Downloads directory is unavailable"),
            Self::ExportFailed => formatter.write_str("could not write attachment to Downloads"),
            Self::ExportNameUnavailable => {
                formatter.write_str("could not reserve a Downloads filename")
            }
            Self::ItemTooLarge { limit_mib } => {
                write!(formatter, "attachment item exceeds {limit_mib} MiB")
            }
            Self::AggregateTooLarge { limit_mib } => {
                write!(formatter, "attachment session exceeds {limit_mib} MiB")
            }
            Self::Io(error) => write!(formatter, "attachment storage failed: {error}"),
            Self::StatePoisoned => formatter.write_str("attachment store state poisoned"),
        }
    }
}

impl From<std::io::Error> for AttachmentError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
