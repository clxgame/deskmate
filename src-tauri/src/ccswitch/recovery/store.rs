#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::paths::{read_observed_path, validate_allowed_path};
use super::{FileObservation, RecoveryError};

pub(crate) struct PendingFile {
    path: PathBuf,
    committed: bool,
}

impl PendingFile {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for PendingFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub(crate) fn create_synced_temp(
    directory: &Path,
    label: &str,
    bytes: &[u8],
) -> Result<PendingFile, RecoveryError> {
    let path = directory.join(format!(".{label}-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| RecoveryError::WriteFailed)?;
    file.write_all(bytes)
        .map_err(|_| RecoveryError::WriteFailed)?;
    file.sync_all().map_err(|_| RecoveryError::WriteFailed)?;
    drop(file);
    Ok(PendingFile {
        path,
        committed: false,
    })
}

pub(crate) fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), RecoveryError> {
    let directory = target.parent().ok_or(RecoveryError::PathRejected)?;
    let pending = create_synced_temp(directory, "manifest", bytes)?;
    fs::rename(pending.path(), target).map_err(|_| RecoveryError::WriteFailed)?;
    pending.commit();
    sync_directory(directory)
}

pub(crate) fn replace_if_current(
    target: &Path,
    replacement: Option<PendingFile>,
    verify_claimed: impl FnOnce(Option<&Path>) -> Result<(), RecoveryError>,
) -> Result<(), RecoveryError> {
    let directory = target.parent().ok_or(RecoveryError::PathRejected)?;
    let claim = claim_current(target, directory)?;
    if let Err(error) = verify_claimed(claim.as_ref().map(PendingFile::path)) {
        release_claim(target, claim)?;
        return Err(error);
    }
    match replacement {
        Some(pending) => {
            if fs::hard_link(pending.path(), target).is_err() {
                let conflict = fs::symlink_metadata(target).is_ok();
                release_claim(target, claim)?;
                return Err(if conflict {
                    RecoveryError::StaleConflict { current_hash: None }
                } else {
                    RecoveryError::WriteFailed
                });
            }
            drop(pending);
        }
        None if fs::symlink_metadata(target).is_ok() => {
            release_claim(target, claim)?;
            return Err(RecoveryError::StaleConflict { current_hash: None });
        }
        None => {}
    }
    drop(claim);
    Ok(())
}

fn claim_current(target: &Path, directory: &Path) -> Result<Option<PendingFile>, RecoveryError> {
    let path = directory.join(format!(".restore-claim-{}.tmp", Uuid::new_v4()));
    match fs::rename(target, &path) {
        Ok(()) => Ok(Some(PendingFile {
            path,
            committed: false,
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(RecoveryError::WriteFailed),
    }
}

fn release_claim(target: &Path, claim: Option<PendingFile>) -> Result<(), RecoveryError> {
    let Some(claim) = claim else {
        return Ok(());
    };
    match fs::hard_link(claim.path(), target) {
        Ok(()) => Ok(()),
        Err(_) if fs::symlink_metadata(target).is_ok() => Ok(()),
        Err(_) => {
            claim.commit();
            Err(RecoveryError::WriteFailed)
        }
    }
}

#[cfg(unix)]
pub(crate) fn sync_directory(directory: &Path) -> Result<(), RecoveryError> {
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|_| RecoveryError::WriteFailed)
}

#[cfg(not(unix))]
pub(crate) fn sync_directory(_directory: &Path) -> Result<(), RecoveryError> {
    Ok(())
}

/// Atomically rewrites a file inside `home` only while it still matches
/// `expected`, so a third-party write between our read and our commit aborts
/// instead of being silently clobbered.
pub(crate) fn replace_file_if_unchanged(
    home: &Path,
    target: &Path,
    expected: &FileObservation,
    bytes: &[u8],
) -> Result<(), RecoveryError> {
    validate_allowed_path(home, target)?;
    let directory = target.parent().ok_or(RecoveryError::PathRejected)?;
    let pending = create_synced_temp(directory, "model-catalog", bytes)?;
    replace_if_current(target, Some(pending), |claimed_path| {
        let observed = match claimed_path {
            Some(path) => read_observed_path(home, path)?.observation,
            None => FileObservation::Missing,
        };
        if &observed != expected {
            return Err(RecoveryError::StaleConflict {
                current_hash: observed.hash().map(str::to_owned),
            });
        }
        Ok(())
    })?;
    sync_directory(directory)
}
