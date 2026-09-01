use std::path::{Path, PathBuf};
use std::process::Command;

use base64::Engine;
use tauri::Manager;
use uuid::Uuid;

use super::types::{AttachmentError, AttachmentKind, ReadChatAttachment, ReadyAttachmentStatus};
use super::validation::has_windows_reserved_stem;

pub(super) const NCM_SKILL_FILE: &str = "ncmdump.md";
pub(super) const XIAOZHU_PERSONA_ID: &str = "xiaozhu";

pub(super) fn is_authorized(persona_id: &str, has_declared_skill: bool) -> bool {
    persona_id == XIAOZHU_PERSONA_ID && has_declared_skill
}

pub(crate) trait NcmRunner {
    fn run(&self, source: &Path, output_dir: &Path) -> Result<(), NcmRunError>;
}

#[derive(Debug)]
pub(crate) enum NcmRunError {
    #[cfg(test)]
    Missing,
    Failed,
    Io(std::io::Error),
}

pub(super) struct BinaryNcmRunner {
    binary: PathBuf,
}

pub(super) struct PreparedArtifact {
    pub(super) metadata: ReadChatAttachment,
    pub(super) artifact_path: PathBuf,
}

pub(super) struct StagedNcmArtifactInput<'a> {
    pub(super) attachment_id: &'a str,
    pub(super) session_id: &'a str,
    pub(super) source_file_name: &'a str,
    pub(super) source_path: &'a Path,
    pub(super) attachment_dir: &'a Path,
}

impl BinaryNcmRunner {
    pub(super) fn resolve(app: &tauri::AppHandle) -> Option<Self> {
        let executable = if cfg!(windows) {
            "ncmdump.exe"
        } else {
            "ncmdump"
        };
        let mut candidates = Vec::new();
        if let Ok(dir) = app.path().resource_dir() {
            candidates.push(dir.join("resources").join("ncmdump").join(executable));
            candidates.push(dir.join("ncmdump").join(executable));
        }
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("ncmdump")
                .join(executable),
        );
        candidates
            .into_iter()
            .find(|path| path.is_file())
            .map(|binary| Self { binary })
    }
}

impl NcmRunner for BinaryNcmRunner {
    fn run(&self, source: &Path, output_dir: &Path) -> Result<(), NcmRunError> {
        let mut command = Command::new(&self.binary);
        command.arg(source).arg("-o").arg(output_dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let output = command.output().map_err(NcmRunError::Io)?;
        if output.status.success() {
            Ok(())
        } else {
            Err(NcmRunError::Failed)
        }
    }
}

impl From<NcmRunError> for AttachmentError {
    fn from(error: NcmRunError) -> Self {
        match error {
            #[cfg(test)]
            NcmRunError::Missing => Self::MissingNcmRunner,
            NcmRunError::Failed => Self::NcmRunnerFailed,
            NcmRunError::Io(error) => Self::Io(error),
        }
    }
}

pub(super) fn prepare_artifact<R: NcmRunner>(
    context: StagedNcmArtifactInput<'_>,
    runner: &R,
) -> Result<PreparedArtifact, AttachmentError> {
    let work = WorkDir::new(context.attachment_dir)?;
    let runner_input = work.path().join("source.ncm");
    let output_dir = work.path().join("output");
    std::fs::create_dir_all(&output_dir)?;
    std::fs::copy(context.source_path, &runner_input)?;
    runner.run(&runner_input, &output_dir)?;

    let output = find_single_output(&output_dir)?;
    let output_bytes = std::fs::read(&output.path)?;
    if output_bytes.is_empty() {
        return Err(AttachmentError::EmptyNcmOutput);
    }

    let artifact_path = context
        .attachment_dir
        .join(format!("artifact.{}", output.extension));
    match std::fs::rename(&output.path, &artifact_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(AttachmentError::ArtifactExists);
        }
        Err(error) => return Err(AttachmentError::Io(error)),
    }
    let data = base64::engine::general_purpose::STANDARD.encode(&output_bytes);
    let metadata = ReadChatAttachment {
        id: context.attachment_id.to_string(),
        session_id: context.session_id.to_string(),
        file_name: sanitize_artifact_filename(
            staged_artifact_stem(context.source_file_name),
            &output.extension,
        ),
        mime: output.mime.to_string(),
        size: output_bytes.len(),
        kind: AttachmentKind::Audio,
        status: ReadyAttachmentStatus::Ready,
        data_url: format!("data:{};base64,{data}", output.mime),
    };

    Ok(PreparedArtifact {
        metadata,
        artifact_path,
    })
}

struct WorkDir {
    root: PathBuf,
    path: PathBuf,
}

impl WorkDir {
    fn new(attachment_dir: &Path) -> Result<Self, AttachmentError> {
        let root = attachment_dir.join("work");
        let path = root.join(Uuid::new_v4().to_string());
        std::fs::create_dir_all(&path)?;
        Ok(Self { root, path })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
        let _ = std::fs::remove_dir(&self.root);
    }
}

struct NcmOutput {
    path: PathBuf,
    extension: String,
    mime: &'static str,
}

fn find_single_output(output_dir: &Path) -> Result<NcmOutput, AttachmentError> {
    let mut files = Vec::new();
    let mut audio = Vec::new();
    for entry in std::fs::read_dir(output_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        files.push(entry.path());
        if let Some(output) = parse_audio_output(entry.path()) {
            audio.push(output);
        }
    }
    match (audio.len(), files.len()) {
        (1, 1) => audio.pop().ok_or(AttachmentError::NoNcmOutput),
        (0, 0) => Err(AttachmentError::NoNcmOutput),
        (0, _) => Err(AttachmentError::InvalidNcmOutput),
        _ => Err(AttachmentError::MultipleNcmOutputs),
    }
}

fn parse_audio_output(path: PathBuf) -> Option<NcmOutput> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        _ => return None,
    };
    Some(NcmOutput {
        path,
        extension,
        mime,
    })
}

fn staged_artifact_stem(file_name: &str) -> &str {
    match Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
    {
        Some(stem) if !stem.is_empty() => stem,
        _ => file_name,
    }
}

fn sanitize_artifact_filename(name: &str, extension: &str) -> String {
    let stem = name.trim_end_matches([' ', '.']);
    let mut clean = stem
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>();
    if clean.trim().is_empty() || has_windows_reserved_stem(&clean) {
        clean = "converted-audio".to_string();
    }
    format!("{clean}.{extension}")
}

#[cfg(test)]
#[path = "tests/ncm.rs"]
mod tests;
