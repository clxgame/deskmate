use super::*;
use crate::history::{catalog_import::new_entry, catalog_query::{page, CatalogQuery}, HistoryMessage};

fn entry(id: &str) -> CatalogEntry {
    let mut row = new_entry(CatalogIdentity::Native { sidecar_id: SIDECAR_ID.into(), directory: "/fixture".into(), session_id: id.into() }, "YUME chat".into(), ConversationSource::LightChat, 1, 2);
    row.availability = Availability::Available;
    row.runtime = RuntimeState::Idle;
    row
}
fn session(row: &CatalogEntry) -> HistorySession {
    HistorySession { local_link: Some(row.identity.clone()), id: "local_fixture".into(), title: "Local".into(), created: 1, updated: 2, messages: vec![], origin_run_id: None, deleted: false }
}
#[test]
fn verified_empty_contexts_never_enter_pages_counts_search_or_archive() {
    let mut empty = entry("ses_empty");
    empty.has_records = Some(false);
    empty.pinned = true;
    let mut sent = entry("ses_sent");
    sent.has_records = Some(true);
    let unknown = entry("ses_unknown");
    let result = page(vec![empty.clone(), sent, unknown], CatalogQuery { limit: Some(1), ..Default::default() }, vec![], vec![]);
    assert_eq!(result.total, 2);
    assert_eq!(result.items.len(), 1);
    assert!(result.has_more);
    assert!(result.items.iter().all(|row| row.key != empty.key()));
    empty.archived = true;
    assert_eq!(page(vec![empty], CatalogQuery { archived: Some(true), search: Some("YUME".into()), ..Default::default() }, vec![], vec![]).total, 0);
}
#[test]
fn running_tasks_and_agent_records_survive_even_without_text() {
    let mut running = entry("ses_active");
    running.has_records = Some(false);
    running.runtime = RuntimeState::Running;
    let mut agent = entry("ses_agent");
    agent.has_records = Some(false);
    agent.ownership = Ownership::Agent;
    apply_local_evidence(std::slice::from_mut(&mut agent), &[], "/fixture");
    assert_eq!(agent.has_records, Some(true));
    assert_eq!(page(vec![running, agent], CatalogQuery::default(), vec![], vec![]).total, 2);
}
#[test]
fn local_only_replies_and_legacy_records_override_empty_native_evidence() {
    let mut row = entry("ses_local");
    row.has_records = Some(false);
    let mut saved = session(&row);
    saved.messages.push(HistoryMessage { local_only: true, role: "user".into(), text: "hi".into(), time: 1, message_id: Some("local_user".into()), part_id: None });
    apply_local_evidence(std::slice::from_mut(&mut row), &[saved], "/fixture");
    assert_eq!(row.has_records, Some(true));
    let mut legacy = entry("unused");
    legacy.identity = CatalogIdentity::Legacy { history_id: "legacy_empty".into() };
    let mut saved = session(&legacy);
    saved.id = "legacy_empty".into();
    saved.local_link = None;
    apply_local_evidence(std::slice::from_mut(&mut legacy), &[saved.clone()], "/fixture");
    assert_eq!(legacy.has_records, Some(false));
    saved.origin_run_id = Some("run_finished".into());
    apply_local_evidence(std::slice::from_mut(&mut legacy), &[saved], "/fixture");
    assert_eq!(legacy.has_records, Some(true));
}
#[test]
fn colliding_legacy_ids_cannot_prove_content_in_another_directory() {
    let mut row = entry("ses_shared");
    row.has_records = Some(false);
    let mut saved = session(&row);
    saved.local_link = None;
    saved.id = "ses_shared".into();
    saved.origin_run_id = Some("other_run".into());
    apply_local_evidence(std::slice::from_mut(&mut row), &[saved], "/different");
    assert_eq!(row.has_records, Some(false));
}
#[test]
fn empty_classification_survives_restart_without_deleting_composer_identity_or_model() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("catalog.sqlite");
    let store = CatalogStore::open(&path).unwrap();
    let mut row = entry("ses_draft");
    row.has_records = Some(false);
    store.update(|rows| { rows.push(row.clone()); Ok(()) }).unwrap();
    store.set_model_selection(&row.key(), &crate::settings::ConversationModelSelection::Inherit).unwrap();
    let reopened = CatalogStore::open(&path).unwrap();
    assert!(reopened.get(&row.key()).unwrap().capabilities().send);
    assert_eq!(page(reopened.all().unwrap(), CatalogQuery::default(), vec![], vec![]).total, 0);
    let mut old = serde_json::to_value(&row).unwrap();
    old.as_object_mut().unwrap().remove("hasRecords");
    assert!(serde_json::from_value::<CatalogEntry>(old).unwrap().visible_in_history());
}
