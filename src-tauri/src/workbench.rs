//! Bridge for the `workbench` window, which hosts the embedded native
//! OpenCode app. The window connects to the managed sidecar; these commands
//! are the restricted bootstrap surface and refuse calls from other windows.

use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

use crate::Sidecar;

/// One-shot session handoff: the light chat hands a session to the workbench,
/// which consumes it once on its next connection bootstrap (§8.1).
#[derive(Default)]
pub(crate) struct WorkbenchHandoff(pub(crate) Mutex<Option<WorkbenchSessionTarget>>);

/// Per-session input ownership (§8.1): sessions whose input the workbench
/// currently owns. While a session is owned, the light chat defers its
/// send/approve/question/cancel handlers for it and shows a
/// return-to-workbench entry instead — the two windows never act on the same
/// session. Ownership is released when the workbench hides/closes.
const OWNERSHIP_LEASE: Duration = Duration::from_secs(6);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkbenchSessionTarget {
    directory: String,
    session_id: String,
}

struct OwnedSession {
    directory: String,
    session_id: String,
    refreshed_at: Instant,
}

#[derive(Default)]
struct WorkbenchOwnershipState {
    current: Option<OwnedSession>,
    host_visible: bool,
}

#[derive(Default)]
pub(crate) struct WorkbenchOwnership(Mutex<WorkbenchOwnershipState>);

impl WorkbenchOwnership {
    fn set_host_visible(&self, visible: bool) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "ownership state poisoned".to_owned())?;
        state.host_visible = visible;
        if !visible { state.current = None; }
        Ok(())
    }

    fn claim_visible(&self, directory: &str, session_id: &str, visible: bool) -> Result<(), String> {
        let mut state = self.0.lock().map_err(|_| "ownership state poisoned".to_owned())?;
        if !visible || !state.host_visible {
            state.current = None;
            return Err("workbench_window_hidden".to_owned());
        }
        state.current = Some(OwnedSession {
            directory: directory.to_owned(), session_id: session_id.to_owned(), refreshed_at: Instant::now(),
        });
        Ok(())
    }

    #[cfg(test)]
    fn claim_at(&self, directory: &str, session_id: &str, now: Instant) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "ownership state poisoned".to_owned())?
            .current = Some(OwnedSession {
            directory: directory.to_owned(),
            session_id: session_id.to_owned(),
            refreshed_at: now,
        });
        Ok(())
    }

    fn heartbeat_visible(&self, directory: &str, session_id: &str, visible: bool) -> Result<bool, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "ownership state poisoned".to_owned())?;
        if !visible || !state.host_visible {
            state.current = None;
            return Ok(false);
        }
        let Some(current) = state.current.as_mut() else {
            return Ok(false);
        };
        if current.session_id != session_id || current.directory != directory {
            return Ok(false);
        }
        current.refreshed_at = Instant::now();
        Ok(true)
    }

    fn release(&self, directory: &str, session_id: &str) -> Result<bool, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "ownership state poisoned".to_owned())?;
        if state
            .current
            .as_ref()
            .map(|current| (current.directory.as_str(), current.session_id.as_str()))
            != Some((directory, session_id))
        {
            return Ok(false);
        }
        state.current = None;
        Ok(true)
    }

    fn release_current(&self) -> Result<bool, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "ownership state poisoned".to_owned())?;
        Ok(state.current.take().is_some())
    }

    pub(crate) fn is_owned(&self, directory: &str, session_id: &str) -> Result<bool, String> {
        self.is_owned_at(directory, session_id, Instant::now())
    }

    fn is_owned_at(&self, directory: &str, session_id: &str, now: Instant) -> Result<bool, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "ownership state poisoned".to_owned())?;
        let Some(current) = state.current.as_ref() else {
            return Ok(false);
        };
        if now.saturating_duration_since(current.refreshed_at) > OWNERSHIP_LEASE {
            state.current = None;
            return Ok(false);
        }
        Ok(current.session_id == session_id && current.directory == directory)
    }
}

