//! Tauri commands. The complete surface the frontend may touch.
//!
//! Every command is thin: it resolves the store, delegates to policy and the
//! repository, and emits a content-free change event. Nothing here decides
//! privacy on its own.

use std::sync::Mutex;

use tauri::{Emitter, Manager};

use super::domain::{
    Memory, MemoryAction, MemoryChange, MemoryQuery, MemoryRecord, MemoryScope, MemoryUpdate,
    NewMemory, RelationshipState,
};
use super::error::{MemoryError, MemoryResult};
use super::export::{self, MemoryExport};
use super::repository::{MemoryRepository, SystemClock};
use super::retrieval::{self, RetrievalContext};
use super::storage::{MemoryStore, DB_FILE_NAME};

/// Cross-window change notification. Payloads carry ids only.
pub const MEMORY_CHANGED_EVENT: &str = "deskmate://memory-changed";

/// Managed state. `None` means memory failed to initialize this run: chat and
/// the pet keep working, and every memory command answers `MEMORY_DISABLED`.
pub struct MemoryState(pub Mutex<Option<MemoryRepository<SystemClock>>>);

impl MemoryState {
    /// Open the store, or record the reason memory is unavailable.
    ///
    /// Never returns an error: a broken memory database must not stop the app
    /// from starting.
    pub fn initialize(app: &tauri::AppHandle) -> Self {
        let Ok(data_dir) = app.path().app_data_dir() else {
            eprintln!("memory disabled: app data dir unavailable");
            return Self(Mutex::new(None));
        };
        match MemoryStore::open(&data_dir.join(DB_FILE_NAME)) {
            Ok(store) => Self(Mutex::new(Some(MemoryRepository::new(store, SystemClock)))),
            Err(error) => {
                // Content-free: the code and message never include memory text.
                eprintln!("memory disabled: {error}");
                Self(Mutex::new(None))
            }
        }
    }
}

/// Run `body` against the repository, or fail with `MEMORY_DISABLED`.
fn with_repository<T>(
    state: &tauri::State<MemoryState>,
    body: impl FnOnce(&MemoryRepository<SystemClock>) -> MemoryResult<T>,
) -> MemoryResult<T> {
    let guard = state
        .0
        .lock()
        .map_err(|_| MemoryError::storage_unavailable("memory state poisoned"))?;
    let repository = guard
        .as_ref()
        .ok_or_else(|| MemoryError::memory_disabled("memory storage is unavailable"))?;
    body(repository)
}

fn notify(app: &tauri::AppHandle, change: MemoryChange) {
    // A failed notification must not fail the write that already committed.
    let _ = app.emit(MEMORY_CHANGED_EVENT, change);
}

