use super::error::{WorklogError, WorklogResult};
use serde::Deserialize;
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::Manager;

#[path = "bridge_auth.rs"]
pub mod auth;
#[path = "bridge_dispatch.rs"]
mod dispatch;
#[path = "bridge_worker.rs"]
mod worker;

#[derive(Clone)]
pub struct Launch {
    pub directory: PathBuf,
    pub endpoint: String,
}
pub struct WorklogBridge {
    root: Option<PathBuf>,
    launch: Mutex<Option<Launch>>,
    grants: Mutex<HashMap<(String, String), auth::Grant>>,
}
impl WorklogBridge {
    pub fn initialize(app: &tauri::AppHandle) -> Self {
        let root = app
            .path()
            .app_data_dir()
            .ok()
            .map(|path| path.join("worklog-ipc"));
        if let Some(root) = &root {
            if root.exists() && worker::cleanup_stale(root).is_err() {
                eprintln!("Worklog IPC cleanup skipped unsafe or unavailable files");
            }
        }
        Self {
            root,
            launch: Mutex::new(None),
            grants: Mutex::new(HashMap::new()),
        }
    }
    pub fn reset_launch(&self, endpoint: String) -> WorklogResult<PathBuf> {
        if !endpoint.starts_with("http://127.0.0.1:") {
            return Err(WorklogError::validation("Invalid local sidecar address"));
        }
        let root = self.root.as_ref().ok_or_else(unavailable)?;
        std::fs::create_dir_all(root).map_err(|_| unavailable())?;
        worker::assert_plain(root, true)?;
        let directory = root.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&directory).map_err(|_| unavailable())?;
        let mut launch = self.launch.lock().map_err(|_| unavailable())?;
        self.grants.lock().map_err(|_| unavailable())?.clear();
        *launch = Some(Launch {
            directory: directory.clone(),
            endpoint,
        });
        Ok(directory)
    }
    pub fn register(&self, session: String, message: String, text: String) -> WorklogResult<()> {
        if !safe_id(&session) || !safe_id(&message) {
            return Err(WorklogError::validation("Invalid conversation identity"));
        }
        let grant = auth::grant(&text)?;
        let mut grants = self.grants.lock().map_err(|_| unavailable())?;
        grants.retain(|(registered_session, _), grant| {
            registered_session != &session && grant.created.elapsed().as_secs() < 1800
        });
        grants.insert((session, message), grant);
        Ok(())
    }
}
pub fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}
pub fn unavailable() -> WorklogError {
    WorklogError::new("BRIDGE_UNAVAILABLE", "Work journal bridge is unavailable")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub version: u32,
    pub request_id: String,
    pub session_id: String,
    pub message_id: String,
    pub call_id: String,
    pub action: String,
    pub args: serde_json::Value,
}

#[tauri::command]
pub fn worklog_register_turn(
    state: tauri::State<'_, WorklogBridge>,
    session_id: String,
    message_id: String,
    user_text: String,
) -> WorklogResult<()> {
    state.register(session_id, message_id, user_text)
}
pub fn start_worker(app: tauri::AppHandle) {
    worker::start(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_turn_revokes_previous_session_grant() {
        let state = WorklogBridge {
            root: None,
            launch: Mutex::new(None),
            grants: Mutex::new(HashMap::new()),
        };
        state
            .register(
                "ses_test".into(),
                "msg_save".into(),
                "保存到工作记录".into(),
            )
            .expect("register");
        state
            .register("ses_test".into(), "msg_chat".into(), "你好".into())
            .expect("register");
        let grants = state.grants.lock().expect("grants");
        assert!(!grants.contains_key(&("ses_test".into(), "msg_save".into())));
        assert!(grants[&("ses_test".into(), "msg_chat".into())]
            .actions
            .is_empty());
    }
}
