use super::*;
use crate::agent::RunStore;
use crate::history::{HistorySession, HistoryState};
use crate::history::catalog_model::{Availability, CatalogEntry, CatalogIdentity, ConversationSource, Ownership, RuntimeState};
use std::{path::PathBuf, sync::Mutex};

struct Fixture {
    root: PathBuf,
    selected: PathBuf,
    history: HistoryState,
    runs: AgentRunState,
    entry: CatalogEntry,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("yume-scoped-continue-{}", uuid::Uuid::new_v4()));
        let selected = root.join("selected");
        let other = root.join("other");
        std::fs::create_dir_all(&selected).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let runs = AgentRunState::new(RunStore::new(root.join("runs")));
        for (id, workspace) in [("msg_selected", &selected), ("msg_other", &other)] {
            runs.begin(id, workspace, "Synthetic input").unwrap();
            runs.bind_session(id, "ses_same").unwrap();
            runs.fail_active(id, "completed fixture").unwrap();
        }
        let history = HistoryState(Mutex::new(vec![HistorySession {
            local_link: None, id: "ses_same".into(), title: "Other".into(), created: 1, updated: 2,
            messages: Vec::new(), origin_run_id: Some("msg_other".into()), deleted: false,
        }]));
        let entry = CatalogEntry {
            identity: CatalogIdentity::Native { sidecar_id: "managed-local-v1".into(),
                directory: crate::history::catalog_model::canonical_directory(&selected.canonicalize().unwrap().to_string_lossy()).unwrap(),
                session_id: "ses_same".into() },
            title: "Selected".into(), user_title: None, source: ConversationSource::Workbench,
            created: 1, updated: 2, pinned: false, archived: false, availability: Availability::Available,
            ownership: Ownership::Agent, runtime: RuntimeState::Idle, tombstone: None,
        };
        Self { root, selected, history, runs, entry }
    }

    fn request(&self) -> AgentStartInput {
        AgentStartInput { workspace_path: None, history_id: Some("ses_same".into()), catalog_key: Some(self.entry.key()), input: "Continue".into() }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) { std::fs::remove_dir_all(&self.root).unwrap(); }
}

#[test]
fn selected_catalog_scope_wins_over_colliding_legacy_origin() {
    let fixture = Fixture::new();
    let target = catalog_start_target(&fixture.request(), &fixture.entry, &fixture.history, &fixture.runs).unwrap();
    assert_eq!(target.workspace, fixture.selected.canonicalize().unwrap());
    assert_eq!(target.session_id.as_deref(), Some("ses_same"));
}

#[test]
fn catalog_key_mismatch_is_rejected_before_start() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.catalog_key = Some("unknown".into());
    assert_eq!(catalog_start_target(&request, &fixture.entry, &fixture.history, &fixture.runs).err().as_deref(), Some("agent_history_identity_mismatch"));
}

#[test]
fn catalog_continuation_keeps_existing_active_run_guard() {
    let fixture = Fixture::new();
    fixture.runs.begin("msg_active", &fixture.selected, "Already active").unwrap();
    let target = catalog_start_target(&fixture.request(), &fixture.entry, &fixture.history, &fixture.runs).unwrap();
    assert!(fixture.runs.begin("msg_continuation", &target.workspace, "Continue").is_err());
    assert_eq!(fixture.runs.read().unwrap().active.unwrap().run_id, "msg_active");
}

#[test]
fn archived_catalog_session_cannot_continue() {
    let mut fixture = Fixture::new();
    fixture.entry.archived = true;
    assert_eq!(catalog_start_target(&fixture.request(), &fixture.entry, &fixture.history, &fixture.runs).err().as_deref(), Some("agent_history_archived"));
    assert!(fixture.runs.read().unwrap().active.is_none());
}

#[test]
fn pending_delete_catalog_session_cannot_continue() {
    let mut fixture = Fixture::new();
    fixture.entry.tombstone = Some(crate::history::catalog_model::DeletionTombstone { requested_at: 3, remote_deleted: false });
    assert_eq!(catalog_start_target(&fixture.request(), &fixture.entry, &fixture.history, &fixture.runs).err().as_deref(), Some("history_deleted"));
    assert!(fixture.runs.read().unwrap().active.is_none());
}

#[test]
fn unavailable_catalog_session_cannot_continue() {
    let mut fixture = Fixture::new();
    fixture.entry.availability = Availability::Unavailable;
    assert_eq!(catalog_start_target(&fixture.request(), &fixture.entry, &fixture.history, &fixture.runs).err().as_deref(), Some("agent_history_unavailable"));
}

#[test]
fn busy_catalog_session_cannot_continue() {
    let mut fixture = Fixture::new();
    fixture.entry.runtime = RuntimeState::Running;
    assert_eq!(catalog_start_target(&fixture.request(), &fixture.entry, &fixture.history, &fixture.runs).err().as_deref(), Some("agent_history_busy"));
}

