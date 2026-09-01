use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use super::export_io::{ExportFileSystem, StdExportFileSystem};
use super::store::AttachmentStore;
use super::types::{
    AttachmentError, ExportChatArtifactReceipt, ExportChatArtifactRequest, ReadChatAttachment,
    SessionId,
};
use super::validation::{has_windows_reserved_stem, parse_attachment_id};

const MAX_EXPORT_COLLISIONS: usize = 1000;

struct ArtifactForExport {
    metadata: ReadChatAttachment,
    source_path: PathBuf,
}

impl AttachmentStore {
    pub(crate) fn export_artifact(
        &self,
        download_dir: &Path,
        request: ExportChatArtifactRequest,
    ) -> Result<ExportChatArtifactReceipt, AttachmentError> {
        if !download_dir.is_dir() {
            return Err(AttachmentError::DownloadsUnavailable);
        }
        let artifact = self.artifact_for_export(request.session_id, request.artifact_id)?;
        let file_name = export_filename(&artifact.metadata.file_name, &artifact.source_path)?;
        let exported_name = copy_to_downloads(
            &StdExportFileSystem,
            &artifact.source_path,
            download_dir,
            &file_name,
        )?;
        Ok(ExportChatArtifactReceipt {
            artifact_id: artifact.metadata.id,
            session_id: artifact.metadata.session_id,
            file_name: exported_name,
            mime: artifact.metadata.mime,
            size: artifact.metadata.size,
            exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        })
    }

    #[cfg(test)]
    fn export_artifact_with_file_system<F: ExportFileSystem>(
        &self,
        download_dir: &Path,
        request: ExportChatArtifactRequest,
        file_system: &F,
    ) -> Result<ExportChatArtifactReceipt, AttachmentError> {
        if !download_dir.is_dir() {
            return Err(AttachmentError::DownloadsUnavailable);
        }
        let artifact = self.artifact_for_export(request.session_id, request.artifact_id)?;
        let file_name = export_filename(&artifact.metadata.file_name, &artifact.source_path)?;
        let exported_name =
            copy_to_downloads(file_system, &artifact.source_path, download_dir, &file_name)?;
        Ok(ExportChatArtifactReceipt {
            artifact_id: artifact.metadata.id,
            session_id: artifact.metadata.session_id,
            file_name: exported_name,
            mime: artifact.metadata.mime,
            size: artifact.metadata.size,
            exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        })
    }

    fn artifact_for_export(
        &self,
        session_id: String,
        artifact_id: String,
    ) -> Result<ArtifactForExport, AttachmentError> {
        let session_id = SessionId::parse(session_id)?;
        let id = parse_attachment_id(&artifact_id)?;
        let state = self
            .state
            .lock()
            .map_err(|_| AttachmentError::StatePoisoned)?;
        let record = state.records.get(&id).ok_or(AttachmentError::UnknownId)?;
        if record.session_id != session_id {
            return Err(AttachmentError::WrongSession);
        }
        let artifact = record
            .artifact
            .as_ref()
            .ok_or(AttachmentError::ArtifactNotReady)?;
        Ok(ArtifactForExport {
            metadata: artifact.metadata.clone(),
            source_path: artifact.path.clone(),
        })
    }
}

fn copy_to_downloads<F: ExportFileSystem>(
    file_system: &F,
    source_path: &Path,
    download_dir: &Path,
    file_name: &str,
) -> Result<String, AttachmentError> {
    let mut source = File::open(source_path)?;
    let target_name = TargetName::parse(file_name)?;
    for index in 0..MAX_EXPORT_COLLISIONS {
        let candidate = target_name.candidate(index);
        let destination = download_dir.join(&candidate);
        match file_system.create_new(&destination) {
            Ok(file) => {
                write_reserved_export(file_system, &mut source, file, &destination)?;
                return Ok(candidate);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(AttachmentError::ExportFailed),
        }
    }
    Err(AttachmentError::ExportNameUnavailable)
}

fn write_reserved_export(
    file_system: &impl ExportFileSystem,
    source: &mut File,
    mut destination: impl Write,
    destination_path: &Path,
) -> Result<(), AttachmentError> {
    let result = {
        let mut bytes = Vec::new();
        source.read_to_end(&mut bytes).and_then(|_| {
            destination.write_all(&bytes)?;
            destination.flush()
        })
    };
    if result.is_err() {
        let _ = file_system.remove_file(destination_path);
        return Err(AttachmentError::ExportFailed);
    }
    Ok(())
}

struct TargetName {
    stem: String,
    extension: String,
}

impl TargetName {
    fn parse(file_name: &str) -> Result<Self, AttachmentError> {
        let extension = extension_from(file_name)?;
        let stem = stem_from(file_name)?;
        Ok(Self {
            stem: sanitize_stem(stem),
            extension,
        })
    }

    fn candidate(&self, index: usize) -> String {
        if index == 0 {
            return format!("{}.{}", self.stem, self.extension);
        }
        format!("{} ({}).{}", self.stem, index, self.extension)
    }
}

fn export_filename(display_name: &str, artifact_path: &Path) -> Result<String, AttachmentError> {
    let extension = extension_from_path(artifact_path)?;
    let stem = stem_from(display_name)?;
    Ok(format!("{}.{}", sanitize_stem(stem), extension))
}

fn extension_from(file_name: &str) -> Result<String, AttachmentError> {
    file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension)
        .filter(|extension| matches!(*extension, "mp3" | "flac"))
        .map(str::to_string)
        .ok_or(AttachmentError::InvalidFilename)
}

fn stem_from(file_name: &str) -> Result<&str, AttachmentError> {
    file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .filter(|stem| !stem.is_empty())
        .ok_or(AttachmentError::InvalidFilename)
}

fn extension_from_path(path: &Path) -> Result<String, AttachmentError> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|extension| matches!(extension.as_str(), "mp3" | "flac"))
        .ok_or(AttachmentError::InvalidNcmOutput)
}

fn sanitize_stem(stem: &str) -> String {
    let trimmed = stem.trim_end_matches([' ', '.']);
    let clean = trimmed
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    if clean.trim().is_empty() || has_windows_reserved_stem(&clean) {
        return "converted-audio".to_string();
    }
    clean
}

#[cfg(test)]
#[path = "tests/export.rs"]
mod tests;
