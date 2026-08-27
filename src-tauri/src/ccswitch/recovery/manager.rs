use std::path::PathBuf;

use super::crypto::{
    decrypt_original, encrypted_snapshot_envelope, reencrypt_envelope, SnapshotEnvelope,
};
use super::key_store::RecoveryKeyStore;
use super::paths::{
    metadata_is_link, observe_files, prepare_directory_root, read_observed_file,
    read_observed_path, validate_allowed_path, OpenCodeFile, OpenCodePaths,
};
use super::store::{atomic_write, create_synced_temp, replace_if_current, sync_directory};
use super::{
    DiscardConfirmation, FileObservation, ObservedFiles, RecoveryCompletion, RecoveryError,
    RecoveryLocations, RecoveryRetention, SnapshotHandle, SnapshotId, MAX_MANIFEST_BYTES,
    SNAPSHOT_DIRECTORY,
};

pub struct RecoveryManager<K> {
    paths: OpenCodePaths,
    snapshots_dir: PathBuf,
    keys: K,
}

impl<K: RecoveryKeyStore> RecoveryManager<K> {
    pub fn new(locations: RecoveryLocations, keys: K) -> Result<Self, RecoveryError> {
        let paths = OpenCodePaths::from_home(&locations.home)?;
        let app_data = prepare_directory_root(&locations.app_data)?;
        let snapshots_dir = app_data.join(SNAPSHOT_DIRECTORY);
        std::fs::create_dir_all(&snapshots_dir).map_err(|_| RecoveryError::WriteFailed)?;
        validate_allowed_path(&app_data, &snapshots_dir)?;
        Ok(Self {
            paths,
            snapshots_dir,
            keys,
        })
    }

    pub fn paths(&self) -> &OpenCodePaths {
        &self.paths
    }

    pub fn create_snapshot(&self) -> Result<SnapshotHandle, RecoveryError> {
        let config = read_observed_file(&self.paths, OpenCodeFile::Config)?;
        let auth = read_observed_file(&self.paths, OpenCodeFile::Auth)?;
        let original = ObservedFiles {
            config: config.observation.clone(),
            auth: auth.observation,
        };
        let id = SnapshotId::generate();
        let plaintext = match config.bytes.as_deref() {
            Some(bytes) => bytes,
            None => &[],
        };
        let (envelope, mut key) = encrypted_snapshot_envelope(&id, original.clone(), plaintext)?;
        let serialized =
            serde_json::to_vec(&envelope).map_err(|_| RecoveryError::InvalidSnapshot)?;
        let target = self.snapshot_path(&id);
        let pending = create_synced_temp(&self.snapshots_dir, "snapshot", &serialized)?;
        if let Err(error) = self.keys.store(&id, key.as_ref()) {
            key.0.fill(0);
            return Err(error);
        }
        key.0.fill(0);
        if std::fs::rename(pending.path(), &target).is_err() {
            self.keys.delete(&id)?;
            return Err(RecoveryError::WriteFailed);
        }
        pending.commit();
        sync_directory(&self.snapshots_dir)?;
        Ok(SnapshotHandle { id, original })
    }

    pub fn observe_files(&self) -> Result<ObservedFiles, RecoveryError> {
        observe_files(&self.paths)
    }

    pub fn retain_observation(
        &self,
        id: &SnapshotId,
        observed: ObservedFiles,
    ) -> Result<(), RecoveryError> {
        let mut envelope = self.load_envelope(id)?;
        let mut plaintext = decrypt_original(&self.keys, id, &envelope)?;
        envelope.last_observed_config = Some(observed.config);
        reencrypt_envelope(&self.keys, id, &mut envelope, &plaintext)?;
        plaintext.fill(0);
        self.write_envelope(id, &envelope)
    }

    pub fn complete(
        &self,
        id: &SnapshotId,
        completion: RecoveryCompletion,
    ) -> Result<RecoveryRetention, RecoveryError> {
        let envelope = self.load_envelope(id)?;
        let mut plaintext = decrypt_original(&self.keys, id, &envelope)?;
        plaintext.fill(0);
        match completion {
            RecoveryCompletion::Verified => {
                self.destroy(id)?;
                Ok(RecoveryRetention::Destroyed)
            }
            RecoveryCompletion::Cancelled(observed) | RecoveryCompletion::TimedOut(observed) => {
                self.complete_interrupted(id, envelope, observed)
            }
            RecoveryCompletion::ReadFailed(observed) => {
                if let Some(observed) = observed {
                    self.retain_observation(id, observed)?;
                }
                Ok(RecoveryRetention::Retained)
            }
        }
    }

    pub fn discard(
        &self,
        id: &SnapshotId,
        confirmation: DiscardConfirmation,
    ) -> Result<(), RecoveryError> {
        match confirmation {
            DiscardConfirmation::Unconfirmed => Err(RecoveryError::ConfirmationRequired),
            DiscardConfirmation::Confirmed => self.destroy(id),
        }
    }