const WORKBENCH_LABEL: &str = "workbench";
/// Attachment reads are capped so a stray picker result cannot exhaust memory.
const MAX_PICKED_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// Create the workbench window (hidden until `workbench_show`). Declared in
/// code rather than config so navigation stays gated: only the app shell,
/// Tauri IPC/asset hosts, and the loopback sidecar may load; external pages
/// can never enter this window, so they can never reach its bridge commands.
pub(crate) fn create_window(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    // Same base WebView2 flags as the config-declared windows. CDP remote
    // debugging is opt-in via YUME_CDP_PORT (QA only; never on in production).
    let mut browser_args =
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".to_string();
    if let Ok(port) = std::env::var("YUME_CDP_PORT") {
        if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) {
            browser_args.push_str(&format!(" --remote-debugging-port={port}"));
        }
    }
    let window = WebviewWindowBuilder::new(
        app,
        WORKBENCH_LABEL,
        WebviewUrl::App("workbench/index.html".into()),
    )
    .title("YUME 工作台")
    .inner_size(1280.0, 800.0)
    .resizable(true)
    .visible(false)
    .focused(false)
    .additional_browser_args(&browser_args)
    .on_navigation(|url| {
        let allowed = match url.scheme() {
            "tauri" | "asset" | "customprotocol" => true,
            "http" | "https" => matches!(
                url.host_str(),
                Some("tauri.localhost")
                    | Some("ipc.localhost")
                    | Some("asset.localhost")
                    | Some("127.0.0.1")
                    | Some("localhost")
            ),
            _ => false,
        };
        if !allowed {
            eprintln!("workbench navigation blocked: {url}");
        }
        allowed
    })
    .build()
    .map_err(|error| error.to_string())?;
    // Closing the window hides it instead of destroying the web view, so the
    // session, scroll position and in-flight state survive a close/reopen.
    // Hiding also releases session input ownership back to the light chat.
    let event_window = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = set_host_visibility(&event_window.app_handle(), false);
            let _ = event_window.hide();
        }
    });
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchConnection {
    url: String,
    username: Option<String>,
    password: Option<String>,
    directory: String,
    session_id: Option<String>,
}

fn require_workbench(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != WORKBENCH_LABEL {
        return Err("workbench commands are only available to the workbench window".to_string());
    }
    Ok(())
}

