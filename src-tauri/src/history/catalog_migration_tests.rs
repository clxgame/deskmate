use super::{catalog::CatalogStore, catalog_import, catalog_model::*, history_tests::ordinary};

#[test]
fn deleted_projection_stays_suppressed_when_native_index_is_imported() {
    // Given an old deletion marker for an already registered native session.
    let root = std::env::temp_dir().join(format!("yume-import-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    let mut session = ordinary("ses_deleted");
    session.deleted = true;
    let index = [super::native_index::NativeSessionMetadata {
        stable_id: session.id.clone(), session_id: session.id.clone(), persona_id: "fixture".into(),
        workspace_path: "C:/fixture".into(), source: "light_chat".into(), created_at: 1, updated_at: 2,
    }];
    // When importing the compatibility projection and index together.
    catalog_import::register_sources(&store, &[session], &index, "C:/fixture", &[]).unwrap();
    // Then the native row cannot resurrect the deleted conversation or trigger migration writes upstream.
    let row = store.all().unwrap().remove(0);
    assert!(row.tombstone.as_ref().is_some_and(|marker| marker.remote_deleted));
    assert!(!row.capabilities().open);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn local_organization_survives_when_projection_is_later_discovered_native() {
    // Given a legacy projection organized before native discovery becomes available.
    let root = std::env::temp_dir().join(format!("yume-import-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    let session = ordinary("ses_projection");
    catalog_import::register_sources(&store, &[session.clone()], &[], "C:/fixture", &[]).unwrap();
    store.update(|rows| {
        rows[0].user_title = Some("My title".into()); rows[0].pinned = true; rows[0].archived = true;
        rows.push(catalog_import::new_entry(CatalogIdentity::Native {
            sidecar_id: SIDECAR_ID.into(), directory: "c:/fixture".into(), session_id: session.id.clone(),
        }, "Automatic title".into(), ConversationSource::LightChat, 1, 2));
        Ok(())
    }).unwrap();
    // When the original source is imported again after discovery.
    catalog_import::register_sources(&store, &[session], &[], "C:/fixture", &[]).unwrap();
    // Then one native row retains all explicit organization.
    let rows = store.all().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].display_title(), "My title");
    assert!(rows[0].pinned && rows[0].archived);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn known_directories_are_canonical_and_reject_relative_paths() {
    // Given an empty persistent directory registry.
    let root = std::env::temp_dir().join(format!("yume-import-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    // When aliases and an invalid path are registered.
    store.register_directory("C:/FIXTURE/child/..").unwrap();
    store.register_directory("c:\\fixture\\").unwrap();
    let invalid = store.register_directory("relative/path");
    // Then discovery has a single explicit absolute scope.
    assert!(invalid.is_err());
    assert_eq!(store.directories().unwrap(), vec!["c:/fixture"]);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn unrelated_agent_collision_preserves_legacy_metadata() {
    // Given ordinary legacy text and an unrelated agent in another project.
    let root = std::env::temp_dir().join(format!("yume-collision-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    let session = ordinary("ses_same");
    catalog_import::register_sources(&store, &[session.clone()], &[], "C:/default", &[]).unwrap();
    store.update(|rows| { rows[0].user_title = Some("Legacy title".into()); rows[0].tombstone = Some(DeletionTombstone { requested_at: 3, remote_deleted: true }); Ok(()) }).unwrap();
    let records: Vec<crate::agent::RunRecord> = serde_json::from_value(serde_json::json!([
        {"runId":"msg_other", "sessionId":"ses_same", "workspacePath":"C:/other", "createdAt":"2026-09-23T00:00:00Z", "outcome":"completed"}
    ])).unwrap();
    // When the agent record is imported beside the legacy collision.
    catalog_import::register_sources(&store, &[session], &[], "C:/default", &records).unwrap();
    // Then the legacy row stays separate and cannot tombstone or rename the native row.
    let rows = store.all().unwrap();
    assert_eq!(rows.len(), 2);
    let native = rows.iter().find(|row| matches!(row.identity, CatalogIdentity::Native { .. })).unwrap();
    assert!(native.tombstone.is_none());
    assert!(native.user_title.is_none());
    assert!(native.title.is_empty());
    assert_eq!(store.get("legacy:ses_same").unwrap().display_title(), "Legacy title");
    std::fs::remove_dir_all(root).unwrap();
}


#[test]
fn startup_index_cannot_forge_agent_origin_for_existing_legacy_collision() {
    // Given original legacy text and an unrelated native agent sharing only its bare ID.
    let root = std::env::temp_dir().join(format!("yume-startup-collision-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    let mut sessions = vec![ordinary("ses_same")];
    let original = sessions[0].clone();
    let records: Vec<crate::agent::RunRecord> = serde_json::from_value(serde_json::json!([
        {"runId":"msg_other", "sessionId":"ses_same", "workspacePath":"C:/other", "createdAt":"2026-09-23T00:00:00Z", "outcome":"completed"}
    ])).unwrap();
    // When the actual startup ordering indexes recovery before catalog import.
    super::recovery::index_agent_records(&root.join("history.json"), &mut sessions, &records).unwrap();
    catalog_import::register_sources(&store, &sessions, &[], "C:/default", &records).unwrap();
    // Then neither the original text identity nor its trusted origin can be fabricated.
    assert_eq!(sessions[0], original);
    let snapshot = super::archive::upsert_agent_snapshot(&root.join("history.json"), &mut sessions, super::AgentHistorySnapshot { session_id: "ses_same", messages: &[] });
    assert_eq!(snapshot, Err("history_agent_owned".into()));
    assert_eq!(sessions[0], original);
    assert_eq!(store.all().unwrap().len(), 2);
    assert!(store.get("legacy:ses_same").is_ok());
    std::fs::remove_dir_all(root).unwrap();
}


#[test]
fn agent_snapshot_scope_rejects_other_directory_and_preserves_same_scope_continuation() {
    // Given a trusted original run in project A plus a later run in project B with the same bare ID.
    let records: Vec<crate::agent::RunRecord> = serde_json::from_value(serde_json::json!([
        {"runId":"msg_origin", "sessionId":"ses_same", "workspacePath":"C:/project-a", "createdAt":"2026-09-23T00:00:00Z", "outcome":"completed"},
        {"runId":"msg_other", "sessionId":"ses_same", "workspacePath":"C:/project-b", "createdAt":"2026-09-24T00:00:00Z", "outcome":null}
    ])).unwrap();
    let session = super::history_tests::agent("ses_same");
    // When a later snapshot is about to write into the original recovery record.
    let same = super::recovery::validate_snapshot_scope(&session, &records, std::path::Path::new("c:/project-a"));
    let other = super::recovery::validate_snapshot_scope(&session, &records, std::path::Path::new("c:/project-b"));
    // Then continued runs may retain the same origin only within the same canonical directory.
    assert!(same.is_ok());
    assert_eq!(other, Err("history_agent_scope_mismatch".into()));
}

#[test]
fn unrelated_snapshot_is_skipped_while_scoped_native_run_completes() {
    // Given a persisted compatibility snapshot for A and a native continuation in B.
    let root = std::env::temp_dir().join(format!("yume-scoped-run-{}", uuid::Uuid::new_v4()));
    let workspace = root.join("project-b");
    std::fs::create_dir_all(&workspace).unwrap();
    let path = root.join("history.json");
    let mut sessions = vec![super::history_tests::agent("ses_same")];
    super::storage::persist_path(&path, &sessions).unwrap();
    let original = std::fs::read(&path).unwrap();
    let runs = crate::agent::AgentRunState::new(crate::agent::RunStore::new(root.join("runs")));
    runs.begin("msg_other", &workspace, "continue B").unwrap();
    runs.bind_session("msg_other", "ses_same").unwrap();
    runs.confirm_submission("msg_other").unwrap();
    let mut records = runs.all_records().unwrap();
    records.push(serde_json::from_value(serde_json::json!({"runId":"msg_origin", "sessionId":"ses_same", "workspacePath":"C:/project-a", "createdAt":"2026-09-23T00:00:00Z", "outcome":"completed"})).unwrap());
    let messages = vec![crate::agent::NativeMessage { id: "msg_answer".into(), role: Some("assistant".into()), created: Some(2), parent_id: Some("msg_other".into()), completed: true, finish: Some("stop".into()), error: None, parts: vec![] }];
    // When the compatibility write sees a different trusted directory, native lifecycle continues independently.
    let disposition = super::save_scoped_snapshot(&path, &mut sessions, &records, &workspace, super::AgentHistorySnapshot { session_id: "ses_same", messages: &messages }).unwrap();
    assert_eq!(disposition, super::recovery::SnapshotWrite::UnrelatedIdentity);
    runs.reconcile("msg_other", &messages).unwrap();
    // Then B completes and scoped catalog recovery selects B, while A remains byte-for-byte untouched.
    assert_eq!(std::fs::read(&path).unwrap(), original);
    let records = runs.all_records().unwrap();
    assert_eq!(records[0].outcome, Some(crate::agent::RunOutcome::Completed));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    catalog_import::register_sources(&store, &sessions, &[], "C:/default", &records).unwrap();
    let entry = store.all().unwrap().into_iter().find(|row| matches!(row.identity, CatalogIdentity::Native { .. })).unwrap();
    assert_eq!(super::catalog_details::native_origin(&entry, &records).as_deref(), Some("msg_other"));
    assert_eq!(super::catalog_details::for_entry(&entry, &records, None).unwrap().workspace_path, workspace.canonicalize().unwrap());
    let unknown: Vec<crate::agent::RunRecord> = vec![];
    assert_eq!(super::save_scoped_snapshot(&path, &mut sessions, &unknown, &workspace, super::AgentHistorySnapshot { session_id: "ses_same", messages: &messages }), Err("history_agent_origin_unknown".into()));
    std::fs::remove_dir_all(root).unwrap();
}
