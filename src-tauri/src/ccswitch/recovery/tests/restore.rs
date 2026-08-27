use std::fs;

use super::super::*;
use super::fixtures::{FakeKeyStore, TestTree, IMPORTED, ORIGINAL};

#[test]
fn restore_rejects_wrong_key_without_touching_changed_config() {
    let tree = TestTree::new(Some(ORIGINAL));
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let handle = manager.create_snapshot().expect("snapshot succeeds");
    fs::write(tree.config_path(), IMPORTED).expect("simulate importer");
    manager
        .retain_observation(&handle.id, manager.observe_files().expect("observe import"))
        .expect("persist post-import hash");
    manager.keys().replace(&handle.id, vec![7; KEY_BYTES]);

    let error = manager
        .restore(&handle.id)
        .expect_err("wrong key must fail");

    assert_eq!(error, RecoveryError::AuthenticationFailed);
    assert_eq!(fs::read(tree.config_path()).expect("read config"), IMPORTED);
    assert!(manager.has_snapshot(&handle.id));
}

#[test]
fn restore_is_byte_identical_and_destroys_recovery_material() {
    let tree = TestTree::new(Some(ORIGINAL));
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let handle = manager.create_snapshot().expect("snapshot succeeds");
    fs::write(tree.config_path(), IMPORTED).expect("simulate importer");
    manager
        .retain_observation(&handle.id, manager.observe_files().expect("observe import"))
        .expect("persist post-import hash");

    let restored = manager.restore(&handle.id).expect("restore succeeds");

    assert_eq!(
        fs::read(tree.config_path()).expect("read restored"),
        ORIGINAL
    );
    assert_eq!(restored, handle.original.config);
    assert!(!manager.has_snapshot(&handle.id));
    assert!(!manager.keys().contains(&handle.id));
}

#[test]
fn restore_refuses_edit_after_final_hash_check_before_replace_without_overwriting_it() {
    // Given
    let tree = TestTree::new(Some(ORIGINAL));
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let handle = manager.create_snapshot().expect("snapshot succeeds");
    fs::write(tree.config_path(), IMPORTED).expect("simulate importer");
    manager
        .retain_observation(&handle.id, manager.observe_files().expect("observe import"))
        .expect("persist post-import hash");
    let concurrent = br#"{"provider":{"other":{}}}"#;

    // When
    let error = manager
        .restore_with_hook(
            &handle.id,
            || {},
            || {
                fs::write(tree.config_path(), concurrent).expect("simulate concurrent writer");
            },
        )
        .expect_err("post-check concurrent edit must fail");

    // Then
    assert!(matches!(error, RecoveryError::StaleConflict { .. }));
    assert_eq!(
        fs::read(tree.config_path()).expect("read concurrent"),
        concurrent
    );
    assert!(manager.has_snapshot(&handle.id));
    assert!(manager.keys().contains(&handle.id));
    assert_eq!(
        fs::read_dir(tree.config_path().parent().expect("config parent"))
            .expect("list config parent")
            .count(),
        1,
        "stale restore must remove unpublished restore/claim files"
    );
}
