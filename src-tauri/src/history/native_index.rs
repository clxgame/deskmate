use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::Mutex,
};

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

fn persist(path: &Path, records: &[NativeSessionMetadata]) -> Result<(), String> {
    let parent = path.parent().ok_or("native_session_index_unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "native_session_index_unavailable")?;
    let pending = parent.join(format!(
        ".native-session-index-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let bytes = serde_json::to_vec_pretty(records).map_err(|_| "native_session_index_invalid")?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&pending)
        .map_err(|_| "native_session_index_unavailable")?;
    if file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&pending);
        return Err("native_session_index_unavailable".to_owned());
    }
    drop(file);
    replace(&pending, path).inspect_err(|_| {
        let _ = fs::remove_file(&pending);
    })
}

#[cfg(windows)]
fn replace(pending: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let pending: Vec<u16> = pending.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: both buffers are live, NUL-terminated UTF-16 paths for this synchronous Windows call.
    let moved = unsafe {
        MoveFileExW(
            pending.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    (moved != 0)
        .then_some(())
        .ok_or_else(|| "native_session_index_unavailable".to_owned())
}

#[cfg(not(windows))]
fn replace(pending: &Path, target: &Path) -> Result<(), String> {
    fs::rename(pending, target).map_err(|_| "native_session_index_unavailable".to_owned())
}

pub(crate) fn load_into(path: &Path, state: &NativeSessionIndex) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "native_session_index_unavailable")? = load(path)?;
    Ok(())
}

pub(crate) fn upsert(
    path: &Path,
    state: &NativeSessionIndex,
    session_id: &str,
    persona_id: &str,
    workspace_path: &str,
    source: &str,
    now: u64,
) -> Result<(), String> {
    if !crate::worklog::bridge::safe_id(session_id) || !matches!(source, "light_chat" | "workbench")
    {
        return Err("native_session_metadata_invalid".to_owned());
    }
    let mut records = state
        .0
        .lock()
        .map_err(|_| "native_session_index_unavailable")?;
    if let Some(record) = records
        .iter_mut()
        .find(|record| record.session_id == session_id)
    {
        record.persona_id = persona_id.to_owned();
        record.workspace_path = workspace_path.to_owned();
        record.source = source.to_owned();
        record.updated_at = now;
    } else {
        records.push(NativeSessionMetadata {
            stable_id: session_id.to_owned(),
            session_id: session_id.to_owned(),
            persona_id: persona_id.to_owned(),
            workspace_path: workspace_path.to_owned(),
            source: source.to_owned(),
            created_at: now,
            updated_at: now,
        });
    }
    records.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    persist(path, &records)
}

#[cfg(test)]
mod tests {
    use super::{load, upsert, NativeSessionIndex};

    #[test]
    fn repeated_registration_keeps_one_stable_native_session_record() {
        // Given a native session registered from the workbench.
        let root = std::env::temp_dir().join(format!("yume-native-index-{}", uuid::Uuid::new_v4()));
        let path = root.join("native-session-index.json");
        let state = NativeSessionIndex::default();
        upsert(
            &path,
            &state,
            "ses_one",
            "xiaozhu",
            "C:/workspace",
            "workbench",
            1,
        )
        .unwrap();
        // When the same stable session is observed again.
        upsert(
            &path,
            &state,
            "ses_one",
            "changli",
            "C:/workspace",
            "workbench",
            2,
        )
        .unwrap();
        // Then the index stays idempotent and preserves the original creation time.
        let records = load(&path).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].stable_id, "ses_one");
        assert_eq!(records[0].persona_id, "changli");
        assert_eq!(records[0].created_at, 1);
        assert_eq!(records[0].updated_at, 2);
        std::fs::remove_dir_all(root).unwrap();
    }
}


