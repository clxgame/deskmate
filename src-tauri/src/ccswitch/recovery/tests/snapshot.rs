use std::fs;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use sha2::{Digest, Sha256};

use super::super::key_store::KEYRING_SERVICE;
use super::super::*;
use super::fixtures::{FakeKeyStore, TestTree, IMPORTED, ORIGINAL};

#[test]
fn system_key_store_uses_yume_namespace_without_legacy_lookup() {
    let legacy_brand = ["desk", "mate"].join("");
    assert_eq!(KEYRING_SERVICE, "com.yume.desktop.ccswitch-recovery");
    assert!(!KEYRING_SERVICE.contains(&legacy_brand));
}

#[test]
fn snapshot_is_authenticated_ciphertext_with_key_outside_manifest() {
    let canary = format!("yume-test-canary-{}", uuid::Uuid::new_v4());
    let key_field = format!("{}{}", "api", "Key");
    let original = format!(
        r#"{{
  "$schema": "https://opencode.ai/config.json",
  "theme": "keep-me",
  "provider": {{"old": {{"options": {{"{key_field}": "{canary}"}}}}}}
}}"#
    );
    let auth = format!(r#"{{"old":{{"type":"api","key":"{canary}"}}}}"#);
    let tree = TestTree::new_with_auth(Some(original.as_bytes()), auth.as_bytes());
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");

    let handle = manager.create_snapshot().expect("snapshot succeeds");

    let manifest = fs::read(manager.snapshot_path(&handle.id)).expect("read manifest");
    let manifest_text = String::from_utf8(manifest).expect("manifest is utf-8 JSON");
    assert!(manifest_text.contains("xchacha20poly1305-v1"));
    assert!(!manifest_text.contains(&canary));
    assert!(!manifest_text.contains(&key_field));
    assert!(!manifest_text.contains(&BASE64.encode(manager.keys().key(&handle.id))));
    assert!(manager.keys().contains(&handle.id));
    assert_eq!(
        fs::read_dir(manager.snapshots_dir())
            .expect("list snapshots")
            .count(),
        1,
        "atomic creation must leave no temporary artifact"
    );
}

#[test]
fn corrupted_snapshot_is_rejected_without_plaintext_output() {
    let tree = TestTree::new(Some(ORIGINAL));
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let handle = manager.create_snapshot().expect("snapshot succeeds");
    fs::write(tree.config_path(), IMPORTED).expect("simulate importer");
    manager
        .retain_observation(&handle.id, manager.observe_files().expect("observe import"))
        .expect("persist post-import hash");
    let path = manager.snapshot_path(&handle.id);
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).expect("read manifest")).expect("parse manifest");
    envelope["ciphertext"] = serde_json::Value::String("AAAA".into());
    fs::write(
        &path,
        serde_json::to_vec(&envelope).expect("serialize corruption"),
    )
    .expect("write corruption");

    let error = manager
        .restore(&handle.id)
        .expect_err("corrupted snapshot must fail");

    assert!(matches!(
        error,
        RecoveryError::InvalidSnapshot | RecoveryError::AuthenticationFailed
    ));
    assert_eq!(fs::read(tree.config_path()).expect("read config"), IMPORTED);
}

#[test]
fn tampered_stale_guard_is_rejected_by_authenticated_metadata() {
    let tree = TestTree::new(Some(ORIGINAL));
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let handle = manager.create_snapshot().expect("snapshot succeeds");
    fs::write(tree.config_path(), IMPORTED).expect("simulate importer");
    manager
        .retain_observation(&handle.id, manager.observe_files().expect("observe import"))
        .expect("persist post-import hash");
    let forged_current = br#"{"provider":{"forged":{}}}"#;
    fs::write(tree.config_path(), forged_current).expect("simulate forged current config");
    let forged_hash = format!("{:x}", Sha256::digest(forged_current));
    let path = manager.snapshot_path(&handle.id);
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).expect("read manifest")).expect("parse manifest");
    envelope["lastObservedConfig"]["sha256"] = serde_json::Value::String(forged_hash);
    fs::write(
        &path,
        serde_json::to_vec(&envelope).expect("serialize tampering"),
    )
    .expect("write tampering");

    let error = manager
        .restore(&handle.id)
        .expect_err("tampered guard must fail authentication");

    assert_eq!(error, RecoveryError::AuthenticationFailed);
    assert_eq!(
        fs::read(tree.config_path()).expect("read config"),
        forged_current
    );
    assert!(manager.has_snapshot(&handle.id));
}

#[test]
fn snapshot_schema_and_algorithm_allowlist_reject_tampering() {
    let tree = TestTree::new(Some(ORIGINAL));
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let handle = manager.create_snapshot().expect("snapshot succeeds");
    let path = manager.snapshot_path(&handle.id);
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).expect("read manifest")).expect("parse manifest");
    envelope["schemaVersion"] = serde_json::Value::from(2);
    envelope["algorithm"] = serde_json::Value::String("plaintext-v0".into());
    envelope["unexpectedField"] = serde_json::Value::Bool(true);
    fs::write(
        &path,
        serde_json::to_vec(&envelope).expect("serialize invalid schema"),
    )
    .expect("write invalid schema");

    let error = manager
        .complete(&handle.id, RecoveryCompletion::Verified)
        .expect_err("schema tampering must fail");

    assert_eq!(error, RecoveryError::InvalidSnapshot);
    assert!(manager.has_snapshot(&handle.id));
    assert!(manager.keys().contains(&handle.id));
}
