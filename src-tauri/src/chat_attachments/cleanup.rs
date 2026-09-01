use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::store::AttachmentStore;
use super::types::{
    AttachmentError, CleanupChatSessionReceipt, CleanupChatSessionRequest, SessionId,
};

const STALE_ATTACHMENT_AGE: Duration = Duration::from_secs(24 * 60 * 60);

pub(super) trait CleanupFileSystem {
    fn remove_dir_all(&self, directory: &Path) -> std::io::Result<()>;
    fn cleanup_failed(&self, directory: &Path, error: &std::io::Error);
    fn sweep_failed(&self, directory: &Path, error: &std::io::Error);
}

struct StdCleanupFileSystem;

impl CleanupFileSystem for StdCleanupFileSystem {
    fn remove_dir_all(&self, directory: &Path) -> std::io::Result<()> {
        std::fs::remove_dir_all(directory)
    }

    fn cleanup_failed(&self, directory: &Path, error: &std::io::Error) {
        eprintln!(
            "chat attachment cleanup failed for {}: {error}",
            directory.display()
        );
    }

    fn sweep_failed(&self, directory: &Path, error: &std::io::Error) {
        eprintln!(
            "chat attachment stale sweep failed for {}: {error}",
            directory.display()
        );
    }
}

impl AttachmentStore {
    pub(crate) fn cleanup_session(
        &self,
        cache_root: &Path,
        request: CleanupChatSessionRequest,
    ) -> Result<CleanupChatSessionReceipt, AttachmentError> {
        self.cleanup_session_with_file_system(cache_root, request, &StdCleanupFileSystem)
    }

    fn cleanup_session_with_file_system<F: CleanupFileSystem>(
        &self,
        cache_root: &Path,
        request: CleanupChatSessionRequest,
        file_system: &F,
    ) -> Result<CleanupChatSessionReceipt, AttachmentError> {
        let session_id = SessionId::parse(request.session_id)?;
        let directories = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| AttachmentError::StatePoisoned)?;
            let ids = state
                .records
                .iter()
                .filter_map(|(id, record)| (record.session_id == session_id).then_some(id.clone()))
                .collect::<Vec<_>>();
            let mut directories = Vec::with_capacity(ids.len());
            for id in ids {
                if let Some(record) = state.records.remove(&id) {
                    if record.directory.starts_with(cache_root) {
                        directories.push(record.directory);
                    }
                }
            }
            state.sessions.remove(&session_id);
            directories
        };
        let mut removed = 0;
        for directory in &directories {
            match remove_cache_dir(file_system, directory) {
                Ok(()) => removed += 1,
                Err(error) => file_system.cleanup_failed(directory, &error),
            }
        }
        Ok(CleanupChatSessionReceipt { removed })
    }
}

pub(super) fn sweep_stale_at(cache_root: &Path, now: SystemTime) -> Result<usize, AttachmentError> {
    sweep_stale_with_file_system(cache_root, now, &StdCleanupFileSystem)
}

fn sweep_stale_with_file_system<F: CleanupFileSystem>(
    cache_root: &Path,
    now: SystemTime,
    file_system: &F,
) -> Result<usize, AttachmentError> {
    let entries = match std::fs::read_dir(cache_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(AttachmentError::Io(error)),
    };
    let mut stale = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let modified = entry.metadata()?.modified()?;
        if is_stale(modified, now) {
            stale.push(entry.path());
        }
    }
    remove_stale_dirs(file_system, stale)
}

fn remove_stale_dirs<F: CleanupFileSystem>(
    file_system: &F,
    directories: Vec<PathBuf>,
) -> Result<usize, AttachmentError> {
    let mut removed = 0;
    for directory in directories {
        match remove_cache_dir(file_system, &directory) {
            Ok(()) => removed += 1,
            Err(error) => file_system.sweep_failed(&directory, &error),
        }
    }
    Ok(removed)
}

fn is_stale(modified: SystemTime, now: SystemTime) -> bool {
    match now.duration_since(modified) {
        Ok(age) => age >= STALE_ATTACHMENT_AGE,
        Err(_) => false,
    }
}

fn remove_cache_dir(
    file_system: &impl CleanupFileSystem,
    directory: &Path,
) -> Result<(), std::io::Error> {
    match file_system.remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
#[path = "tests/cleanup.rs"]
mod tests;
