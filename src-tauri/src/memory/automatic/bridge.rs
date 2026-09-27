//! Local authenticated bridge for the managed sidecar. It never executes model code.
use super::*;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::Duration,
};
use tauri::{Emitter, Manager};

pub(crate) struct AutomationBridge {
    pub endpoint: String,
    pub token: String,
}

pub(crate) fn start(app: &tauri::AppHandle) -> Result<AutomationBridge, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "AUTOMATION_LISTEN_FAILED")?;
    let endpoint = format!(
        "http://{}",
        listener
            .local_addr()
            .map_err(|_| "AUTOMATION_LISTEN_FAILED")?
    );
    let token = uuid::Uuid::new_v4().to_string();
    let expected = token.clone();
    let host = app.clone();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let result =
                read_request(&mut stream, &expected).and_then(|request| dispatch(&host, request));
            let body = match result {
                Ok(value) => json!({"ok":true,"result":value}),
                Err(code) => json!({"ok":false,"error":code}),
            }
            .to_string();
            let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
        }
    });
    worker::start(app.clone());
    Ok(AutomationBridge { endpoint, token })
}
fn read_request(stream: &mut TcpStream, token: &str) -> Result<Value, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| "BRIDGE_IO")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| "BRIDGE_IO")?;
    let mut header = Vec::new();
    let mut byte = [0];
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() > 8192 {
            return Err("BRIDGE_REQUEST_TOO_LARGE".into());
        }
        stream.read_exact(&mut byte).map_err(|_| "BRIDGE_IO")?;
        header.push(byte[0]);
    }
    let header = String::from_utf8(header).map_err(|_| "BRIDGE_INVALID_REQUEST")?;
    if !header.starts_with("POST / HTTP/1.1\r\n") {
        return Err("BRIDGE_INVALID_REQUEST".into());
    }
    let mut authorized = false;
    let mut length = None;
    for line in header.lines() {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("authorization") {
                authorized = value.trim() == format!("Bearer {token}");
            }
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
        }
    }
    if !authorized {
        return Err("BRIDGE_UNAUTHORIZED".into());
    }
    let length = length
        .filter(|n| *n <= 64 * 1024)
        .ok_or("BRIDGE_REQUEST_TOO_LARGE")?;
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).map_err(|_| "BRIDGE_IO")?;
    serde_json::from_slice(&bytes).map_err(|_| "BRIDGE_INVALID_JSON".into())
}
fn dispatch(app: &tauri::AppHandle, value: Value) -> Result<Value, String> {
    let kind = value["kind"].as_str().ok_or("BRIDGE_INVALID_KIND")?;
    let r: Registration = serde_json::from_value(value["registration"].clone())
        .map_err(|_| "BRIDGE_INVALID_REGISTRATION")?;
    if kind == "register" {
        return register(app, r).map(|id| json!({"id":id}));
    }
    if !model::safe_id(&r.session_id) {
        return Err("INVALID_IDENTITY".into());
    }
    let client = model::Client::new(app, &r.directory);
    let session = client.session(&r.session_id)?;
    if !session["parentID"].is_null() {
        return Err("INTERNAL_SESSION".into());
    }
    let rows = crate::history::commands::store(app)?.all()?;
    let directory = crate::history::catalog_model::canonical_directory(&r.directory)
        .map_err(|_| "INVALID_DIRECTORY")?;
    if !model::owns_session(&session, &directory) {
        return Err("SOURCE_DIRECTORY_MISMATCH".into());
    }
    let key = crate::history::catalog_model::CatalogIdentity::Native {
        sidecar_id: crate::history::catalog_model::SIDECAR_ID.into(),
        directory: directory.clone(),
        session_id: r.session_id.clone(),
    }
    .key();
    if !crate::history::commands::store(app)?
        .directories()?
        .contains(&directory)
        || rows
            .iter()
            .any(|row| row.key() == key && row.tombstone.is_some())
    {
        return Err("UNKNOWN_CONVERSATION".into());
    }
    let workspace = (directory != crate::history::commands::workspace(app)?).then_some(directory);
    let settings = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map_err(|_| "SETTINGS_UNAVAILABLE")?
        .clone();
    if !settings.memory_ai_use {
        return Ok(json!({"block":"","disabled":true}));
    }
    let messages = client.messages(&r.session_id)?;
    if kind == "context" {
        synchronize_work_links(app);
        let user = messages.iter().rev().find(|m| m["info"]["role"] == "user");
        let text = user.map(model::message_text).unwrap_or_default();
        return worker::repository(app, |repo| {
            crate::memory::retrieval::context_for_turn_scoped(
                repo,
                &settings.persona_id,
                &text,
                true,
                workspace.as_deref(),
            )
        })
        .map(|mut context| {
            context.prompt_block.push_str(&pending_context(
                app,
                &settings.persona_id,
                &text,
                workspace.as_deref(),
            ));
            json!({"block":context.prompt_block})
        });
    }
    if kind != "manage" {
        return Err("BRIDGE_INVALID_KIND".into());
    }
    let assistant = messages
        .iter()
        .find(|m| m["info"]["id"] == r.message_id && m["info"]["role"] == "assistant")
        .ok_or("INVALID_TOOL_SOURCE")?;
    if !assistant["parts"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|p| {
            p["type"] == "tool" && p["tool"] == "memory_manage" && p["callID"] == value["callId"]
        })
    {
        return Err("INVALID_TOOL_CALL".into());
    }
    let parent = messages
        .iter()
        .find(|m| m["info"]["id"] == assistant["info"]["parentID"] && m["info"]["role"] == "user")
        .ok_or("INVALID_USER_SOURCE")?;
    let text = model::message_text(parent);
    let direct = crate::worklog::bridge::auth::direct_text(&text);
    let records = worker::repository(app, |repo| {
        repo.list(&crate::memory::domain::MemoryQuery {
            persona_id: Some(settings.persona_id.clone()),
            limit: Some(200),
            ..Default::default()
        })
    })?;
    let visible: Vec<_> = records
        .into_iter()
        .filter(|m| {
            m.context
                .as_ref()
                .and_then(|c| c.workspace.as_deref())
                .is_none_or(|w| Some(w) == workspace.as_deref())
        })
        .collect();
    let args = &value["args"];
    match args["action"].as_str() {
        Some("list") => Ok(json!({"memories":visible})),
        Some("forget") => {
            if ![
                "忘",
                "删除",
                "移除",
                "forget",
                "delete",
                "remove",
                "消して",
                "잊어",
            ]
            .iter()
            .any(|word| direct.contains(word))
            {
                return Err("EXPLICIT_FORGET_REQUIRED".into());
            }
            let id = args["id"].as_str().ok_or("MEMORY_ID_REQUIRED")?;
            if !visible.iter().any(|m| m.memory.id == id) {
                return Err("MEMORY_NOT_VISIBLE".into());
            }
            worker::repository(app, |repo| repo.forget(id))?;
            let _ = app.emit(
                "deskmate://memory-changed",
                json!({"version":1,"action":"forgotten","memoryId":id}),
            );
            Ok(
                json!({"status":"forgotten","id":id,"note":"Removed from long-term memory. Original conversation and work journal are separate."}),
            )
        }
        Some("update") => {
            let id = args["id"].as_str().ok_or("MEMORY_ID_REQUIRED")?;
            let stored = visible
                .iter()
                .find(|m| m.memory.id == id)
                .ok_or("MEMORY_NOT_VISIBLE")?;
            let content = args["content"]
                .as_str()
                .filter(|s| !s.is_empty() && direct.contains(s))
                .ok_or("EXACT_USER_QUOTE_REQUIRED")?;
            if ![
                "改", "不是", "现在", "以后", "其实", "actually", "instead", "correct", "change",
            ]
            .iter()
            .any(|word| direct.contains(word))
            {
                return Err("EXPLICIT_CORRECTION_REQUIRED".into());
            }
            let changed = worker::repository(app, |repo| {
                repo.update(&crate::memory::domain::MemoryUpdate {
                    id: id.into(),
                    content: content.into(),
                    importance: None,
                    expires_at: stored.memory.expires_at.clone(),
                    expected_revision: stored.memory.revision,
                    sensitive_confirmed: false,
                })
            })?;
            let _ = app.emit(
                "deskmate://memory-changed",
                json!({"version":1,"action":"updated","memoryId":id}),
            );
            Ok(json!({"status":"updated","id":id,"revision":changed.revision}))
        }
        Some("remember") => {
            if ![
                "记住",
                "记一下",
                "以后",
                "remember",
                "always",
                "覚えて",
                "기억해",
            ]
            .iter()
            .any(|word| direct.contains(word))
            {
                return Err("EXPLICIT_REMEMBER_REQUIRED".into());
            }
            let content = args["content"]
                .as_str()
                .filter(|s| !s.is_empty() && direct.contains(s))
                .ok_or("EXACT_USER_QUOTE_REQUIRED")?;
            let kind =
                crate::memory::domain::MemoryType::parse(args["type"].as_str().unwrap_or("event"))
                    .map_err(|_| "INVALID_MEMORY_TYPE")?;
            let request = crate::memory::domain::NewMemory {
                scope: if kind == crate::memory::domain::MemoryType::SharedMoment {
                    crate::memory::domain::MemoryScope::Persona
                } else {
                    crate::memory::domain::MemoryScope::Global
                },
                persona_id: (kind == crate::memory::domain::MemoryType::SharedMoment)
                    .then_some(settings.persona_id.clone()),
                memory_type: kind,
                memory_key: Some(format!(
                    "explicit.{}",
                    hash(&format!("{}:{}:{}", key, parent["info"]["id"], content))
                )),
                content: content.into(),
                importance: Some(4),
                expires_at: None,
                source_kind: crate::memory::domain::SourceKind::Explicit,
                conversation_id: Some(key),
                message_id: parent["info"]["id"].as_str().map(str::to_owned),
                sensitive_confirmed: false,
            };
            let memory = worker::repository(app, |repo| repo.create(&request))?;
            let _ = app.emit(
                "deskmate://memory-changed",
                json!({"version":1,"action":"created","memoryId":memory.id}),
            );
            Ok(json!({"status":"saved","id":memory.id}))
        }
        _ => Err("INVALID_MEMORY_ACTION".into()),
    }
}

#[tauri::command]
pub(crate) async fn memory_register_turn(
    app: tauri::AppHandle,
    registration: Registration,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || register(&app, registration))
        .await
        .map_err(|_| "REGISTRATION_FAILED")?
}

#[tauri::command]
pub(crate) fn memory_automation_status(app: tauri::AppHandle) -> Result<Value, String> {
    worker::repository(&app, |repo| repo.automation_status())
}
#[tauri::command]
pub(crate) fn memory_automation_retry(app: tauri::AppHandle) -> Result<(), String> {
    worker::repository(&app, |repo| repo.retry_automatic())
}