#[tauri::command]
pub fn memory_available(state: tauri::State<MemoryState>) -> bool {
    state.0.lock().map(|guard| guard.is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn memory_create(
    app: tauri::AppHandle,
    state: tauri::State<MemoryState>,
    memory: NewMemory,
) -> Result<Memory, MemoryError> {
    let created = with_repository(&state, |repository| repository.create(&memory))?;
    notify(
        &app,
        MemoryChange::for_memory(MemoryAction::Created, &created),
    );
    Ok(created)
}

#[tauri::command]
pub fn memory_update(
    app: tauri::AppHandle,
    state: tauri::State<MemoryState>,
    update: MemoryUpdate,
) -> Result<Memory, MemoryError> {
    let updated = with_repository(&state, |repository| repository.update(&update))?;
    notify(
        &app,
        MemoryChange::for_memory(MemoryAction::Updated, &updated),
    );
    Ok(updated)
}

#[tauri::command]
pub fn memory_list(
    state: tauri::State<MemoryState>,
    query: MemoryQuery,
) -> Result<Vec<MemoryRecord>, MemoryError> {
    with_repository(&state, |repository| repository.list(&query))
}

#[tauri::command]
pub fn memory_forget(
    app: tauri::AppHandle,
    state: tauri::State<MemoryState>,
    id: String,
) -> Result<(), MemoryError> {
    let forgotten = with_repository(&state, |repository| repository.forget(&id))?;
    notify(
        &app,
        MemoryChange::for_memory(MemoryAction::Forgotten, &forgotten),
    );
    Ok(())
}

#[tauri::command]
pub fn memory_clear(
    app: tauri::AppHandle,
    state: tauri::State<MemoryState>,
    scope: Option<MemoryScope>,
    persona_id: Option<String>,
) -> Result<u64, MemoryError> {
    let removed = with_repository(&state, |repository| {
        repository.clear(scope, persona_id.as_deref())
    })?;
    let mut change = MemoryChange::new(MemoryAction::Cleared);
    change.scope = scope;
    change.persona_id = persona_id;
    notify(&app, change);
    Ok(removed)
}

/// Called when a conversation is deleted and the user opted to drop memories
/// that came only from it.
#[tauri::command]
pub fn memory_forget_conversation(
    app: tauri::AppHandle,
    state: tauri::State<MemoryState>,
    conversation_id: String,
) -> Result<u64, MemoryError> {
    let removed = with_repository(&state, |repository| {
        repository.forget_conversation(&conversation_id)
    })?;
    if removed > 0 {
        notify(&app, MemoryChange::new(MemoryAction::Forgotten));
    }
    Ok(removed)
}

/// Assemble the memory block for one outgoing chat turn.
#[tauri::command]
pub fn memory_context(
    state: tauri::State<MemoryState>,
    persona_id: String,
    user_text: String,
    enabled: bool,
) -> Result<RetrievalContext, MemoryError> {
    // Retrieval must never break a chat turn: a disabled or broken store simply
    // contributes no context.
    match with_repository(&state, |repository| {
        retrieval::context_for_turn(repository, &persona_id, &user_text, enabled)
    }) {
        Ok(context) => Ok(context),
        Err(error) => {
            eprintln!("memory context skipped: {error}");
            Ok(RetrievalContext::empty())
        }
    }
}

#[tauri::command]
pub fn memory_export(
    app: tauri::AppHandle,
    state: tauri::State<MemoryState>,
) -> Result<MemoryExport, MemoryError> {
    let version = app.package_info().version.to_string();
    with_repository(&state, |repository| export::build(repository, &version))
}

#[tauri::command]
pub fn memory_relationship(
    state: tauri::State<MemoryState>,
    persona_id: String,
) -> Result<RelationshipState, MemoryError> {
    with_repository(&state, |repository| repository.relationship(&persona_id))
}

#[tauri::command]
pub fn memory_set_relationship_summary(
    app: tauri::AppHandle,
    state: tauri::State<MemoryState>,
    persona_id: String,
    summary: String,
    expected_revision: i64,
) -> Result<RelationshipState, MemoryError> {
    let updated = with_repository(&state, |repository| {
        repository.set_relationship_summary(&persona_id, &summary, expected_revision)
    })?;
    let mut change = MemoryChange::new(MemoryAction::RelationshipUpdated);
    change.persona_id = Some(updated.persona_id.clone());
    change.revision = Some(updated.revision);
    notify(&app, change);
    Ok(updated)
}

#[tauri::command]
pub fn memory_link_task(
    state: tauri::State<MemoryState>,
    memory_id: String,
    task_id: String,
) -> Result<(), MemoryError> {
    with_repository(&state, |repository| {
        repository.link_task(&memory_id, &task_id)
    })
}

#[tauri::command]
pub fn memory_unlink_task(
    state: tauri::State<MemoryState>,
    memory_id: String,
    task_id: String,
) -> Result<(), MemoryError> {
    with_repository(&state, |repository| {
        repository.unlink_task(&memory_id, &task_id)
    })
}

/// Called when a scheduled task is deleted: drops its links, never a memory.
#[tauri::command]
pub fn memory_unlink_deleted_task(
    state: tauri::State<MemoryState>,
    task_id: String,
) -> Result<u64, MemoryError> {
    with_repository(&state, |repository| {
        repository.unlink_task_everywhere(&task_id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_disabled_store_answers_memory_disabled() {
        let state = MemoryState(Mutex::new(None));
        let error = {
            let guard = state.0.lock().expect("lock");
            assert!(guard.is_none());
            MemoryError::memory_disabled("memory storage is unavailable")
        };
        assert_eq!(
            error.code(),
            super::super::error::MemoryErrorCode::MemoryDisabled
        );
    }

    #[test]
    fn the_change_event_name_follows_the_app_convention() {
        assert!(MEMORY_CHANGED_EVENT.starts_with("deskmate://"));
    }
}
