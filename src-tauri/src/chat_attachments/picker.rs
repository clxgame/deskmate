use base64::Engine;
use serde::Serialize;
use std::{fs::File, io::Read, path::PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedChatFile {
    file_name: String,
    base64: String,
}

#[tauri::command]
pub async fn pick_chat_attachment_files(
    window: tauri::WebviewWindow,
    title: Option<String>,
) -> Result<Vec<PickedChatFile>, String> {
    if window.label() != "chat" {
        return Err("chat window required".into());
    }
    let paths = crate::file_picker::pick_files(&window, title, None)?;
    tauri::async_runtime::spawn_blocking(move || read_picked_files(paths))
        .await
        .map_err(|_| "Could not read selected files".to_string())?
}

// Only paths returned by the native dialog enter here. No arbitrary path read
// command is exposed to chat; the frontend receives names and opaque bytes.
fn read_picked_files(paths: Vec<PathBuf>) -> Result<Vec<PickedChatFile>, String> {
    let mut remaining = super::validation::SESSION_TOTAL_BYTES;
    let mut files = Vec::new();
    for path in paths {
        let name = path
            .file_name()
            .ok_or("Invalid file name")?
            .to_string_lossy()
            .into_owned();
        let file = File::open(&path).map_err(|_| format!("Could not read {name}"))?;
        let meta = file
            .metadata()
            .map_err(|_| format!("Could not read {name}"))?;
        if !meta.is_file() {
            return Err(format!("Not a file: {name}"));
        }
        let limit = if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("ncm"))
        {
            super::validation::SESSION_TOTAL_BYTES
        } else {
            super::validation::ORDINARY_AGGREGATE_BYTES
        }
        .min(remaining);
        if meta.len() > limit as u64 {
            return Err(format!(
                "File selection exceeds attachment size limit: {name}"
            ));
        }
        let mut bytes = Vec::new();
        file.take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| format!("Could not read {name}"))?;
        if bytes.len() > limit {
            return Err(format!(
                "File selection exceeds attachment size limit: {name}"
            ));
        }
        remaining -= bytes.len();
        files.push(PickedChatFile {
            file_name: name,
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_is_path_free_and_cancel_is_empty() {
        assert!(read_picked_files(vec![]).unwrap().is_empty());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        std::fs::write(&path, "# selected file").unwrap();
        let files = read_picked_files(vec![path]).unwrap();
        let json = serde_json::to_value(&files).unwrap();
        assert_eq!(json[0]["fileName"], "notes.md");
        assert!(json[0].get("path").is_none());
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(&files[0].base64)
                .unwrap(),
            b"# selected file"
        );
    }
    #[test]
    fn rejects_directories_missing_files_and_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_picked_files(vec![dir.path().to_owned()]).is_err());
        assert!(read_picked_files(vec![dir.path().join("missing")]).is_err());
        let path = dir.path().join("large.txt");
        File::create(&path)
            .unwrap()
            .set_len(20 * 1024 * 1024 + 1)
            .unwrap();
        assert!(read_picked_files(vec![path])
            .unwrap_err()
            .contains("size limit"));
    }
}
