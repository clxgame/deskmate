use super::{
    catalog_model::{Availability, CatalogIdentity, ConversationSource, SIDECAR_ID},
    commands, HistoryMessage, HistorySession, HistoryState,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Condvar, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewWindow};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum PreviewStatus {
    Ready,
    Empty,
    Unavailable,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogPreview {
    key: String,
    status: PreviewStatus,
    text: Option<String>,
    role: Option<String>,
    time: Option<u64>,
    local_only: bool,
}

struct CachedPreview {
    value: CatalogPreview,
    stored: Instant,
    touched: Instant,
}
#[derive(Default)]
struct PreviewState {
    values: HashMap<String, CachedPreview>,
    active: usize,
    reading: HashSet<String>,
    generation: u64,
}
struct PreviewShared {
    state: Mutex<PreviewState>,
    idle: Condvar,
}
static SHARED: OnceLock<PreviewShared> = OnceLock::new();
fn shared() -> &'static PreviewShared {
    SHARED.get_or_init(|| PreviewShared {
        state: Mutex::new(PreviewState::default()),
        idle: Condvar::new(),
    })
}

pub(crate) fn invalidate(key: &str) {
    if let Ok(mut state) = shared().state.lock() {
        state.values.remove(key);
        state.generation = state.generation.wrapping_add(1);
        shared().idle.notify_all();
    }
}

pub(crate) fn invalidate_all() {
    if let Ok(mut state) = shared().state.lock() {
        state.values.clear();
        state.generation = state.generation.wrapping_add(1);
        shared().idle.notify_all();
    }
}

struct ReadPermit {
    key: String,
}
impl Drop for ReadPermit {
    fn drop(&mut self) {
        if let Ok(mut state) = shared().state.lock() {
            state.active = state.active.saturating_sub(1);
            state.reading.remove(&self.key);
            shared().idle.notify_all();
        }
    }
}

fn cache_bytes(state: &PreviewState) -> usize {
    state
        .values
        .iter()
        .map(|(key, entry)| key.len() + entry.value.text.as_ref().map_or(0, String::len))
        .sum()
}

fn one(
    app: &tauri::AppHandle,
    key: String,
    start_cutoff: Instant,
) -> Result<CatalogPreview, String> {
    let shared = shared();
    let mut state = shared
        .state
        .lock()
        .map_err(|_| "history_preview_unavailable")?;
    loop {
        if let Some(cached) = state.values.get_mut(&key) {
            let ttl = match cached.value.status {
                PreviewStatus::Unavailable => Duration::from_secs(5),
                _ => Duration::from_secs(30),
            };
            if cached.stored.elapsed() < ttl {
                cached.touched = Instant::now();
                return Ok(cached.value.clone());
            }
            state.values.remove(&key);
        }
        if Instant::now() >= start_cutoff {
            return Ok(unavailable(key));
        }
        if state.active < 2 && !state.reading.contains(&key) {
            break;
        }
        state = shared
            .idle
            .wait_timeout(
                state,
                start_cutoff.saturating_duration_since(Instant::now()),
            )
            .map_err(|_| "history_preview_unavailable")?
            .0;
    }
    let generation = state.generation;
    state.active += 1;
    state.reading.insert(key.clone());
    drop(state);
    let permit = ReadPermit { key: key.clone() };
    let value = fetch(app, &key);
    let mut state = shared
        .state
        .lock()
        .map_err(|_| "history_preview_unavailable")?;
    // An invalidation during a read must not put old content back in the cache.
    if state.generation != generation {
        return Ok(unavailable(key));
    }
    let value = value.unwrap_or_else(|_| unavailable(key.clone()));
    state.values.insert(
        key.clone(),
        CachedPreview {
            value: value.clone(),
            stored: Instant::now(),
            touched: Instant::now(),
        },
    );
    while state.values.len() > 200 || cache_bytes(&state) > 512 * 1024 {
        let Some(oldest) = state
            .values
            .iter()
            .min_by_key(|(_, entry)| entry.touched)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        state.values.remove(&oldest);
    }
    drop(state);
    drop(permit);
    Ok(value)
}

fn unavailable(key: String) -> CatalogPreview {
    CatalogPreview {
        key,
        status: PreviewStatus::Unavailable,
        text: None,
        role: None,
        time: None,
        local_only: false,
    }
}

fn from_messages(
    key: &str,
    messages: Vec<HistoryMessage>,
    limited_without_text: bool,
) -> CatalogPreview {
    let latest = messages.into_iter().rev().find(|message| {
        matches!(message.role.as_str(), "user" | "assistant") && !message.text.trim().is_empty()
    });
    match latest {
        Some(message) => CatalogPreview {
            key: key.to_owned(),
            status: PreviewStatus::Ready,
            text: Some(
                message
                    .text
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .chars()
                    .take(160)
                    .collect(),
            ),
            role: Some(message.role),
            time: Some(message.time),
            local_only: message.local_only,
        },
        None if limited_without_text => unavailable(key.to_owned()),
        None => CatalogPreview {
            key: key.to_owned(),
            status: PreviewStatus::Empty,
            text: None,
            role: None,
            time: None,
            local_only: false,
        },
    }
}

fn project_local(session: &HistorySession, linked: bool) -> HistorySession {
    let latest = session
        .messages
        .iter()
        .filter(|message| {
            message.local_only == linked
                && matches!(message.role.as_str(), "user" | "assistant")
                && !message.text.trim().is_empty()
        })
        .max_by_key(|message| message.time)
        .cloned();
    HistorySession {
        local_link: session.local_link.clone(),
        id: session.id.clone(),
        title: session.title.clone(),
        created: session.created,
        updated: session.updated,
        messages: latest.into_iter().collect(),
        origin_run_id: session.origin_run_id.clone(),
        deleted: session.deleted,
    }
}