/// One-shot connection bootstrap. Credentials stay in the workbench window's
/// memory; they are never written to logs, URLs, or storage.
#[tauri::command]
pub fn workbench_connection(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<WorkbenchConnection, String> {
    require_workbench(&window)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data dir unavailable".to_string())?;
    let sidecar = app.state::<Sidecar>();
    let target = app
        .try_state::<WorkbenchHandoff>()
        .and_then(|state| state.0.lock().ok().and_then(|mut pending| pending.take()));
    Ok(WorkbenchConnection {
        url: format!("http://127.0.0.1:{}", sidecar.port),
        username: Some("opencode".to_string()),
        password: Some(sidecar.password.clone()),
        directory: target
            .as_ref()
            .map(|target| target.directory.clone())
            .unwrap_or_else(|| data_dir.join("workspace").to_string_lossy().into_owned()),
        session_id: target.map(|target| target.session_id),
    })
}

/// Hand a session to the workbench (from the light chat or the workbench
/// itself): store it as the pending handoff, notify the (already-loaded)
/// window so it navigates in place, then reveal the window. Opening the
/// workbench sends no message, copies no history, and creates no new session
/// (§8.1) — the workbench entry merely routes to the given session.
#[tauri::command]
pub fn workbench_open_session(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<(), String> {
    if window.label() != WORKBENCH_LABEL && window.label() != "chat" {
        return Err("only chat or workbench windows can hand off a session".to_string());
    }
    if !crate::worklog::bridge::safe_id(&session_id) {
        return Err("empty session id".to_string());
    }
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    crate::history::commands::client(&app)?
        .get(&directory, &session_id)
        .map_err(|error| error.to_string())?;
    let target = WorkbenchSessionTarget {
        directory: directory.clone(),
        session_id: session_id.clone(),
    };
    let state = app
        .try_state::<WorkbenchHandoff>()
        .ok_or("workbench handoff state missing")?;
    *state
        .0
        .lock()
        .map_err(|_| "handoff state poisoned".to_string())? = Some(target.clone());
    workbench_show(app.clone())?;
    // Claim input ownership for the session so the light chat defers its own
    // handlers for it while the workbench owns it (§8.1).
    if let Some(ownership) = app.try_state::<WorkbenchOwnership>() {
        let workbench = app.get_webview_window(WORKBENCH_LABEL).ok_or("workbench window missing")?;
        ownership.claim_visible(&directory, &session_id, workbench.is_visible().map_err(|error| error.to_string())?)?;
    }
    // The page is created at startup and may already be loaded; tell it where
    // to go (the entry also reads the pending handoff on fresh bootstraps).
    let _ = app.emit_to(WORKBENCH_LABEL, "workbench://handoff", target);
    // Ownership changed: any window showing this session should re-check and
    // defer/resume its handlers accordingly.
    let _ = app.emit("workbench://ownership-changed", ());
    Ok(())
}

/// Whether the workbench currently owns the given session's input (§8.1). The
/// light chat checks this before acting on a session so the two windows never
/// both handle the same session's input/approvals/cancel.
#[tauri::command]
pub fn workbench_session_owned(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<bool, String> {
    require_session_window(window.label())?;
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    app.state::<WorkbenchOwnership>()
        .is_owned(&directory, &session_id)
}

fn require_session_window(label: &str) -> Result<(), String> {
    if matches!(label, "chat" | WORKBENCH_LABEL) {
        return Ok(());
    }
    Err("session commands are only available to chat or workbench windows".to_owned())
}
#[tauri::command]
pub fn workbench_claim_session(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<(), String> {
    require_workbench(&window)?;
    if !crate::worklog::bridge::safe_id(&session_id) {
        return Err("empty session id".to_owned());
    }
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    let result = app.state::<WorkbenchOwnership>()
        .claim_visible(&directory, &session_id, window.is_visible().map_err(|error| error.to_string())?);
    let _ = app.emit("workbench://ownership-changed", ());
    result
}

#[tauri::command]
pub(crate) async fn workbench_resolve_session(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
) -> Result<WorkbenchSessionTarget, String> {
    require_workbench(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut directories = crate::history::commands::store(&app)?.directories()?;
        let workspace = crate::history::commands::workspace(&app)?;
        if !directories.contains(&workspace) { directories.push(workspace); }
        let session = crate::history::commands::client(&app)?
            .resolve_known_session(&directories, &session_id)
            .map_err(|error| error.to_string())?;
        let directory = crate::history::commands::authorize_directory(&app, Some(&session.directory))?;
        Ok(WorkbenchSessionTarget { directory, session_id: session.id })
    }).await.map_err(|_| "workbench_resolve_worker_failed".to_owned())?
}

#[tauri::command]
pub fn workbench_heartbeat(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<bool, String> {
    require_workbench(&window)?;
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    let refreshed = app.state::<WorkbenchOwnership>()
        .heartbeat_visible(&directory, &session_id, window.is_visible().map_err(|error| error.to_string())?)?;
    if !refreshed { let _ = app.emit("workbench://ownership-changed", ()); }
    Ok(refreshed)
}

#[tauri::command]
pub fn workbench_release_session(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<(), String> {
    require_workbench(&window)?;
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    if app
        .state::<WorkbenchOwnership>()
        .release(&directory, &session_id)?
    {
        let _ = app.emit("workbench://ownership-changed", ());
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchSessionStatus {
    state: &'static str,
}

#[tauri::command]
pub async fn workbench_session_status(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<WorkbenchSessionStatus, String> {
    if window.label() != "chat" && window.label() != WORKBENCH_LABEL {
        return Err("session status is only available to YUME windows".to_owned());
    }
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = match crate::agent::managed_session_busy(&app, &directory, &session_id) {
            Ok(true) => "busy",
            Ok(false) => "idle",
            Err(_) => "unavailable",
        };
        WorkbenchSessionStatus { state }
    })
    .await
    .map_err(|_| "workbench status worker failed".to_owned())
}

#[tauri::command]
pub async fn workbench_abort_session(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<(), String> {
    require_workbench(&window)?;
    if !crate::worklog::bridge::safe_id(&session_id) {
        return Err("empty session id".to_owned());
    }
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::agent::abort_managed_session(&app, &directory, &session_id)
    })
    .await
    .map_err(|_| "workbench abort worker failed".to_owned())?
}

#[tauri::command]
pub async fn chat_abort_session(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    session_id: String,
    directory: Option<String>,
) -> Result<(), String> {
    if window.label() != "chat" {
        return Err("chat abort is only available to the chat window".to_owned());
    }
    if !crate::worklog::bridge::safe_id(&session_id) {
        return Err("empty session id".to_owned());
    }
    let directory = crate::history::commands::authorize_directory(&app, directory.as_deref())?;
    if app
        .state::<WorkbenchOwnership>()
        .is_owned(&directory, &session_id)?
    {
        return Err("session_owned_by_workbench".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::agent::abort_managed_session(&app, &directory, &session_id)
    })
    .await
    .map_err(|_| "chat abort worker failed".to_owned())?
}

/// Release all session input ownership (workbench hidden/closed). Callable
/// internally; the light chat can then resume after re-checking service state.
pub(crate) fn release_ownership(app: &tauri::AppHandle) {
    if let Some(ownership) = app.try_state::<WorkbenchOwnership>() {
        if ownership.release_current().ok() != Some(true) {
            return;
        }
    }
    let _ = app.emit("workbench://ownership-changed", ());
}

fn set_host_visibility(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    app.state::<WorkbenchOwnership>().set_host_visible(visible)?;
    if !visible { let _ = app.emit("workbench://ownership-changed", ()); }
    Ok(())
}

#[tauri::command]
pub async fn workbench_open_external(
    window: tauri::WebviewWindow,
    url: String,
) -> Result<(), String> {
    require_workbench(&window)?;
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid link".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err("Unsupported link protocol".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::chat_links::open_system_link(parsed.as_str())
    })
    .await
    .map_err(|_| "Could not open link".to_string())?
}

/// Show and focus the workbench window. Callable from any YUME window; it only
/// reveals the window and carries no data.
#[tauri::command]
pub fn workbench_show(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(WORKBENCH_LABEL)
        .ok_or("workbench window missing")?;
    win.show().map_err(|e| e.to_string())?;
    set_host_visibility(&app, true)?;
    win.set_focus().map_err(|e| e.to_string())?;
    app.emit_to(WORKBENCH_LABEL, "workbench://shown", ()).map_err(|error| error.to_string())?;
    Ok(())
}

/// Hide (not destroy) the workbench window; its web view state persists for
/// the next show. Hiding also releases session input ownership (§8.1).
#[tauri::command]
pub fn workbench_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    require_workbench(&window)?;
    set_host_visibility(&window.app_handle(), false)?;
    window.hide().map_err(|e| e.to_string())
}

// --- Desktop platform adaptation: pickers, file reads, open/reveal ---------
// All of these require the workbench window label and validate paths. File
// bytes never persist beyond the response.

#[tauri::command]
pub async fn workbench_pick_directory(
    window: tauri::WebviewWindow,
    title: Option<String>,
) -> Result<Vec<String>, String> {
    require_workbench(&window)?;
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = window.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(&title);
    }
    let picked = dialog.blocking_pick_folder();
    let directories: Vec<String> = picked.into_iter().map(|p| p.to_string()).collect();
    for directory in &directories {
        crate::history::commands::register_known_directory(window.app_handle(), directory)?;
    }
    Ok(directories)
}

#[derive(Serialize)]
pub struct PickedFile {
    name: String,
    path: String,
    size: u64,
}

#[tauri::command]
pub async fn workbench_pick_files(
    window: tauri::WebviewWindow,
    title: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Vec<PickedFile>, String> {
    require_workbench(&window)?;
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = window.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(&title);
    }
    let filter_ext: Vec<String> = extensions
        .unwrap_or_default()
        .into_iter()
        .map(|ext| ext.trim_start_matches('.').to_lowercase())
        .filter(|ext| !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .collect();
    if !filter_ext.is_empty() {
        let ext_refs: Vec<&str> = filter_ext.iter().map(String::as_str).collect();
        dialog = dialog.add_filter("files", &ext_refs);
    }
    let picked = dialog.blocking_pick_files().unwrap_or_default();
    let mut out = Vec::new();
    for path in picked {
        let path_buf = path
            .into_path()
            .map_err(|_| "picked path unavailable".to_string())?;
        let meta = std::fs::metadata(&path_buf).map_err(|_| "picked file missing".to_string())?;
        if !meta.is_file() {
            continue;
        }
        if meta.len() > MAX_PICKED_FILE_BYTES {
            return Err("picked file too large".to_string());
        }
        out.push(PickedFile {
            name: path_buf
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "file".to_string()),
            path: path_buf.to_string_lossy().into_owned(),
            size: meta.len(),
        });
    }
    Ok(out)
}

/// Read a previously picked file's bytes (base64). The path must exist and
/// stay under the size cap; no directory scoping — the user picked the file.
#[tauri::command]
pub async fn workbench_read_file(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<String, String> {
    require_workbench(&window)?;
    use base64::Engine;
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|_| "file missing".to_string())?;
        if !meta.is_file() {
            return Err("not a file".to_string());
        }
        if meta.len() > MAX_PICKED_FILE_BYTES {
            return Err("file too large".to_string());
        }
        let bytes = std::fs::read(&path).map_err(|_| "file unreadable".to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|_| "read failed".to_string())?
}

#[tauri::command]
pub async fn workbench_save_file(
    window: tauri::WebviewWindow,
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    require_workbench(&window)?;
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = window.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(&title);
    }
    if let Some(default_path) = default_path {
        dialog = dialog.set_file_name(&default_path);
    }
    Ok(dialog.blocking_save_file().map(|path| path.to_string()))
}

