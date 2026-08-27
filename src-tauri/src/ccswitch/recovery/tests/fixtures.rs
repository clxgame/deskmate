use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::super::*;

pub(super) const ORIGINAL: &[u8] = br#"{
  "$schema": "https://opencode.ai/config.json",
  "theme": "keep-me",
  "provider": {"old": {"options": {"enabled": true}}}
}"#;
pub(super) const AUTH: &[u8] = br#"{"old":{"type":"api","status":"fixture"}}"#;
pub(super) const IMPORTED: &[u8] = br#"{"provider":{"generated":{"options":{"baseURL":"https://api.example.test/v1"},"models":{"model-a":{"name":"Model A"}}}}}"#;

pub(super) struct TestTree {
    pub(super) root: PathBuf,
    pub(super) home: PathBuf,
    app_data: PathBuf,
}

impl TestTree {
    pub(super) fn new(original: Option<&[u8]>) -> Self {
        Self::new_with_auth(original, AUTH)
    }

    pub(super) fn new_with_auth(original: Option<&[u8]>, auth: &[u8]) -> Self {
        let root = std::env::temp_dir().join(format!(
            "yume-ccswitch-recovery-test-{}",
            uuid::Uuid::new_v4()
        ));
        let home = root.join("home");
        let app_data = root.join("app-data");
        fs::create_dir_all(home.join(".config/opencode")).expect("create config fixture");
        fs::create_dir_all(home.join(".local/share/opencode")).expect("create auth fixture");
        fs::create_dir_all(&app_data).expect("create app-data fixture");
        if let Some(bytes) = original {
            fs::write(home.join(".config/opencode/opencode.json"), bytes)
                .expect("write config fixture");
        }
        fs::write(home.join(".local/share/opencode/auth.json"), auth).expect("write auth fixture");
        Self {
            root,
            home,
            app_data,
        }
    }

    pub(super) fn locations(&self) -> RecoveryLocations {
        RecoveryLocations::new(self.home.clone(), self.app_data.clone())
    }

    pub(super) fn config_path(&self) -> PathBuf {
        self.home.join(".config/opencode/opencode.json")
    }
}

impl Drop for TestTree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Default)]
pub(super) struct FakeKeyStore {
    values: RefCell<HashMap<String, Vec<u8>>>,
}

impl FakeKeyStore {
    pub(super) fn replace(&self, id: &SnapshotId, key: Vec<u8>) {
        self.values.borrow_mut().insert(id.as_str().to_owned(), key);
    }

    pub(super) fn contains(&self, id: &SnapshotId) -> bool {
        self.values.borrow().contains_key(id.as_str())
    }

    pub(super) fn key(&self, id: &SnapshotId) -> Vec<u8> {
        self.values
            .borrow()
            .get(id.as_str())
            .cloned()
            .expect("test key exists")
    }
}

impl RecoveryKeyStore for FakeKeyStore {
    fn store(&self, id: &SnapshotId, key: &[u8]) -> Result<(), RecoveryError> {
        self.values
            .borrow_mut()
            .insert(id.as_str().to_owned(), key.to_vec());
        Ok(())
    }

    fn load(&self, id: &SnapshotId) -> Result<Vec<u8>, RecoveryError> {
        self.values
            .borrow()
            .get(id.as_str())
            .cloned()
            .ok_or(RecoveryError::KeyUnavailable)
    }

    fn delete(&self, id: &SnapshotId) -> Result<(), RecoveryError> {
        self.values.borrow_mut().remove(id.as_str());
        Ok(())
    }
}

#[cfg(unix)]
pub(super) fn create_directory_link(target: &Path, link: &Path) {
    std::os::unix::fs::symlink(target, link).expect("create directory symlink");
}

#[cfg(windows)]
pub(super) fn create_directory_link(target: &Path, link: &Path) {
    std::os::windows::fs::symlink_dir(target, link).expect("create directory reparse point");
}
