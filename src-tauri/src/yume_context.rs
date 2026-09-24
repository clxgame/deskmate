//! YUME context bridge for the managed sidecar: deploys the
//! `yume-context.ts` plugin into the isolated OpenCode home and maintains the
//! context file the plugin reads. The plugin injects the persona/memory block
//! on the `experimental.chat.system.transform` hook for requests that do not
//! already carry it, so both the native workbench and the lightweight chat end
//! up with exactly one YUME context block per model request.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

const PLUGIN_SOURCE: &str = include_str!("yume-context-plugin.ts");
const PLUGIN_FILE_NAME: &str = "yume-context.ts";
const CONTEXT_FILE_NAME: &str = "yume-context.json";
const FINGERPRINT_CHARS: usize = 64;
const SKIP_MARKER_CHARS: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextFile {
    version: u32,
    block: String,
    fingerprint: String,
    exclude_sessions: Vec<String>,
    skip_when_head_includes: Vec<String>,
}

fn opencode_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "app data dir unavailable".to_string())?;
    Ok(data_dir.join("opencode-home"))
}

pub(crate) fn context_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(opencode_home(app)?.join(CONTEXT_FILE_NAME))
}

pub(crate) fn plugin_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(opencode_home(app)?
        .join("yume-plugins")
        .join(PLUGIN_FILE_NAME))
}

/// The `plugin` spec used in the sidecar's injected config.
pub(crate) fn plugin_spec(app: &tauri::AppHandle) -> Result<String, String> {
    let path = plugin_file_path(app)?;
    url::Url::from_file_path(&path)
        .map(|url| url.to_string())
        .map_err(|_| "plugin path is not representable as a file URL".to_string())
}

/// Deploy the plugin file when missing or stale. Returns true when written.
pub(crate) fn ensure_plugin(app: &tauri::AppHandle) -> Result<bool, String> {
    let path = plugin_file_path(app)?;
    let dir = path.parent().ok_or("plugin dir unavailable")?;
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing == PLUGIN_SOURCE {
        return Ok(false);
    }
    let tmp = dir.join(format!("{PLUGIN_FILE_NAME}.tmp"));
    std::fs::write(&tmp, PLUGIN_SOURCE).map_err(|error| error.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|error| error.to_string())?;
    Ok(true)
}

fn compose_block(app: &tauri::AppHandle) -> Result<String, String> {
    let settings = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map_err(|_| "settings unavailable".to_string())?
        .clone();
    let persona_id = settings.persona_id.clone();
    let (persona, _, skills) = crate::packs::persona_files(app, &persona_id)?;
    let memory = app
        .state::<crate::memory::MemoryState>()
        .0
        .lock()
        .map_err(|_| "memory unavailable".to_string())?
        .as_ref()
        .map(|repository| {
            // No turn text exists on the workbench path at injection time, so
            // this carries anchor memories only; per-turn keyword retrieval
            // stays with the host's own send path.
            crate::memory::retrieval::context_for_turn(
                repository,
                &persona_id,
                "",
                settings.memory_ai_use,
            )
        })
        .transpose()
        .map_err(|_| "memory unavailable".to_string())?
        .map(|context| context.prompt_block)
        .filter(|block| !block.is_empty());
    Ok(std::iter::once(persona)
        .chain(skills)
        .chain(memory)
        .collect::<Vec<_>>()
        .join("\n\n"))
}

fn fingerprint(block: &str) -> String {
    block.chars().take(FINGERPRINT_CHARS).collect()
}

fn read_exclude_sessions(path: &Path) -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    value
        .get("excludeSessions")
        .and_then(|sessions| sessions.as_array())
        .map(|sessions| {
            sessions
                .iter()
                .filter_map(|session| session.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// Rewrite the context file from the current persona/memory state. The plugin
/// reads it per request, so this propagates without a sidecar restart.
pub(crate) fn write_context(app: &tauri::AppHandle) -> Result<(), String> {
    let path = context_file_path(app)?;
    let dir = path.parent().ok_or("context dir unavailable")?;
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let block = compose_block(app)?;
    let context = ContextFile {
        version: 1,
        fingerprint: fingerprint(&block),
        block,
        exclude_sessions: read_exclude_sessions(&path),
        skip_when_head_includes: vec![crate::worklog::reports::SYSTEM
            .chars()
            .take(SKIP_MARKER_CHARS)
            .collect()],
    };
    let tmp = dir.join(format!("{CONTEXT_FILE_NAME}.tmp"));
    let serialized =
        serde_json::to_string(&context).map_err(|_| "context serialization failed".to_string())?;
    std::fs::write(&tmp, serialized).map_err(|error| error.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|error| error.to_string())?;
    Ok(())
}

/// Insert the plugin spec into a serialized sidecar config (any source).
pub(crate) fn with_plugin(config: String, app: &tauri::AppHandle) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&config) else {
        return config;
    };
    let Ok(spec) = plugin_spec(app) else {
        return config;
    };
    value["plugin"] = serde_json::json!([spec]);
    value.to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn plugin_source_declares_the_transform_hook() {
        assert!(super::PLUGIN_SOURCE.contains("experimental.chat.system.transform"));
        assert!(super::PLUGIN_SOURCE.contains("YUME_CONTEXT_FILE"));
    }

    #[test]
    fn fingerprint_uses_block_prefix() {
        let block = "abc".repeat(40);
        assert_eq!(super::fingerprint(&block).chars().count(), 64);
        assert!(block.contains(&super::fingerprint(&block)));
    }
}
