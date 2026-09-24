use super::*;
use std::collections::HashSet;

fn native(directory: &str, id: &str) -> CatalogIdentity {
    CatalogIdentity::Native {
        sidecar_id: SIDECAR_ID.into(),
        directory: directory.into(),
        session_id: id.into(),
    }
}

pub(super) fn fixture(index: u64) -> CatalogEntry {
    CatalogEntry {
        identity: native("C:/projects/alpha", &format!("ses_{index}")),
        title: format!("Synthetic conversation {index}"),
        user_title: None,
        source: ConversationSource::LightChat,
        created: index,
        updated: index,
        pinned: false,
        archived: false,
        availability: Availability::Available,
        ownership: Ownership::Unowned,
        runtime: RuntimeState::Idle,
        tombstone: None,
    }
}

#[test]
fn native_identity_distinguishes_directories_instances_and_legacy() {
    // Given equal bare native IDs across different projects and sidecar stores.
    let a = native("C:/projects/alpha", "ses_shared");
    let b = native("C:/projects/beta", "ses_shared");
    let c = CatalogIdentity::Native {
        sidecar_id: "other-store".into(),
        directory: "C:/projects/alpha".into(),
        session_id: "ses_shared".into(),
    };
    let legacy = CatalogIdentity::Legacy {
        history_id: "ses_shared".into(),
    };
    // When keys are collected, then all identities remain distinct.
    assert_eq!(
        HashSet::from([a.key(), b.key(), c.key(), legacy.key()]).len(),
        4
    );
    assert_eq!(legacy.key(), "legacy:ses_shared");
}

#[test]
fn identity_tuple_encoding_cannot_collide_at_delimiters() {
    // Given delimiter-bearing directory and instance components.
    let a = CatalogIdentity::Native {
        sidecar_id: "a:b".into(),
        directory: "c".into(),
        session_id: "ses_1".into(),
    };
    let b = CatalogIdentity::Native {
        sidecar_id: "a".into(),
        directory: "b:c".into(),
        session_id: "ses_1".into(),
    };
    // When keys are encoded, then component boundaries remain meaningful.
    assert_ne!(a.key(), b.key());
}

#[test]
fn windows_directory_aliases_have_one_identity() {
    let canonical = native("C:/projects/alpha", "ses_1");
    for alias in [
        "c:\\PROJECTS\\alpha\\",
        "C:/projects/beta/../alpha",
        "\\\\?\\C:\\projects\\.\\alpha",
    ] {
        assert_eq!(native(alias, "ses_1").key(), canonical.key());
    }
}

#[test]
fn paged_fixture_preserves_every_composite_identity() {
    // Given more than 1,000 native records, including colliding bare IDs.
    let mut rows: Vec<_> = (0..1007).map(fixture).collect();
    let mut collision = fixture(1);
    collision.identity = native("C:/projects/beta", "ses_1");
    rows.push(collision);
    // When every synthetic page is traversed, then no composite row is lost.
    let keys: HashSet<_> = rows
        .chunks(100)
        .flat_map(|page| page.iter().map(CatalogEntry::key))
        .collect();
    assert_eq!(keys.len(), 1008);
}

#[test]
fn malformed_child_deleted_and_unknown_directory_have_explicit_reasons() {
    // Given four ineligible discovery records and one eligible record.
    let known = vec!["C:/projects/alpha".to_owned()];
    let valid = native(&known[0], "ses_1");
    let malformed = native(&known[0], "");
    let unknown = native("C:/private", "ses_2");
    let cases = [
        (
            &malformed,
            None,
            false,
            Some(ExclusionReason::MalformedIdentity),
        ),
        (
            &valid,
            Some("ses_parent"),
            false,
            Some(ExclusionReason::ChildSession),
        ),
        (&valid, None, true, Some(ExclusionReason::Deleted)),
        (
            &unknown,
            None,
            false,
            Some(ExclusionReason::UnknownDirectory),
        ),
        (&valid, None, false, None),
    ];
    // When eligibility is derived, then each exclusion is explained.
    for (identity, parent_id, deleted, expected) in cases {
        assert_eq!(
            exclusion_reason(
                &DiscoveryCandidate {
                    identity,
                    parent_id,
                    deleted
                },
                &known
            ),
            expected
        );
    }
}

