use super::*;
use crate::history::{catalog::CatalogStore, catalog_import::new_entry};

fn entry(directory: &str) -> CatalogEntry {
    let mut entry = new_entry(CatalogIdentity::Native { sidecar_id: SIDECAR_ID.into(), directory: directory.into(), session_id: "ses_same".into() }, "Fixture".into(), ConversationSource::LightChat, 1, 2);
    entry.availability = Availability::Available;
    entry.runtime = RuntimeState::Idle;
    entry
}
fn note(id: &str, text: &str, time: u64) -> HistoryMessage {
    HistoryMessage { role: "assistant".into(), text: text.into(), time, message_id: Some(id.into()), part_id: None, local_only: true }
}

#[test]
fn local_notes_survive_native_turns_without_crossing_colliding_directory_ids() {
    // Given two native rows with the same bare ID and separate explicitly linked local notes.
    let root = std::env::temp_dir().join(format!("yume-local-{}", uuid::Uuid::new_v4()));
    let path = root.join("history.json");
    let mut local = vec![crate::history::history_tests::ordinary("old_legacy")];
    let original = local[0].clone();
    let first = entry("c:/a");
    let second = entry("c:/b");
    append_local(&path, &mut local, (&first, &[note("local_a", "A local reply", 2)])).unwrap();
    append_local(&path, &mut local, (&second, &[note("local_b", "B local reply", 3)])).unwrap();
    append_local(&path, &mut local, (&first, &[note("local_a", "A local reply", 2)])).unwrap();
    let local = crate::history::storage::load_path(&path).unwrap();
    let mut native = note("msg_native", "Authoritative native", 4);
    native.local_only = false;
    // When both native transcripts reopen after a later native response.
    let (_, a) = combine_messages(first.into(), vec![native.clone()], &local, "c:/a");
    let (_, b) = combine_messages(second.into(), vec![native], &local, "c:/a");
    // Then each transcript contains only its own local note, once, and old source text is unchanged.
    assert_eq!(a.iter().map(|message| message.text.as_str()).collect::<Vec<_>>(), ["A local reply", "Authoritative native"]);
    assert_eq!(b.iter().map(|message| message.text.as_str()).collect::<Vec<_>>(), ["B local reply", "Authoritative native"]);
    assert_eq!(local.len(), 3);
    assert_eq!(local.iter().find(|session| session.id == original.id), Some(&original));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn linked_local_notes_never_become_extra_legacy_catalog_rows() {
    // Given local-only storage attached to one native identity.
    let root = std::env::temp_dir().join(format!("yume-local-{}", uuid::Uuid::new_v4()));
    let mut local = Vec::new();
    let entry = entry("c:/a");
    append_local(&root.join("history.json"), &mut local, (&entry, &[note("local_one", "Notice", 1)])).unwrap();
    let store = CatalogStore::open(&root.join("catalog.sqlite")).unwrap();
    store.update(|rows| { rows.push(entry); Ok(()) }).unwrap();
    // When registration replays the original history file after restart.
    crate::history::catalog_import::register_sources(&store, &local, &[], "c:/a", &[]).unwrap();
    // Then the organizer still contains exactly one native identity.
    assert_eq!(store.all().unwrap().len(), 1);
    assert!(matches!(store.all().unwrap()[0].identity, CatalogIdentity::Native { .. }));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn old_projection_is_read_only_only_when_native_is_verified_empty() {
    // Given an old untagged fixed-response projection from the registered light-chat workspace.
    let entry = entry("c:/a");
    let old = crate::history::history_tests::ordinary("ses_same");
    // When the verified native transcript is empty.
    let (loaded, messages) = combine_messages(entry.into(), Vec::new(), &[old], "c:/a");
    // Then its original text stays readable with an explicit text-only capability.
    assert_eq!(messages[0].text, "hello");
    assert_eq!(loaded.entry.source, ConversationSource::Legacy);
    assert!(!loaded.capabilities.send);
    assert_eq!(loaded.capabilities.read_only_reason, Some("legacy_text_only"));
}

#[test]
fn untagged_projection_cannot_replace_existing_native_content() {
    // Given stale old projection text alongside an authoritative native response.
    let entry = entry("c:/a");
    let old = crate::history::history_tests::ordinary("ses_same");
    let mut native = note("msg_native", "Native source", 4);
    native.local_only = false;
    // When the native history is loaded.
    let (_, messages) = combine_messages(entry.into(), vec![native.clone()], &[old], "c:/a");
    // Then no old text is replayed as native content.
    assert_eq!(messages, [native]);
}

#[test]
fn invalid_local_messages_do_not_modify_original_history() {
    // Given a rejected attempt to write native-shaped IDs through the local notice endpoint.
    let root = std::env::temp_dir().join(format!("yume-local-{}", uuid::Uuid::new_v4()));
    let mut local = vec![crate::history::history_tests::ordinary("legacy")];
    let before = local.clone();
    // When the native-shaped message is submitted.
    let result = append_local(&root.join("history.json"), &mut local, (&entry("c:/a"), &[note("msg_forged", "No", 1)]));
    // Then the boundary rejects before any persistence or mutation.
    assert_eq!(result, Err("history_local_messages_invalid".into()));
    assert_eq!(local, before);
    assert!(!root.exists());
}


#[test]
fn local_fixed_reply_write_is_chat_only() {
    // Given local product replies are generated only by the chat renderer.
    // When other application windows invoke this boundary.
    let rejected = ["workbench", "settings", "pet", "main", ""].map(authorize_local_window);
    // Then no other window can inject local text into a native conversation.
    assert!(rejected.iter().all(|result| result == &Err("history_forbidden".into())));
    assert!(authorize_local_window("chat").is_ok());
}
