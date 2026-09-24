use super::{Mode, ToolPermissions};
use crate::{agent::AgentPermissionState as AgentPermissions, settings::SettingsState, Sidecar};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::Manager;

#[cfg(test)]
pub(crate) use super::scoped::pending_scoped;
pub(crate) use super::scoped::{pending_scoped_live, respond_scoped};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    pub permission: String,
    pub patterns: Vec<String>,
    #[serde(default)]
    pub always: Vec<String>,
    #[serde(default)]
    pub metadata: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<PermissionTool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionTool {
    #[serde(rename = "messageID")]
    pub message_id: String,
    #[serde(rename = "callID")]
    pub call_id: String,
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reply {
    Once,
    Reject,
    #[serde(skip)]
    RejectWithReason(RejectionReason),
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub(crate) enum RejectionReason {
    ApprovalTimeout,
    InvalidMetadata,
}

impl RejectionReason {
    fn message(self) -> &'static str {
        match self {
            Self::ApprovalTimeout => "agent_approval_timeout: Approval was not answered within five minutes.",
            Self::InvalidMetadata => "permission_invalid_metadata: Approval is unavailable because the tool request could not be validated.",
        }
    }
}

fn client() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(3))
        .build()
}

/// Attach the managed sidecar's Basic-auth header when it is configured
/// (always in the running app; absent in tests against fixture servers).
fn authed(request: ureq::Request) -> ureq::Request {
    match crate::sidecar_auth_value() {
        Some(value) => request.set("Authorization", value),
        None => request,
    }
}
fn pending(base: &str) -> Result<Vec<PermissionRequest>, String> {
    pending_url(&format!("{base}/permission"))
}
pub(super) fn pending_url(url: &str) -> Result<Vec<PermissionRequest>, String> {
    authed(client().get(url))
        .call()
        .map_err(|error| match error {
            ureq::Error::Status(400, _) => "permission_invalid_metadata".to_owned(),
            _ => "permission_unavailable".to_owned(),
        })?
        .into_json()
        .map_err(|_| "permission_invalid_response".to_owned())
}
pub(crate) fn respond(base: &str, request: &PermissionRequest, reply: Reply) -> Result<(), String> {
    respond_url(
        &format!("{base}/permission/{}/reply", request.id),
        request,
        reply,
    )
}
pub(super) fn respond_url(
    url: &str,
    request: &PermissionRequest,
    reply: Reply,
) -> Result<(), String> {
    if !crate::worklog::bridge::safe_id(&request.id) {
        return Err("permission_invalid_id".into());
    }
    let payload = match reply {
        Reply::Once => json!({"reply":"once"}),
        Reply::Reject => json!({"reply":"reject"}),
        Reply::RejectWithReason(reason) => json!({"reply":"reject", "message":reason.message()}),
    };
    authed(client().post(url))
        .send_json(payload)
        .map_err(|error| match error {
            ureq::Error::Status(404, _) => "permission_expired".to_owned(),
            _ => "permission_reply_failed".to_owned(),
        })?;
    Ok(())
}
pub(crate) fn endpoint(app: &tauri::AppHandle) -> String {
    format!("http://127.0.0.1:{}", app.state::<Sidecar>().port)
}
pub(crate) fn require_chat(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "chat" {
        Ok(())
    } else {
        Err("permission_chat_only".into())
    }
}

#[cfg(test)]
pub(super) fn resolve_pending(
    base: &str,
    session: &str,
    policy: &ToolPermissions,
) -> Result<Vec<PermissionRequest>, String> {
    resolve_requests(base, session, policy, pending(base)?)
}

pub(super) fn resolve_requests(
    base: &str,
    session: &str,
    policy: &ToolPermissions,
    requests: Vec<PermissionRequest>,
) -> Result<Vec<PermissionRequest>, String> {
    let mut waiting = Vec::new();
    for request in requests
        .into_iter()
        .filter(|request| request.session_id == session)
    {
        match policy.mode(&request.permission) {
            Mode::Allow => respond(base, &request, Reply::Once)?,
            Mode::Deny => respond(base, &request, Reply::Reject)?,
            Mode::Ask => waiting.push(request),
        }
    }
    Ok(waiting)
}

#[tauri::command]
pub async fn tool_permission_pending(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<Vec<PermissionRequest>, String> {
    require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentPermissions>()
            .reject_legacy_session(&session_id)?;
        let base = endpoint(&app);
        let requests = pending_live(&app, &base)?;
        let state = app.state::<SettingsState>();
        let settings = state
            .0
            .lock()
            .map_err(|_| "settings_unavailable".to_owned())?;
        resolve_requests(&base, &session_id, &settings.tool_permissions, requests)
    })
    .await
    .map_err(|_| "permission_unavailable".to_owned())?
}

#[cfg(test)]
pub(super) fn reply_current(
    base: &str,
    session: &str,
    id: &str,
    reply: Reply,
    policy: &ToolPermissions,
) -> Result<(), String> {
    reply_from_requests(base, session, id, reply, policy, pending(base)?)
}

fn reply_from_requests(
    base: &str,
    session: &str,
    id: &str,
    reply: Reply,
    policy: &ToolPermissions,
    requests: Vec<PermissionRequest>,
) -> Result<(), String> {
    let request = requests
        .into_iter()
        .find(|request| request.id == id && request.session_id == session)
        .ok_or_else(|| "permission_expired".to_owned())?;
    let reply = if policy.mode(&request.permission) == Mode::Deny {
        Reply::Reject
    } else {
        reply
    };
    respond(base, &request, reply)
}
#[tauri::command]
pub async fn tool_permission_reply(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
    request_id: String,
    reply: Reply,
) -> Result<(), String> {
    require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentPermissions>()
            .reject_legacy_session(&session_id)?;
        let base = endpoint(&app);
        let requests = pending_live(&app, &base)?;
        let state = app.state::<SettingsState>();
        let settings = state
            .0
            .lock()
            .map_err(|_| "settings_unavailable".to_owned())?;
        reply_from_requests(
            &base,
            &session_id,
            &request_id,
            reply,
            &settings.tool_permissions,
            requests,
        )
    })
    .await
    .map_err(|_| "permission_unavailable".to_owned())?
}
#[tauri::command]
pub async fn tool_permission_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session_id: String,
) -> Result<(), String> {
    require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentPermissions>()
            .reject_legacy_session(&session_id)?;
        let base = endpoint(&app);
        for request in pending_live(&app, &base)?
            .into_iter()
            .filter(|request| request.session_id == session_id)
        {
            respond(&base, &request, Reply::Reject)?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "permission_unavailable".to_owned())?
}

pub(crate) fn pending_live(
    app: &tauri::AppHandle,
    base: &str,
) -> Result<Vec<PermissionRequest>, String> {
    pending_with_events(base, &app.state::<super::events::PermissionEvents>())
}

pub(super) fn pending_with_events(
    base: &str,
    events: &super::events::PermissionEvents,
) -> Result<Vec<PermissionRequest>, String> {
    pending(base).or_else(|error| {
        if error == "permission_invalid_metadata" {
            events.snapshot()
        } else {
            Err(error)
        }
    })
}
