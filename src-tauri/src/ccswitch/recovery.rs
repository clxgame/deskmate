mod crypto;
mod key_store;
mod manager;
mod paths;
mod store;
mod types;

#[cfg(test)]
mod tests;

pub use key_store::{RecoveryKeyStore, SystemRecoveryKeyStore};
pub use manager::RecoveryManager;
pub use paths::{observe_files, OpenCodePaths};
pub use types::{
    DiscardConfirmation, FileObservation, ObservedFiles, RecoveryCompletion, RecoveryError,
    RecoveryLocations, RecoveryRetention, SnapshotHandle, SnapshotId,
};

pub(crate) use paths::{read_observed_file, OpenCodeFile};
pub(crate) use store::replace_file_if_unchanged;

const SNAPSHOT_SCHEMA_VERSION: u8 = 1;
const SNAPSHOT_ALGORITHM: &str = "xchacha20poly1305-v1";
const CONFIG_RELATIVE_PATH: &str = ".config/opencode/opencode.json";
const AUTH_RELATIVE_PATH: &str = ".local/share/opencode/auth.json";
const SNAPSHOT_DIRECTORY: &str = "ccswitch-recovery";
const MAX_EXTERNAL_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 12 * 1024 * 1024;
pub const KEY_BYTES: usize = 32;