fn fetch(app: &tauri::AppHandle, key: &str) -> Result<CatalogPreview, String> {
    let entry = commands::store(app)?.get(key)?;
    if entry.tombstone.is_some() {
        return Ok(unavailable(key.to_owned()));
    }
    let mut limited_without_text = false;
    let messages = match &entry.identity {
        CatalogIdentity::Legacy { history_id } => app
            .state::<HistoryState>()
            .0
            .lock()
            .map_err(|_| "history_state_unavailable")?
            .iter()
            .find(|session| &session.id == history_id && !session.deleted)
            .map(|session| {
                session
                    .messages
                    .iter()
                    .rev()
                    .find(|message| {
                        matches!(message.role.as_str(), "user" | "assistant")
                            && !message.text.trim().is_empty()
                    })
                    .cloned()
                    .into_iter()
                    .collect()
            })
            .ok_or("history_not_found")?,
        CatalogIdentity::Native {
            sidecar_id,
            directory,
            session_id,
        } => {
            if sidecar_id != SIDECAR_ID || entry.availability != Availability::Available {
                return Ok(unavailable(key.to_owned()));
            }
            let client = commands::client(app)?;
            client
                .verify_preview_session(directory, session_id)
                .map_err(|error| error.to_string())?;
            let preview = client
                .preview_text(directory, session_id)
                .map_err(|error| error.to_string())?;
            limited_without_text = preview.message.is_none() && !preview.exhausted;
            let verified_empty = preview.message.is_none() && preview.exhausted;
            let native: Vec<HistoryMessage> = preview.message.into_iter().collect();
            let workspace = commands::workspace(app)?;
            let local = app
                .state::<HistoryState>()
                .0
                .lock()
                .map_err(|_| "history_state_unavailable")?
                .iter()
                .filter(|session| {
                    if session.deleted {
                        return false;
                    }
                    let linked = session
                        .local_link
                        .as_ref()
                        .is_some_and(|identity| identity.key() == entry.key());
                    let old = verified_empty
                        && directory == &workspace
                        && entry.source == ConversationSource::LightChat
                        && session.local_link.is_none()
                        && session.origin_run_id.is_none()
                        && session.id == *session_id;
                    linked || old
                })
                .map(|session| project_local(session, session.local_link.is_some()))
                .collect::<Vec<_>>();
            // A bounded tail with no text does not prove that native history is empty.
            // Never let that case activate the old local projection fallback.
            super::catalog_local::combine_messages(entry.clone().into(), native, &local, &workspace)
                .1
        }
    };
    if commands::store(app)?.get(key)?.tombstone.is_some() {
        return Ok(unavailable(key.to_owned()));
    }
    Ok(from_messages(key, messages, limited_without_text))
}

#[tauri::command]
pub(crate) async fn history_catalog_previews(
    window: WebviewWindow,
    app: tauri::AppHandle,
    keys: Vec<String>,
) -> Result<Vec<CatalogPreview>, String> {
    super::native_api::authorize_history_window(window.label())
        .map_err(|error| error.to_string())?;
    if keys.len() > 12 || keys.iter().any(|key| key.len() > 4096) {
        return Err("history_preview_invalid_request".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        commands::initialize(&app)?;
        // Verification and two bounded message reads take at most six seconds.
        // Stop starting reads after four seconds so a batch finishes in about ten.
        let start_cutoff = Instant::now() + Duration::from_secs(4);
        keys.into_iter()
            .map(|key| one(&app, key, start_cutoff))
            .collect()
    })
    .await
    .map_err(|_| "history_preview_unavailable".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(role: &str, text: &str, local_only: bool) -> HistoryMessage {
        HistoryMessage {
            role: role.into(),
            text: text.into(),
            local_only,
            time: 1,
            message_id: None,
            part_id: None,
        }
    }

    #[test]
    fn preview_uses_latest_visible_text_and_unicode_safe_limit() {
        let long = "会".repeat(170);
        let value = from_messages(
            "key",
            vec![
                message("user", "Earlier", false),
                message("tool", "secret", false),
                message("assistant", &format!("  {long}  "), true),
            ],
            false,
        );
        assert!(matches!(value.status, PreviewStatus::Ready));
        assert_eq!(value.text.unwrap().chars().count(), 160);
        assert_eq!(value.role.as_deref(), Some("assistant"));
        assert!(value.local_only);
    }

    #[test]
    fn incomplete_native_tail_is_unavailable_not_verified_empty() {
        let value = from_messages("key", vec![message("tool", "secret", false)], true);
        assert!(matches!(value.status, PreviewStatus::Unavailable));
        assert!(value.text.is_none());
    }

    #[test]
    fn local_projection_clones_only_the_latest_matching_message() {
        let mut older = message("user", "older", false);
        older.time = 1;
        let mut newer = message("assistant", "newer", false);
        newer.time = 3;
        let mut local = message("assistant", "linked reply", true);
        local.time = 4;
        let session = HistorySession {
            local_link: None,
            id: "old".into(),
            title: "old".into(),
            created: 1,
            updated: 4,
            messages: vec![older, newer, local],
            origin_run_id: None,
            deleted: false,
        };
        assert_eq!(project_local(&session, false).messages[0].text, "newer");
        assert_eq!(
            project_local(&session, true).messages[0].text,
            "linked reply"
        );
        assert_eq!(project_local(&session, false).messages.len(), 1);
    }
}