/// Open a local path with its default application (files/dirs only, no URLs —
/// links go through workbench_open_external).
#[tauri::command]
pub async fn workbench_open_path(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    require_workbench(&window)?;
    if path.contains("://") {
        return Err("not a local path".to_string());
    }
    let exists = std::path::Path::new(&path).exists();
    if !exists {
        return Err("path does not exist".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || crate::chat_links::open_system_link(&path))
        .await
        .map_err(|_| "open failed".to_string())?
}

/// Reveal a local path in the system file manager; false when missing.
#[tauri::command]
pub async fn workbench_reveal_path(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<bool, String> {
    require_workbench(&window)?;
    let exists = std::path::Path::new(&path).exists();
    if !exists {
        return Ok(false);
    }
    #[cfg(windows)]
    {
        let status = std::process::Command::new(r"C:\Windows\explorer.exe")
            .args(["/select,", &path])
            .status()
            .map_err(|_| "reveal failed".to_string())?;
        return Ok(status.success());
    }
    #[allow(unreachable_code)]
    Ok(true)
}

#[cfg(test)]
#[path = "workbench_visibility_tests.rs"]
mod visibility_tests;

#[cfg(test)]
mod ownership_tests {
    use super::WorkbenchOwnership;
    use std::time::{Duration, Instant};

    #[test]
    fn claiming_a_new_session_releases_only_the_previous_session() {
        // Given ownership of one session.
        let ownership = WorkbenchOwnership::default();
        let now = Instant::now();
        ownership.claim_at("C:/default", "session-a", now).unwrap();
        // When the same workbench navigates to another session.
        ownership.claim_at("C:/default", "session-b", now).unwrap();
        // Then only the current session remains owned.
        assert!(!ownership
            .is_owned_at("C:/default", "session-a", now)
            .unwrap());
        assert!(ownership
            .is_owned_at("C:/default", "session-b", now)
            .unwrap());
    }

    #[test]
    fn releasing_a_stale_session_does_not_release_the_current_session() {
        // Given the workbench moved from one session to another.
        let ownership = WorkbenchOwnership::default();
        let now = Instant::now();
        ownership.claim_at("C:/default", "session-a", now).unwrap();
        ownership.claim_at("C:/default", "session-b", now).unwrap();
        // When a stale page tries to release the old session.
        ownership.release("C:/default", "session-a").unwrap();
        // Then the current session remains owned.
        assert!(ownership
            .is_owned_at("C:/default", "session-b", now)
            .unwrap());
    }

    #[test]
    fn ownership_expires_without_a_workbench_heartbeat() {
        // Given a session with a live ownership lease.
        let ownership = WorkbenchOwnership::default();
        let now = Instant::now();
        ownership.claim_at("C:/default", "session-a", now).unwrap();
        // When the workbench stops heartbeating past the lease.
        let expired = now + Duration::from_secs(7);
        // Then the light chat no longer treats that session as owned.
        assert!(!ownership
            .is_owned_at("C:/default", "session-a", expired)
            .unwrap());
    }
}

#[cfg(test)]
mod scoped_routing_tests {
    use super::*;
    #[test]
    fn session_commands_deny_unrelated_windows() {
        assert!(require_session_window("settings").is_err());
        assert!(require_session_window("chat").is_ok());
        assert!(require_session_window("workbench").is_ok());
    }

    #[test]
    fn directory_collision_does_not_transfer_ownership() {
        // Given identical native IDs in different scopes.
        let ownership = WorkbenchOwnership::default();
        let now = Instant::now();
        ownership.claim_at("C:/one", "ses_same", now).unwrap();
        // When another directory queries or releases that ID.
        let owned = ownership.is_owned_at("C:/two", "ses_same", now).unwrap();
        let released = ownership.release("C:/two", "ses_same").unwrap();
        // Then the original scope retains ownership.
        assert!(!owned);
        assert!(!released);
        assert!(ownership.is_owned_at("C:/one", "ses_same", now).unwrap());
    }
}
