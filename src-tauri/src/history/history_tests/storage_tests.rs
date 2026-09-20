use super::{ordinary, temp_file};
use crate::history::{
    load_path,
    storage::{persist_path, persist_path_with},
    HistorySession,
};
use std::fs;

#[test]
fn old_history_json_remains_readable() -> Result<(), String> {
    let json = r#"[{"id":"ses-old","title":"Old chat","created":1,"updated":2,"messages":[{"role":"user","text":"hello","time":1}]}]"#;
    let sessions: Vec<HistorySession> =
        serde_json::from_str(json).map_err(|error| error.to_string())?;
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "ses-old");
    assert_eq!(sessions[0].messages[0].text, "hello");
    assert!(sessions[0].origin_run_id.is_none());
    assert!(!sessions[0].deleted);
    Ok(())
}

#[test]
fn corrupt_json_surfaces_and_is_not_overwritten() -> Result<(), String> {
    let path = temp_file("corrupt");
    fs::create_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    fs::write(&path, b"{broken").map_err(|error| error.to_string())?;
    assert_eq!(load_path(&path), Err("history_invalid".to_owned()));
    assert_eq!(
        fs::read(&path).map_err(|error| error.to_string())?,
        b"{broken"
    );
    fs::remove_dir_all(path.parent().ok_or_else(|| "missing parent".to_owned())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn atomic_replace_overwrites_existing_history_without_temp_files() -> Result<(), String> {
    let path = temp_file("replace-existing");
    let parent = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    persist_path(&path, &[ordinary("old")])?;
    persist_path(&path, &[ordinary("new")])?;
    assert_eq!(load_path(&path)?[0].id, "new");
    assert_eq!(
        fs::read_dir(parent)
            .map_err(|error| error.to_string())?
            .count(),
        1
    );
    fs::remove_dir_all(parent).map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn failed_replace_preserves_old_file_and_memory() -> Result<(), String> {
    let path = temp_file("write-failure");
    let parent = path.parent().ok_or_else(|| "missing parent".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(&path, b"old bytes").map_err(|error| error.to_string())?;
    let list = vec![ordinary("new")];
    assert_eq!(
        persist_path_with(&path, &list, |_, _| Err(
            "injected_replace_failure".to_owned()
        )),
        Err("injected_replace_failure".to_owned())
    );
    assert_eq!(
        fs::read(&path).map_err(|error| error.to_string())?,
        b"old bytes"
    );
    assert_eq!(list[0].id, "new");
    assert_eq!(
        fs::read_dir(parent)
            .map_err(|error| error.to_string())?
            .count(),
        1
    );
    fs::remove_dir_all(parent).map_err(|error| error.to_string())?;
    Ok(())
}
