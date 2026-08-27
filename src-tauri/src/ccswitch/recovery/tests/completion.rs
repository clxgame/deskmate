use std::fs;

use super::super::*;
use super::fixtures::{FakeKeyStore, TestTree, IMPORTED, ORIGINAL};

#[test]
fn completion_cleans_only_terminal_unchanged_or_verified_snapshots() {
    let unchanged_tree = TestTree::new(Some(ORIGINAL));
    let unchanged = RecoveryManager::new(unchanged_tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let cancelled = unchanged.create_snapshot().expect("snapshot succeeds");

    let cancelled_result = unchanged
        .complete(
            &cancelled.id,
            RecoveryCompletion::Cancelled(Some(
                unchanged.observe_files().expect("observe unchanged"),
            )),
        )
        .expect("cancel completion succeeds");

    assert_eq!(cancelled_result, RecoveryRetention::Destroyed);
    assert!(!unchanged.has_snapshot(&cancelled.id));

    let unchanged_timeout = unchanged.create_snapshot().expect("snapshot succeeds");
    let unchanged_timeout_result = unchanged
        .complete(
            &unchanged_timeout.id,
            RecoveryCompletion::TimedOut(Some(
                unchanged.observe_files().expect("observe unchanged"),
            )),
        )
        .expect("unchanged timeout completion succeeds");

    assert_eq!(unchanged_timeout_result, RecoveryRetention::Destroyed);
    assert!(!unchanged.has_snapshot(&unchanged_timeout.id));

    let changed_tree = TestTree::new(Some(ORIGINAL));
    let changed = RecoveryManager::new(changed_tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let timed_out = changed.create_snapshot().expect("snapshot succeeds");
    fs::write(changed_tree.config_path(), IMPORTED).expect("simulate importer");

    let timed_out_result = changed
        .complete(
            &timed_out.id,
            RecoveryCompletion::TimedOut(Some(changed.observe_files().expect("observe changed"))),
        )
        .expect("timeout completion succeeds");

    assert_eq!(timed_out_result, RecoveryRetention::Retained);
    assert!(changed.has_snapshot(&timed_out.id));

    let cancelled_changed = changed
        .complete(
            &timed_out.id,
            RecoveryCompletion::Cancelled(Some(changed.observe_files().expect("observe changed"))),
        )
        .expect("changed cancel completion succeeds");

    assert_eq!(cancelled_changed, RecoveryRetention::Retained);
    assert!(changed.has_snapshot(&timed_out.id));

    let read_failure = changed
        .complete(&timed_out.id, RecoveryCompletion::ReadFailed(None))
        .expect("read failure completion succeeds");
    assert_eq!(read_failure, RecoveryRetention::Retained);

    let verified = changed
        .complete(&timed_out.id, RecoveryCompletion::Verified)
        .expect("verified completion succeeds");

    assert_eq!(verified, RecoveryRetention::Destroyed);
    assert!(!changed.has_snapshot(&timed_out.id));
}

#[test]
fn explicit_discard_requires_confirmation() {
    let tree = TestTree::new(Some(ORIGINAL));
    let manager = RecoveryManager::new(tree.locations(), FakeKeyStore::default())
        .expect("manager resolves safe paths");
    let handle = manager.create_snapshot().expect("snapshot succeeds");

    let error = manager
        .discard(&handle.id, DiscardConfirmation::Unconfirmed)
        .expect_err("discard must require confirmation");

    assert_eq!(error, RecoveryError::ConfirmationRequired);
    assert!(manager.has_snapshot(&handle.id));

    manager
        .discard(&handle.id, DiscardConfirmation::Confirmed)
        .expect("confirmed discard succeeds");

    assert!(!manager.has_snapshot(&handle.id));
    assert!(!manager.keys().contains(&handle.id));
}
