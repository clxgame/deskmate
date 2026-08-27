use std::fs;

use super::super::paths::validate_allowed_path;
use super::super::*;
use super::fixtures::{create_directory_link, FakeKeyStore, TestTree, ORIGINAL};

#[test]
fn traversal_out_of_home_and_link_components_fail_before_reading() {
    let tree = TestTree::new(Some(ORIGINAL));
    let outside = tree.root.join("outside.json");
    fs::write(&outside, b"outside").expect("write outside fixture");
    let traversing = tree.home.join(".config/../../outside.json");

    assert_eq!(
        validate_allowed_path(&tree.home, &outside),
        Err(RecoveryError::PathRejected)
    );
    assert_eq!(
        validate_allowed_path(&tree.home, &traversing),
        Err(RecoveryError::PathRejected)
    );

    fs::remove_dir_all(tree.home.join(".config")).expect("remove real config dir");
    create_directory_link(tree.root.as_path(), &tree.home.join(".config"));

    let linked = OpenCodePaths::from_home(&tree.home);

    assert_eq!(linked.err(), Some(RecoveryError::PathRejected));
}

#[test]
fn manager_initializes_recovery_under_app_data_only() {
    let tree = TestTree::new(Some(ORIGINAL));

    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let app_data = fs::canonicalize(tree.root.join("app-data")).expect("canonical app-data");

    assert!(manager.snapshots_dir().starts_with(app_data));
}