    pub fn restore(&self, id: &SnapshotId) -> Result<FileObservation, RecoveryError> {
        self.restore_with_hook(id, || {}, || {})
    }

    pub fn has_snapshot(&self, id: &SnapshotId) -> bool {
        self.snapshot_path(id).is_file()
    }

    fn complete_interrupted(
        &self,
        id: &SnapshotId,
        envelope: SnapshotEnvelope,
        observed: Option<ObservedFiles>,
    ) -> Result<RecoveryRetention, RecoveryError> {
        match observed {
            Some(observed) if observed == envelope.original => {
                self.destroy(id)?;
                Ok(RecoveryRetention::Destroyed)
            }
            Some(observed) => {
                self.retain_observation(id, observed)?;
                Ok(RecoveryRetention::Retained)
            }
            None => Ok(RecoveryRetention::Retained),
        }
    }

    pub(super) fn restore_with_hook(
        &self,
        id: &SnapshotId,
        before_commit: impl FnOnce(),
        before_replace: impl FnOnce(),
    ) -> Result<FileObservation, RecoveryError> {
        let envelope = self.load_envelope(id)?;
        let mut plaintext = decrypt_original(&self.keys, id, &envelope)?;
        let Some(expected_current) = envelope.last_observed_config.as_ref() else {
            plaintext.fill(0);
            return Err(stale_error(None));
        };
        let observed = self.observe_files()?;
        if &observed.config != expected_current || observed.auth != envelope.original.auth {
            plaintext.fill(0);
            return Err(stale_error(observed.config.hash().map(str::to_owned)));
        }
        let pending = match envelope.original.config {
            FileObservation::Present { .. } => Some(create_synced_temp(
                self.paths
                    .config()
                    .parent()
                    .ok_or(RecoveryError::PathRejected)?,
                "restore",
                &plaintext,
            )?),
            FileObservation::Missing => None,
        };
        plaintext.fill(0);
        before_commit();
        validate_allowed_path(self.paths.home(), self.paths.config())?;
        replace_if_current(self.paths.config(), pending, |claimed_path| {
            let final_config = match claimed_path {
                Some(path) => read_observed_path(self.paths.home(), path)?.observation,
                None => FileObservation::Missing,
            };
            let final_auth = read_observed_file(&self.paths, OpenCodeFile::Auth)?.observation;
            if &final_config != expected_current || final_auth != envelope.original.auth {
                return Err(stale_error(final_config.hash().map(str::to_owned)));
            }
            before_replace();
            Ok(())
        })?;
        sync_directory(
            self.paths
                .config()
                .parent()
                .ok_or(RecoveryError::PathRejected)?,
        )?;
        self.destroy(id)?;
        Ok(envelope.original.config)
    }

    fn load_envelope(&self, id: &SnapshotId) -> Result<SnapshotEnvelope, RecoveryError> {
        let path = self.snapshot_path(id);
        validate_allowed_path(&self.snapshots_dir, &path)?;
        let metadata = std::fs::symlink_metadata(&path).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => RecoveryError::SnapshotMissing,
            _ => RecoveryError::ReadFailed,
        })?;
        if !metadata.is_file() || metadata_is_link(&metadata) || metadata.len() > MAX_MANIFEST_BYTES
        {
            return Err(RecoveryError::InvalidSnapshot);
        }
        let bytes = std::fs::read(&path).map_err(|_| RecoveryError::ReadFailed)?;
        let envelope: SnapshotEnvelope =
            serde_json::from_slice(&bytes).map_err(|_| RecoveryError::InvalidSnapshot)?;
        envelope.validate(id)?;
        Ok(envelope)
    }

    fn write_envelope(
        &self,
        id: &SnapshotId,
        envelope: &SnapshotEnvelope,
    ) -> Result<(), RecoveryError> {
        envelope.validate(id)?;
        let bytes = serde_json::to_vec(envelope).map_err(|_| RecoveryError::InvalidSnapshot)?;
        atomic_write(&self.snapshot_path(id), &bytes)
    }

    fn destroy(&self, id: &SnapshotId) -> Result<(), RecoveryError> {
        self.keys.delete(id)?;
        match std::fs::remove_file(self.snapshot_path(id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(RecoveryError::WriteFailed),
        }
    }

    pub(super) fn snapshot_path(&self, id: &SnapshotId) -> PathBuf {
        self.snapshots_dir.join(format!("{}.json", id.as_str()))
    }

    #[cfg(test)]
    pub(super) fn snapshots_dir(&self) -> &std::path::Path {
        &self.snapshots_dir
    }

    #[cfg(test)]
    pub(super) fn keys(&self) -> &K {
        &self.keys
    }
}

fn stale_error(current_hash: Option<String>) -> RecoveryError {
    RecoveryError::StaleConflict { current_hash }
}
