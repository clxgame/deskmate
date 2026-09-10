use super::{safe_id, unavailable, Launch, Request, WorklogBridge};
use crate::worklog::error::{WorklogError, WorklogResult};
use serde_json::{json, Value};
use std::{fs, path::Path, time::Duration};
use tauri::{Emitter, Manager};

pub fn assert_plain(path: &Path, directory: bool) -> WorklogResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if metadata.file_type().is_symlink() || metadata.is_dir() != directory {
        return Err(unavailable());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(unavailable());
        }
    }
    Ok(())
}
pub fn cleanup_stale(root: &Path) -> WorklogResult<()> {
    assert_plain(root, true)?;
    for entry in fs::read_dir(root).map_err(|_| unavailable())? {
        let entry = entry.map_err(|_| unavailable())?;
        let path = entry.path();
        if uuid::Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err() {
            continue;
        }
        assert_plain(&path, true)?;
        for file in fs::read_dir(&path).map_err(|_| unavailable())? {
            let file = file.map_err(|_| unavailable())?.path();
            assert_plain(&file, false)?;
            let stem = file
                .file_stem()
                .and_then(|name| name.to_str())
                .ok_or_else(unavailable)?;
            if uuid::Uuid::parse_str(stem).is_err() {
                return Err(unavailable());
            }
            if !matches!(
                file.extension().and_then(|value| value.to_str()),
                Some("request" | "response" | "tmp" | "response-tmp")
            ) {
                return Err(unavailable());
            }
            fs::remove_file(&file).map_err(|_| unavailable())?;
        }
        fs::remove_dir(path).map_err(|_| unavailable())?;
    }
    Ok(())
}
fn parent(launch: &Launch, request: &Request) -> WorklogResult<String> {
    if !safe_id(&request.session_id) || !safe_id(&request.message_id) || !safe_id(&request.call_id)
    {
        return Err(WorklogError::validation("Invalid tool context"));
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(5))
        .build();
    let messages: Vec<Value> = agent
        .get(&format!(
            "{}/session/{}/message?limit=200",
            launch.endpoint, request.session_id
        ))
        .call()
        .map_err(|_| unavailable())?
        .into_json()
        .map_err(|_| unavailable())?;
    verify_parent(&messages, request)
}
fn verify_parent(messages: &[Value], request: &Request) -> WorklogResult<String> {
    let message = messages
        .iter()
        .find(|message| message["info"]["id"].as_str() == Some(&request.message_id))
        .ok_or_else(unavailable)?;
    if message["info"]["role"] != "assistant"
        || message["info"]["sessionID"].as_str() != Some(&request.session_id)
    {
        return Err(unavailable());
    }
    let tool = format!("worklog_{}", request.action);
    let valid = message["parts"].as_array().is_some_and(|parts| {
        parts.iter().any(|part| {
            part["type"] == "tool"
                && part["callID"].as_str() == Some(&request.call_id)
                && part["tool"].as_str() == Some(&tool)
        })
    });
    if !valid {
        return Err(WorklogError::new(
            "INVALID_CONTEXT",
            "Tool call does not belong to the registered assistant",
        ));
    }
    message["info"]["parentID"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(unavailable)
}
fn handle(app: &tauri::AppHandle, launch: &Launch, request: Request) -> WorklogResult<Value> {
    if request.version != 1 || uuid::Uuid::parse_str(&request.request_id).is_err() {
        return Err(WorklogError::validation("Unsupported bridge request"));
    }
    let user = parent(launch, &request)?;
    let model = {
        let state = app.state::<crate::settings::SettingsState>();
        let settings = state.0.lock().map_err(|_| unavailable())?;
        format!("{}/{}", settings.provider_id, settings.model_id)
    };
    let bridge = app.state::<WorklogBridge>();
    let current = bridge.launch.lock().map_err(|_| unavailable())?;
    if current.as_ref().map(|value| &value.directory) != Some(&launch.directory) {
        return Err(WorklogError::new("STALE_CONTEXT", "Sidecar was restarted"));
    }
    let grants = bridge.grants.lock().map_err(|_| unavailable())?;
    let grant = grants
        .get(&(request.session_id.clone(), user.clone()))
        .ok_or_else(|| {
            WorklogError::new(
                "NEEDS_EXPLICIT_REQUEST",
                "This conversation turn has no work journal authorization",
            )
        })?;
    let result = app
        .state::<crate::worklog::WorklogState>()
        .with_repository(|repo| super::dispatch::execute(repo, &request, grant, &user, &model))?;
    if request.action != "query" {
        if app.emit("deskmate://worklog-changed", ()).is_err() {
            eprintln!("Worklog notification unavailable; committed data remains readable");
        }
    }
    Ok(result)
}
fn consume(app: &tauri::AppHandle, launch: &Launch, path: &Path) -> WorklogResult<()> {
    assert_plain(&launch.directory, true)?;
    assert_plain(path, false)?;
    if fs::metadata(path).map_err(|_| unavailable())?.len() > 256 * 1024 {
        fs::remove_file(path).map_err(|_| unavailable())?;
        return Err(WorklogError::validation("Bridge request exceeds 256 KiB"));
    }
    let name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(unavailable)?;
    uuid::Uuid::parse_str(name).map_err(|_| WorklogError::validation("Invalid request file"))?;
    let request: Request = serde_json::from_slice(&fs::read(path).map_err(|_| unavailable())?)
        .map_err(|_| WorklogError::validation("Malformed bridge request"))?;
    if request.request_id != name {
        return Err(WorklogError::validation("Request identity mismatch"));
    }
    let result = match handle(app, launch, request) {
        Ok(value) => json!({"version":1,"requestId":name,"status":"completed","result":value}),
        Err(error) => json!({"version":1,"requestId":name,"status":"rejected","error":error}),
    };
    let encoded = serde_json::to_vec(&result)?;
    let encoded = if encoded.len() > 256 * 1024 {
        serde_json::to_vec(
            &json!({"version":1,"requestId":name,"status":"rejected","error":{"code":"RESULT_TOO_LARGE","message":"Narrow the requested date range"}}),
        )?
    } else {
        encoded
    };
    let temp = launch.directory.join(format!("{name}.response-tmp"));
    let target = launch.directory.join(format!("{name}.response"));
    use std::io::Write;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| unavailable())?;
    output.write_all(&encoded).map_err(|_| unavailable())?;
    output.sync_all().map_err(|_| unavailable())?;
    fs::rename(temp, target).map_err(|_| unavailable())?;
    fs::remove_file(path).map_err(|_| unavailable())?;
    Ok(())
}
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let bridge = app.state::<WorklogBridge>();
        if let Ok(mut grants) = bridge.grants.lock() {
            grants.retain(|_, grant| grant.created.elapsed().as_secs() < 1800);
        }
        let launch = bridge.launch.lock().ok().and_then(|value| value.clone());
        if let Some(launch) = launch {
            if let Ok(entries) = fs::read_dir(&launch.directory) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let expired = entry
                        .metadata()
                        .ok()
                        .and_then(|metadata| metadata.modified().ok())
                        .and_then(|modified| modified.elapsed().ok())
                        .is_some_and(|age| age.as_secs() > 1800);
                    if expired && assert_plain(&path, false).is_ok() {
                        if let Err(error) = fs::remove_file(&path) {
                            eprintln!("Worklog expired file cleanup: {}", error.kind());
                        }
                        continue;
                    }
                    if path.extension().and_then(|extension| extension.to_str()) == Some("request")
                    {
                        if let Err(error) = consume(&app, &launch, &path) {
                            eprintln!("Worklog bridge: {}", error.code);
                            if assert_plain(&path, false).is_ok() {
                                if let Err(error) = fs::remove_file(&path) {
                                    eprintln!("Worklog request cleanup: {}", error.kind());
                                }
                            }
                        }
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assistant_identity_requires_matching_tool_call() {
        let request = Request {
            version: 1,
            request_id: uuid::Uuid::new_v4().to_string(),
            session_id: "ses_test".into(),
            message_id: "msg_assistant".into(),
            call_id: "call_true".into(),
            action: "record".into(),
            args: json!({}),
        };
        let valid = json!({"info":{"id":"msg_assistant","role":"assistant","sessionID":"ses_test","parentID":"msg_host"},"parts":[{"type":"tool","tool":"worklog_record","callID":"call_true"}]});
        assert_eq!(
            verify_parent(&[valid.clone()], &request).expect("verified"),
            "msg_host"
        );
        let mut spoof = valid;
        spoof["parts"][0]["callID"] = json!("call_other");
        assert_eq!(
            verify_parent(&[spoof], &request).expect_err("reject").code,
            "INVALID_CONTEXT"
        );
    }
}
