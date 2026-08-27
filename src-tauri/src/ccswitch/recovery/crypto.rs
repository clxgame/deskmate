use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chacha20poly1305::{
    aead::{Aead, Generate, Key, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};

use super::{
    FileObservation, ObservedFiles, RecoveryError, RecoveryKeyStore, SnapshotId,
    AUTH_RELATIVE_PATH, CONFIG_RELATIVE_PATH, KEY_BYTES, MAX_MANIFEST_BYTES, SNAPSHOT_ALGORITHM,
    SNAPSHOT_SCHEMA_VERSION,
};

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SnapshotEnvelope {
    pub(crate) schema_version: u8,
    pub(crate) algorithm: String,
    pub(crate) snapshot_id: String,
    pub(crate) config_relative_path: String,
    pub(crate) auth_relative_path: String,
    pub(crate) original: ObservedFiles,
    pub(crate) last_observed_config: Option<FileObservation>,
    pub(crate) nonce: String,
    pub(crate) ciphertext: String,
}

impl SnapshotEnvelope {
    pub(crate) fn validate(&self, expected_id: &SnapshotId) -> Result<(), RecoveryError> {
        if self.schema_version != SNAPSHOT_SCHEMA_VERSION
            || self.algorithm != SNAPSHOT_ALGORITHM
            || self.snapshot_id != expected_id.as_str()
            || self.config_relative_path != CONFIG_RELATIVE_PATH
            || self.auth_relative_path != AUTH_RELATIVE_PATH
            || !self.original.config.is_valid()
            || !self.original.auth.is_valid()
            || self
                .last_observed_config
                .as_ref()
                .is_some_and(|observation| !observation.is_valid())
        {
            return Err(RecoveryError::InvalidSnapshot);
        }
        if self.nonce.len() > 64 || self.ciphertext.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(RecoveryError::InvalidSnapshot);
        }
        let nonce = BASE64
            .decode(&self.nonce)
            .map_err(|_| RecoveryError::InvalidSnapshot)?;
        let ciphertext = BASE64
            .decode(&self.ciphertext)
            .map_err(|_| RecoveryError::InvalidSnapshot)?;
        if nonce.len() != 24 || ciphertext.len() < 16 {
            return Err(RecoveryError::InvalidSnapshot);
        }
        Ok(())
    }

    fn associated_data(&self) -> Vec<u8> {
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}",
            self.schema_version,
            self.algorithm,
            self.snapshot_id,
            self.config_relative_path,
            self.auth_relative_path,
            self.original.config.aad_token(),
            self.original.auth.aad_token(),
            self.last_observed_config
                .as_ref()
                .map_or("unobserved", FileObservation::aad_token)
        )
        .into_bytes()
    }
}

pub(crate) fn encrypted_snapshot_envelope(
    id: &SnapshotId,
    original: ObservedFiles,
    plaintext: &[u8],
) -> Result<(SnapshotEnvelope, Key<XChaCha20Poly1305>), RecoveryError> {
    let key = Key::<XChaCha20Poly1305>::generate();
    let nonce = XNonce::generate();
    let mut envelope = SnapshotEnvelope {
        schema_version: SNAPSHOT_SCHEMA_VERSION,
        algorithm: SNAPSHOT_ALGORITHM.to_owned(),
        snapshot_id: id.as_str().to_owned(),
        config_relative_path: CONFIG_RELATIVE_PATH.to_owned(),
        auth_relative_path: AUTH_RELATIVE_PATH.to_owned(),
        original,
        last_observed_config: None,
        nonce: String::new(),
        ciphertext: String::new(),
    };
    let cipher = XChaCha20Poly1305::new(&key);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &envelope.associated_data(),
            },
        )
        .map_err(|_| RecoveryError::AuthenticationFailed)?;
    envelope.nonce = BASE64.encode(nonce.0);
    envelope.ciphertext = BASE64.encode(ciphertext);
    Ok((envelope, key))
}

pub(crate) fn decrypt_original(
    keys: &impl RecoveryKeyStore,
    id: &SnapshotId,
    envelope: &SnapshotEnvelope,
) -> Result<Vec<u8>, RecoveryError> {
    let nonce = BASE64
        .decode(&envelope.nonce)
        .map_err(|_| RecoveryError::InvalidSnapshot)?;
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|_| RecoveryError::InvalidSnapshot)?;
    let nonce = XNonce::try_from(nonce.as_slice()).map_err(|_| RecoveryError::InvalidSnapshot)?;
    let mut key = keys.load(id)?;
    if key.len() != KEY_BYTES {
        key.fill(0);
        return Err(RecoveryError::KeyUnavailable);
    }
    let cipher =
        XChaCha20Poly1305::new_from_slice(&key).map_err(|_| RecoveryError::KeyUnavailable)?;
    key.fill(0);
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &ciphertext,
                aad: &envelope.associated_data(),
            },
        )
        .map_err(|_| RecoveryError::AuthenticationFailed)
}

pub(crate) fn reencrypt_envelope(
    keys: &impl RecoveryKeyStore,
    id: &SnapshotId,
    envelope: &mut SnapshotEnvelope,
    plaintext: &[u8],
) -> Result<(), RecoveryError> {
    let mut key = keys.load(id)?;
    if key.len() != KEY_BYTES {
        key.fill(0);
        return Err(RecoveryError::KeyUnavailable);
    }
    let cipher =
        XChaCha20Poly1305::new_from_slice(&key).map_err(|_| RecoveryError::KeyUnavailable)?;
    key.fill(0);
    let nonce = XNonce::generate();
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &envelope.associated_data(),
            },
        )
        .map_err(|_| RecoveryError::AuthenticationFailed)?;
    envelope.nonce = BASE64.encode(nonce.0);
    envelope.ciphertext = BASE64.encode(ciphertext);
    Ok(())
}
