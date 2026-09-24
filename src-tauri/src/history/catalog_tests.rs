use super::{catalog::CatalogStore, catalog_model::*};
fn entry(directory: &str) -> CatalogEntry {
    CatalogEntry { identity: CatalogIdentity::Native { sidecar_id: "managed-local-v1".into(), directory: canonical_directory(directory).unwrap(), session_id: "ses_same".into() }, title: "Native title".into(), user_title: None, source: ConversationSource::LightChat, created: 1, updated: 2, pinned: false, archived: false, availability: Availability::Available, ownership: Ownership::Unowned, runtime: RuntimeState::Idle, tombstone: None }
}
#[test]
fn metadata_reopens_when_same_native_id_occurs_in_two_projects() {
    // Given an isolated persistent catalog with colliding native IDs.
    let root = std::env::temp_dir().join(format!("yume-catalog-{}", uuid::Uuid::new_v4()));
    let path = root.join("catalog.sqlite");
    let store = CatalogStore::open(&path).unwrap();
    // When both entries commit and the store reopens.
    store.update(|rows| { rows.extend([entry("C:/project-a"), entry("C:/project-b")]); Ok(()) }).unwrap();
    let reopened = CatalogStore::open(&path).unwrap();
    // Then both composite identities survive without content storage.
    assert_eq!(reopened.all().unwrap().len(), 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn transaction_rolls_back_when_edit_fails_or_duplicate_identity_is_inserted() {
    // Given one durably stored row.
    let root = std::env::temp_dir().join(format!("yume-catalog-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    store.update(|rows| { rows.push(entry("C:/project-a")); Ok(()) }).unwrap();
    // When a partial rename then duplicate insertion fails validation.
    let failed = store.update(|rows| { rows[0].user_title = Some("Must roll back".into()); rows.push(entry("C:/project-a")); Ok(()) });
    // Then all old metadata remains intact.
    assert_eq!(failed.unwrap_err(), "history_catalog_duplicate");
    assert_eq!(store.all().unwrap(), vec![entry("C:/project-a")]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_updates_preserve_all_pins_when_connections_overlap() {
    // Given independent connections to one persistent catalog.
    let root = std::env::temp_dir().join(format!("yume-catalog-{}", uuid::Uuid::new_v4()));
    let path = root.join("catalog.sqlite");
    CatalogStore::open(&path).unwrap();
    let mut workers = Vec::new();
    // When concurrent transactions add distinct project identities.
    for index in 0..8 {
        let path = path.clone();
        workers.push(std::thread::spawn(move || {
            CatalogStore::open(&path).unwrap().update(|rows| { let mut row = entry(&format!("C:/project-{index}")); row.pinned = true; rows.push(row); Ok(()) }).unwrap();
        }));
    }
    for worker in workers { worker.join().unwrap(); }
    // Then every independent pin survives reopen.
    let rows = CatalogStore::open(&path).unwrap().all().unwrap();
    assert_eq!(rows.len(), 8);
    assert!(rows.iter().all(|row| row.pinned));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn migration_preserves_legacy_bytes_when_repeated_and_coalesces_registered_projection() {
    use sha2::{Digest, Sha256};
    // Given synthetic old history with one legacy and one registered native projection.
    let root = std::env::temp_dir().join(format!("yume-catalog-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    let history = root.join("history.json");
    let bytes = br#"[{"id":"old_text","title":"legacy","created":1,"updated":2,"messages":[{"role":"user","text":"synthetic only","time":1}]},{"id":"ses_native","title":"projection","created":1,"updated":2,"messages":[]}]"#;
    std::fs::write(&history, bytes).unwrap();
    let sessions = super::storage::load_path(&history).unwrap();
    let index = vec![super::native_index::NativeSessionMetadata { stable_id: "ses_native".into(), session_id: "ses_native".into(), persona_id: "synthetic".into(), workspace_path: "C:/fixture".into(), source: "light_chat".into(), created_at: 1, updated_at: 2 }];
    // When the metadata import is repeated across reopen.
    for _ in 0..2 { super::catalog_import::register_sources(&store, &sessions, &index, "C:/fixture", &[]).unwrap(); }
    // Then source bytes and old reader behavior are unchanged and projection coalesces.
    assert_eq!(Sha256::digest(bytes), Sha256::digest(std::fs::read(&history).unwrap()));
    assert_eq!(super::storage::load_path(&history).unwrap(), sessions);
    assert_eq!(store.all().unwrap().len(), 2);
    assert_eq!(store.all().unwrap().iter().filter(|row| row.source == ConversationSource::Legacy).count(), 1);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn metadata_search_pages_every_row_when_offline_and_excludes_tombstones() {
    // Given 1,005 native summaries, one deletion tombstone and one user rename.
    let mut rows: Vec<_> = (0..1005).map(|index| { let mut row = entry(&format!("C:/project-{index}")); row.availability = Availability::Unavailable; row }).collect();
    rows[0].tombstone = Some(DeletionTombstone { requested_at: 3, remote_deleted: false });
    rows[1].user_title = Some("Edited title".into());
    // When cached metadata is queried page by page.
    let started = std::time::Instant::now();
    let mut keys = std::collections::HashSet::new();
    for offset in (0..1004).step_by(50) {
        let query = super::catalog_query::CatalogQuery { offset: Some(offset), ..Default::default() };
        let page = super::catalog_query::page(rows.clone(), query, Vec::new(), Vec::new());
        assert!(page.offline); assert_eq!(page.total, 1004);
        for row in page.items { assert!(keys.insert(row.key)); }
    }
    // Then paging is stable/complete and title search uses user metadata.
    assert_eq!(keys.len(), 1004);
    let query = super::catalog_query::CatalogQuery { search: Some("edited".into()), ..Default::default() };
    assert_eq!(super::catalog_query::page(rows, query, Vec::new(), Vec::new()).total, 1);
    assert!(started.elapsed() < std::time::Duration::from_millis(300));
}

#[test]
fn discovery_preserves_tombstone_and_rename_when_native_returns_again() {
    // Given a user-renamed/pinned row plus tombstoned colliding ID in another directory.
    let root = std::env::temp_dir().join(format!("yume-catalog-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    let directory = "c:/fixture";
    store.update(|rows| { let mut row = entry(directory); row.user_title = Some("User name".into()); row.pinned = true; rows.push(row); Ok(()) }).unwrap();
    let native = serde_json::from_value(serde_json::json!({"id":"ses_same","directory":directory,"title":"Auto title","time":{"created":1,"updated":40}})).unwrap();
    // When native metadata reconciles after another chat turn.
    super::reconcile::apply_discovery(&store, directory, &[native], Some(&std::collections::HashMap::new()), &[], true).unwrap();
    // Then explicit title and pin survive while native timestamps update.
    let row = store.all().unwrap().remove(0);
    assert_eq!(row.display_title(), "User name"); assert!(row.pinned); assert_eq!(row.updated, 40);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn local_archive_roundtrip_is_reversible_when_native_is_offline() {
    use super::catalog_mutation::apply_local;
    use super::catalog_query::CatalogMutation;
    // Given offline native metadata with the original source intact.
    let mut row = entry("C:/project"); row.availability = Availability::Unavailable;
    apply_local(&mut row, &CatalogMutation::Archive { archived: true }, 3).unwrap();
    // When the user restores its organizer visibility.
    apply_local(&mut row, &CatalogMutation::Archive { archived: false }, 4).unwrap();
    // Then local archive restores independently of server availability.
    assert!(!row.archived); assert_eq!(row.source, ConversationSource::LightChat);
}

#[test]
fn delete_is_non_destructive_when_agent_is_running_or_confirmation_missing() {
    // Given an active agent-owned row.
    let mut row = entry("C:/project"); row.ownership = Ownership::Agent; row.runtime = RuntimeState::Running;
    let before = row.clone();
    // When confirmed deletion is attempted.
    let result = super::catalog_mutation::apply_local(&mut row, &super::catalog_query::CatalogMutation::Delete { confirmed: true }, 3);
    // Then no mutation occurs and the active guard is explicit.
    assert_eq!(result.unwrap_err(), "history_agent_running"); assert_eq!(row, before);
}


#[test]
fn cached_catalog_read_does_not_require_a_writer_lock() {
    // Given a populated catalog and an in-progress metadata writer.
    let root = std::env::temp_dir().join(format!("yume-catalog-lock-{}", uuid::Uuid::new_v4()));
    let path = root.join("catalog.sqlite");
    let store = CatalogStore::open(&path).unwrap();
    store.update(|rows| { rows.extend((0..1016).map(|index| { let mut row = entry("C:/project"); if let CatalogIdentity::Native { session_id, .. } = &mut row.identity { *session_id = format!("ses_{index}"); } row })); Ok(()) }).unwrap();
    let mut writer = rusqlite::Connection::open(&path).unwrap();
    let transaction = writer.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).unwrap();
    // When a separate read opens the initialized catalog while its old snapshot is available.
    let read = CatalogStore::open(&path).and_then(|catalog| catalog.all());
    transaction.rollback().unwrap();
    drop(writer);
    std::fs::remove_dir_all(root).unwrap();
    // Then reading cached metadata does not compete for the writer's reserved lock.
    assert_eq!(read.unwrap().len(), 1016);
}

#[test]
fn concurrent_large_catalog_import_load_and_list_preserve_availability() {
    // Given the same size fixture as installed QA, with one project and 1,016 sessions.
    let root = std::env::temp_dir().join(format!("yume-catalog-workload-{}", uuid::Uuid::new_v4()));
    let path = root.join("catalog.sqlite");
    let store = CatalogStore::open(&path).unwrap();
    store.update(|rows| { rows.extend((0..1016).map(|index| { let mut row = entry("C:/project"); if let CatalogIdentity::Native { session_id, .. } = &mut row.identity { *session_id = format!("ses_{index}"); } row })); Ok(()) }).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let mut workers = Vec::new();
    // When refresh writes and independent list/load operations overlap repeatedly.
    for worker in 0..4 {
        let path = path.clone(); let barrier = barrier.clone();
        workers.push(std::thread::spawn(move || -> Result<(), String> {
            barrier.wait();
            for _tick in 0..3 {
                let store = CatalogStore::open(&path)?;
                if worker == 0 {
                    let native: Vec<super::native_api::NativeSession> = (0..1016).map(|index| serde_json::from_value(serde_json::json!({"id":format!("ses_{index}"),"directory":"C:/project","title":"Synthetic","time":{"created":1,"updated":2}})).unwrap()).collect();
                    let started = std::time::Instant::now();
                    super::reconcile::apply_discovery(&store, "c:/project", &native, Some(&std::collections::HashMap::new()), &[], true)?;
                    eprintln!("catalog fixture discovery_ms={}", started.elapsed().as_millis());
                }
                else if worker == 1 { super::catalog_import::register_sources(&store, &[], &[], "C:/project", &[])?; }
                else { assert_eq!(store.all()?.len(), 1016); store.get(&store.all()?[0].key())?; }
            }
            Ok(())
        }));
    }
    let results: Vec<_> = workers.into_iter().map(|worker| worker.join().unwrap()).collect();
    std::fs::remove_dir_all(root).unwrap();
    // Then no healthy cached read or completed refresh reports unavailable.
    assert!(results.iter().all(Result::is_ok), "{results:?}");
}
