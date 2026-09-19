use super::record_store::{NativeMessage, RunRecord};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentArtifact {
    pub(crate) reference: String,
    pub(crate) run_id: String,
    pub(crate) kind: ArtifactKind,
    pub(crate) label: String,
    pub(crate) path: Option<PathBuf>,
    pub(crate) command: Option<String>,
    pub(crate) result: Option<String>,
    pub(crate) verified: bool,
    #[serde(skip)]
    workspace_root: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ArtifactKind {
    File,
    Command,
}

pub(crate) fn collect(record: &RunRecord, messages: &[NativeMessage]) -> Vec<AgentArtifact> {
    let mut artifacts = Vec::new();
    for message in messages
        .iter()
        .filter(|message| message.parent_id.as_deref() == Some(&record.run_id))
    {
        for part in &message.parts {
            let Some(tool) = part.tool.as_deref() else {
                continue;
            };
            let Some(state) = &part.state else { continue };
            let reference = format!(
                "{}:{}:{}",
                message.id,
                part.id,
                part.call_id.as_deref().unwrap_or("")
            );
            if matches!(tool, "write" | "edit" | "patch") {
                let path = input_path(&state.input)
                    .and_then(|value| resolve_file(&record.workspace_path, value));
                let verified = state.status == "completed" && path.is_some();
                artifacts.push(AgentArtifact {
                    reference,
                    run_id: record.run_id.clone(),
                    kind: ArtifactKind::File,
                    label: path
                        .as_deref()
                        .and_then(Path::file_name)
                        .and_then(|value| value.to_str())
                        .unwrap_or("file")
                        .to_owned(),
                    path,
                    command: None,
                    result: None,
                    verified,
                    workspace_root: record.workspace_path.clone(),
                });
            } else if tool == "bash" {
                let command = state
                    .input
                    .get("command")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
                artifacts.push(AgentArtifact {
                    reference,
                    run_id: record.run_id.clone(),
                    kind: ArtifactKind::Command,
                    label: command.as_deref().unwrap_or("command").to_owned(),
                    path: None,
                    command,
                    result: state
                        .output
                        .as_str()
                        .map(|value| value.chars().take(240).collect()),
                    verified: state.status == "completed"
                        && state
                            .metadata
                            .get("exit")
                            .and_then(serde_json::Value::as_i64)
                            == Some(0),
                    workspace_root: record.workspace_path.clone(),
                });
            }
        }
    }
    artifacts
}

fn input_path(input: &serde_json::Value) -> Option<&str> {
    ["filePath", "path", "file_path"]
        .into_iter()
        .find_map(|key| input.get(key).and_then(serde_json::Value::as_str))
}

fn resolve_file(root: &Path, candidate: &str) -> Option<PathBuf> {
    let path = Path::new(candidate);
    let joined = if path.is_absolute() {
        path.to_owned()
    } else {
        root.join(path)
    };
    let canonical_root = root.canonicalize().ok()?;
    let canonical = joined.canonicalize().ok()?;
    (canonical.is_file() && canonical.starts_with(canonical_root)).then_some(canonical)
}

pub(crate) fn locate_with(
    artifacts: &[AgentArtifact],
    run_id: &str,
    reference: &str,
    locate: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let artifact = artifacts
        .iter()
        .find(|item| item.run_id == run_id && item.reference == reference)
        .ok_or_else(|| "agent_artifact_unknown".to_owned())?;
    if artifact.path.is_none() {
        return Err("agent_artifact_not_file".into());
    }
    let current = current_path(artifact).ok_or_else(|| "agent_artifact_missing".to_owned())?;
    locate(&current)
}

pub(crate) fn current(mut artifact: AgentArtifact) -> AgentArtifact {
    if artifact.kind == ArtifactKind::File && current_path(&artifact).is_none() {
        artifact.verified = false;
    }
    artifact
}

fn current_path(artifact: &AgentArtifact) -> Option<PathBuf> {
    let current = artifact.path.as_deref()?.canonicalize().ok()?;
    let root = artifact.workspace_root.canonicalize().ok()?;
    (current.is_file() && current.starts_with(root)).then_some(current)
}

pub(crate) fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = std::process::Command::new("explorer.exe");
        value.arg("/select,").arg(path);
        value
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut value = std::process::Command::new("/usr/bin/open");
        value.arg("-R").arg(path);
        value
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut value = std::process::Command::new("xdg-open");
        value.arg(
            path.parent()
                .ok_or_else(|| "agent_artifact_missing".to_owned())?,
        );
        value
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|_| "agent_artifact_open_failed".into())
}

#[tauri::command]
pub(crate) async fn agent_artifact_locate(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    run_id: String,
    reference: String,
) -> Result<(), String> {
    crate::tool_permissions::runtime::require_chat(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<super::lifecycle::AgentRunState>();
        let listing = state.read()?;
        let record = listing
            .active
            .into_iter()
            .chain(listing.recent)
            .find(|record| record.run_id == run_id)
            .ok_or_else(|| "agent_run_unknown".to_owned())?;
        let session = record
            .session_id
            .as_deref()
            .ok_or_else(|| "agent_session_unknown".to_owned())?;
        let settings = super::run_commands::current_start_settings(&app)?;
        let snapshot =
            super::run_commands::lifecycle_client(&app, &settings, &record.workspace_path)
                .snapshot(session)?;
        let artifacts = collect(&record, &snapshot);
        locate_with(&artifacts, &run_id, &reference, reveal)
    })
    .await
    .map_err(|_| "agent_worker_failed".to_owned())?
}
