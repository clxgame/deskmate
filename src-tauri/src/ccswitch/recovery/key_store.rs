use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

use super::{RecoveryError, SnapshotId};

pub(crate) const KEYRING_SERVICE: &str = "com.yume.desktop.ccswitch-recovery";

pub trait RecoveryKeyStore {
    fn store(&self, id: &SnapshotId, key: &[u8]) -> Result<(), RecoveryError>;
    fn load(&self, id: &SnapshotId) -> Result<Vec<u8>, RecoveryError>;
    fn delete(&self, id: &SnapshotId) -> Result<(), RecoveryError>;
}

#[derive(Clone, Copy, Default)]
pub struct SystemRecoveryKeyStore;

impl SystemRecoveryKeyStore {
    fn entry(id: &SnapshotId) -> Result<keyring::Entry, RecoveryError> {
        let user = format!("snapshot:{}", id.as_str());
        keyring::Entry::new(KEYRING_SERVICE, &user).map_err(|_| RecoveryError::KeyStoreFailed)
    }
}

impl RecoveryKeyStore for SystemRecoveryKeyStore {
    fn store(&self, id: &SnapshotId, key: &[u8]) -> Result<(), RecoveryError> {
        let encoded = BASE64.encode(key);
        let result = Self::entry(id)?
            .set_password(&encoded)
            .map_err(|_| RecoveryError::KeyStoreFailed);
        let mut encoded = encoded.into_bytes();
        encoded.fill(0);
        result
    }

    fn load(&self, id: &SnapshotId) -> Result<Vec<u8>, RecoveryError> {
        let encoded = match Self::entry(id)?.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Err(RecoveryError::KeyUnavailable),
            Err(_) => return Err(RecoveryError::KeyStoreFailed),
        };
        let mut encoded = encoded.into_bytes();
        let decoded = BASE64
            .decode(&encoded)
            .map_err(|_| RecoveryError::KeyUnavailable);
        encoded.fill(0);
        decoded
    }

    fn delete(&self, id: &SnapshotId) -> Result<(), RecoveryError> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(RecoveryError::KeyStoreFailed),
        }
    }
}
