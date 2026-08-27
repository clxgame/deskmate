use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use super::{
    FileObservation, ObservedFiles, RecoveryError, AUTH_RELATIVE_PATH, CONFIG_RELATIVE_PATH,
    MAX_EXTERNAL_FILE_BYTES,
};

#[derive(Clone)]
pub struct OpenCodePaths {
    home: PathBuf,
    config: PathBuf,
    auth: PathBuf,
}

impl OpenCodePaths {
    pub fn from_home(home: &Path) -> Result<Self, RecoveryError> {
        reject_ambiguous_path(home)?;
        let metadata = fs::symlink_metadata(home).map_err(|_| RecoveryError::PathRejected)?;
        if !metadata.is_dir() || metadata_is_link(&metadata) {
            return Err(RecoveryError::PathRejected);
        }
        let home = home
            .canonicalize()
            .map_err(|_| RecoveryError::PathRejected)?;
        let config = home.join(CONFIG_RELATIVE_PATH);
        let auth = home.join(AUTH_RELATIVE_PATH);
        validate_allowed_path(&home, &config)?;
        validate_allowed_path(&home, &auth)?;
        Ok(Self { home, config, auth })
    }

    pub fn config(&self) -> &Path {
        &self.config
    }

    pub fn auth(&self) -> &Path {
        &self.auth
    }

    pub(crate) fn home(&self) -> &Path {
        &self.home
    }

    fn path(&self, kind: OpenCodeFile) -> &Path {
        match kind {
            OpenCodeFile::Config => &self.config,
            OpenCodeFile::Auth => &self.auth,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum OpenCodeFile {
    Config,
    Auth,
}

pub(crate) struct ObservedFile {
    pub observation: FileObservation,
    pub bytes: Option<Vec<u8>>,
}

pub fn observe_files(paths: &OpenCodePaths) -> Result<ObservedFiles, RecoveryError> {
    Ok(ObservedFiles {
        config: read_observed_file(paths, OpenCodeFile::Config)?.observation,
        auth: read_observed_file(paths, OpenCodeFile::Auth)?.observation,
    })
}

pub(crate) fn read_observed_file(
    paths: &OpenCodePaths,
    kind: OpenCodeFile,
) -> Result<ObservedFile, RecoveryError> {
    let path = paths.path(kind);
    read_observed_path(&paths.home, path)
}

pub(crate) fn read_observed_path(home: &Path, path: &Path) -> Result<ObservedFile, RecoveryError> {
    validate_allowed_path(home, path)?;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ObservedFile {
                observation: FileObservation::Missing,
                bytes: None,
            });
        }
        Err(_) => return Err(RecoveryError::ReadFailed),
    };
    if !metadata.is_file()
        || metadata_is_link(&metadata)
        || metadata.len() > MAX_EXTERNAL_FILE_BYTES
    {
        return Err(RecoveryError::ReadFailed);
    }
    let mut file = File::open(path).map_err(|_| RecoveryError::ReadFailed)?;
    validate_allowed_path(home, path)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| RecoveryError::ReadFailed)?;
    if bytes.len() as u64 > MAX_EXTERNAL_FILE_BYTES {
        return Err(RecoveryError::ReadFailed);
    }
    validate_allowed_path(home, path)?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    Ok(ObservedFile {
        observation: FileObservation::Present { sha256 },
        bytes: Some(bytes),
    })
}

pub(crate) fn prepare_directory_root(path: &Path) -> Result<PathBuf, RecoveryError> {
    reject_ambiguous_path(path)?;
    fs::create_dir_all(path).map_err(|_| RecoveryError::WriteFailed)?;
    let metadata = fs::symlink_metadata(path).map_err(|_| RecoveryError::PathRejected)?;
    if !metadata.is_dir() || metadata_is_link(&metadata) {
        return Err(RecoveryError::PathRejected);
    }
    path.canonicalize().map_err(|_| RecoveryError::PathRejected)
}

fn reject_ambiguous_path(path: &Path) -> Result<(), RecoveryError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(RecoveryError::PathRejected);
    }
    Ok(())
}

pub(crate) fn validate_allowed_path(home: &Path, target: &Path) -> Result<(), RecoveryError> {
    reject_ambiguous_path(home)?;
    reject_ambiguous_path(target)?;
    let home_metadata = fs::symlink_metadata(home).map_err(|_| RecoveryError::PathRejected)?;
    if !home_metadata.is_dir() || metadata_is_link(&home_metadata) {
        return Err(RecoveryError::PathRejected);
    }
    let canonical_home = home
        .canonicalize()
        .map_err(|_| RecoveryError::PathRejected)?;
    let relative = target
        .strip_prefix(home)
        .or_else(|_| target.strip_prefix(&canonical_home))
        .map_err(|_| RecoveryError::PathRejected)?;
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(RecoveryError::PathRejected);
    }
    let mut current = canonical_home;
    for component in relative.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata_is_link(&metadata) => {
                return Err(RecoveryError::PathRejected);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Err(RecoveryError::PathRejected),
        }
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
pub(crate) fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}
