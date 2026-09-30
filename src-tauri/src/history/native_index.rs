use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSessionMetadata {
    pub(crate) stable_id: String,
    pub(crate) session_id: String,
    pub(crate) persona_id: String,
    pub(crate) workspace_path: String,
    pub(crate) source: String,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
}

#[derive(Default)]
pub(crate) struct NativeSessionIndex(pub(crate) Mutex<Vec<NativeSessionMetadata>>);

fn load(path: &Path) -> Result<Vec<NativeSessionMetadata>, String> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "native_session_index_invalid".to_owned())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err("native_session_index_unavailable".to_owned()),
    }
}

pub(crate) fn load_into(path: &Path, state: &NativeSessionIndex) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "native_session_index_unavailable")? = load(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{load, load_into, NativeSessionIndex};

    #[test]
    fn loads_legacy_metadata_without_rewriting_the_old_index() {
        let root = std::env::temp_dir().join(format!("yume-native-index-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("native-session-index.json");
        let legacy = include_bytes!("fixtures/native-session-index-v1.json");
        std::fs::write(&path, legacy).unwrap();
        // Interrupted pending files never replace the last committed compatibility index.
        std::fs::write(
            root.join(".native-session-index-interrupted.tmp"),
            b"partial",
        )
        .unwrap();
        let state = NativeSessionIndex::default();
        load_into(&path, &state).unwrap();
        let records = state.0.lock().unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].stable_id, "ses_native_complete");
        assert_eq!(records[0].persona_id, "changli");
        assert_eq!(records[0].created_at, 1);
        assert_eq!(records[0].updated_at, 2);
        assert_eq!(records[1].source, "workbench");
        assert_eq!(records[1].workspace_path, "C:/fixture/workspace");
        assert_eq!(std::fs::read(&path).unwrap(), legacy);
        drop(records);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_old_index_is_empty_and_corrupt_index_is_an_error() {
        let root = std::env::temp_dir().join(format!("yume-native-index-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("native-session-index.json");
        assert!(load(&path).unwrap().is_empty());
        std::fs::write(&path, b"partial").unwrap();
        assert_eq!(load(&path).unwrap_err(), "native_session_index_invalid");
        std::fs::remove_dir_all(root).unwrap();
    }
}
