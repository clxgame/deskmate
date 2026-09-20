use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use super::HistorySession;

pub(super) fn load_path(path: &Path) -> Result<Vec<HistorySession>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "history_invalid".to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err("history_storage_unavailable".to_owned()),
    }
}

pub(super) fn persist_path(path: &Path, list: &[HistorySession]) -> Result<(), String> {
    persist_path_with(path, list, replace_file)
}

pub(super) fn persist_path_with(
    path: &Path,
    list: &[HistorySession],
    replace: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "history_storage_unavailable".to_owned())?;
    fs::create_dir_all(parent).map_err(|_| "history_storage_unavailable")?;
    let bytes = serde_json::to_vec_pretty(list).map_err(|_| "history_invalid")?;
    let pending = parent.join(format!(".history-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&pending)
        .map_err(|_| "history_storage_unavailable")?;
    let written = file.write_all(&bytes).and_then(|_| file.sync_all());
    drop(file);
    if written.is_err() {
        let _ = fs::remove_file(&pending);
        return Err("history_storage_unavailable".to_owned());
    }
    let result = replace(&pending, path);
    if result.is_err() {
        let _ = fs::remove_file(pending);
    }
    result
}

#[cfg(windows)]
fn replace_file(pending: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let pending_wide: Vec<u16> = pending.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: Category 8 (FFI boundary). Both pointers reference live,
    // NUL-terminated UTF-16 buffers for the duration of this synchronous call;
    // the Windows API only reads them and accepts this documented flag pair.
    let moved = unsafe {
        MoveFileExW(
            pending_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    (moved != 0)
        .then_some(())
        .ok_or_else(|| "history_storage_unavailable".to_owned())
}

#[cfg(not(windows))]
fn replace_file(pending: &Path, target: &Path) -> Result<(), String> {
    fs::rename(pending, target).map_err(|_| "history_storage_unavailable".to_owned())
}
