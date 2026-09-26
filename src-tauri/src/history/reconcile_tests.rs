use super::{
    tests::{serve, session},
    NativeHistoryClient,
};
use crate::history::{
    catalog::CatalogStore, catalog_import::new_entry, catalog_model::*, reconcile,
};

fn pending_store() -> (std::path::PathBuf, CatalogStore) {
    let root = std::env::temp_dir().join(format!("yume-delete-retry-{}", uuid::Uuid::new_v4()));
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    store.register_directory("c:/fixture").unwrap();
    let mut row = new_entry(
        CatalogIdentity::Native {
            sidecar_id: SIDECAR_ID.into(),
            directory: "c:/fixture".into(),
            session_id: "ses_retry".into(),
        },
        "Retry".into(),
        ConversationSource::LightChat,
        1,
        2,
    );
    row.tombstone = Some(DeletionTombstone {
        requested_at: 3,
        remote_deleted: false,
    });
    store
        .update(|rows| {
            rows.push(row);
            Ok(())
        })
        .unwrap();
    (root, store)
}

#[test]
fn pending_delete_does_not_contact_mutation_when_native_task_is_busy() {
    // Given a previously committed deletion marker and a newly busy native task.
    let (root, store) = pending_store();
    let (url, worker) = serve(vec![
        (200, format!("[{}]", session("ses_retry", "c:/fixture"))),
        (200, r#"{"ses_retry":{"type":"busy"}}"#.into()),
    ]);
    let client = NativeHistoryClient::new(&url, "Basic fixture").unwrap();
    // When refreshing discovers the current task state.
    let errors = reconcile::reconcile(&store, &client, &[]).unwrap();
    // Then deletion stays pending without issuing an unsafe retry.
    assert!(
        errors.is_empty(),
        "unexpected remote deletion attempt: {errors:?}"
    );
    assert!(
        !store.all().unwrap()[0]
            .tombstone
            .as_ref()
            .unwrap()
            .remote_deleted
    );
    assert_eq!(worker.join().unwrap().len(), 2);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn delete_retry_survives_remote_failure_and_confirms_only_observed_removal() {
    // Given a deletion marker reopened from persistent storage after a failed request.
    let (root, store) = pending_store();
    let row = session("ses_retry", "c:/fixture");
    let (url, worker) = serve(vec![
        (200, format!("[{row}]")),
        (200, "{}".into()),
        (200, row.clone()),
        (503, "{}".into()),
        (200, format!("[{row}]")),
        (200, "{}".into()),
        (200, row),
        (200, "true".into()),
        (404, "{}".into()),
    ]);
    let client = NativeHistoryClient::new(&url, "Basic fixture").unwrap();
    let failure = reconcile::reconcile(&store, &client, &[]).unwrap();
    assert_eq!(failure, ["history_native_http_503"]);
    let reopened = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    assert!(
        !reopened.all().unwrap()[0]
            .tombstone
            .as_ref()
            .unwrap()
            .remote_deleted
    );
    // When the next refresh retries against the recovered native service.
    let errors = reconcile::reconcile(&reopened, &client, &[]).unwrap();
    // Then the row stays hidden and confirmed removal is durable.
    assert!(errors.is_empty());
    let removed = reopened.all().unwrap().remove(0);
    assert!(removed.tombstone.as_ref().unwrap().remote_deleted);
    assert!(!removed.capabilities().open);
    assert_eq!(worker.join().unwrap().len(), 9);
    std::fs::remove_dir_all(root).unwrap();
}