#[test]
fn ownership_and_runtime_guard_send_and_delete() {
    // Given native sessions under each ownership/runtime combination.
    for ownership in [Ownership::Unowned, Ownership::Workbench, Ownership::Agent] {
        for runtime in [
            RuntimeState::Idle,
            RuntimeState::Running,
            RuntimeState::Unknown,
        ] {
            let mut row = fixture(1);
            row.ownership = ownership;
            row.runtime = runtime;
            // When capabilities are derived, then only idle unowned sessions can send.
            let actions = row.capabilities();
            assert_eq!(
                actions.send,
                ownership == Ownership::Unowned && runtime == RuntimeState::Idle
            );
            assert_eq!(actions.delete, runtime == RuntimeState::Idle);
            assert!(actions.open);
        }
    }
}

#[test]
fn unavailable_native_retains_local_organization_but_denies_remote_mutations() {
    // Given cached native summaries without a trustworthy live runtime.
    for availability in [Availability::Stale, Availability::Unavailable] {
        let mut row = fixture(1);
        row.availability = availability;
        // When capabilities are derived, then pin is local and remote actions are blocked.
        let actions = row.capabilities();
        assert!(actions.pin && actions.archive);
        assert!(
            !(actions.open
                || actions.open_workbench
                || actions.send
                || actions.rename
                || actions.delete)
        );
        assert_eq!(actions.read_only_reason, Some("native_unavailable"));
    }
}

#[test]
fn archived_native_is_readable_and_tombstone_has_no_actions() {
    // Given an archived native row and its durably tombstoned equivalent.
    let mut archived = fixture(1);
    archived.archived = true;
    let mut tombstoned = archived.clone();
    tombstoned.tombstone = Some(DeletionTombstone {
        requested_at: 4,
        remote_deleted: false,
    });
    // When capabilities are derived, then archive is reversible and deletion suppresses access.
    assert!(archived.capabilities().open && archived.capabilities().archive);
    assert!(!archived.capabilities().send);
    let actions = tombstoned.capabilities();
    assert!(
        !(actions.open
            || actions.open_workbench
            || actions.send
            || actions.rename
            || actions.pin
            || actions.archive
            || actions.delete)
    );
}

#[test]
fn legacy_is_readable_and_rename_wins_over_automatic_title() {
    // Given a local legacy record with an explicit user title.
    let mut row = fixture(1);
    row.identity = CatalogIdentity::Legacy {
        history_id: "old_1".into(),
    };
    row.source = ConversationSource::Legacy;
    row.user_title = Some("My title".into());
    // When capabilities/title are projected, then legacy remains text-only with user precedence.
    let actions = row.capabilities();
    assert!(actions.open && actions.rename && actions.pin && actions.archive && actions.delete);
    assert!(!(actions.open_workbench || actions.send));
    assert_eq!(actions.read_only_reason, Some("legacy_text_only"));
    assert_eq!(row.display_title(), "My title");
}

#[test]
fn metadata_file_reopens_without_any_native_transcript() {
    // Given only synthetic metadata persisted through the real JSON file surface.
    let root = std::env::temp_dir().join(format!("yume-history-contract-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("catalog.json");
    let rows: Vec<_> = (0..1007).map(fixture).collect();
    std::fs::write(&path, serde_json::to_vec(&rows).unwrap()).unwrap();
    // When a fresh reader reopens the file, then identities survive without content fields.
    let bytes = std::fs::read(&path).unwrap();
    let reopened: Vec<CatalogEntry> = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(reopened, rows);
    let json = String::from_utf8(bytes).unwrap();
    for forbidden in ["messages", "parts", "toolOutput", "transcript"] {
        assert!(!json.contains(forbidden));
    }
    std::fs::remove_dir_all(root).unwrap();
}
