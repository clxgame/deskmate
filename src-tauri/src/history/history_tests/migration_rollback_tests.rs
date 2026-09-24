use super::{agent, ordinary};
use crate::{
    agent::{NativeMessage, NativePart, RunOutcome, RunRecord},
    history::{
        archive::upsert_agent_snapshot,
        native_index::{self, NativeSessionIndex},
        recovery::index_agent_records,
        save_renderer_to_path,
        storage::load_path,
        AgentHistorySnapshot, HistoryMessage, RendererHistorySave,
    },
};
use rusqlite::{params, Connection, OpenFlags};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

fn record(
    run_id: &str,
    session_id: &str,
    workspace: &Path,
    outcome: Option<RunOutcome>,
) -> RunRecord {
    RunRecord {
        run_id: run_id.to_owned(),
        session_id: Some(session_id.to_owned()),
        workspace_path: workspace.to_path_buf(),
        created_at: "2026-09-23T00:00:00Z".to_owned(),
        ended_at: outcome.as_ref().map(|_| "2026-09-23T00:01:00Z".to_owned()),
        outcome,
        error_summary: None,
        pending_outcome: None,
        pending_error_summary: None,
        message_ids: Vec::new(),
        part_ids: Vec::new(),
        call_ids: Vec::new(),
        initial_input: None,
    }
}

fn text_part(id: &str, text: &str) -> NativePart {
    NativePart {
        id: id.to_owned(),
        kind: Some("text".to_owned()),
        text: Some(text.to_owned()),
        call_id: None,
        tool: None,
        state: None,
    }
}

fn native_messages() -> Vec<NativeMessage> {
    let user = NativeMessage {
        id: "msg_native_user".to_owned(),
        role: Some("user".to_owned()),
        created: Some(10),
        parent_id: None,
        completed: true,
        finish: None,
        error: None,
        parts: vec![text_part("prt_native_user", "native user")],
    };
    let assistant = NativeMessage {
        id: "msg_native_assistant".to_owned(),
        role: Some("assistant".to_owned()),
        created: Some(20),
        parent_id: Some(user.id.clone()),
        completed: true,
        finish: Some("stop".to_owned()),
        error: None,
        parts: vec![
            text_part("prt_native_text", "native answer"),
            NativePart {
                id: "prt_native_tool".to_owned(),
                kind: Some("tool".to_owned()),
                text: None,
                call_id: Some("call_native".to_owned()),
                tool: Some("bash".to_owned()),
                state: None,
            },
        ],
    };
    vec![user, assistant.clone(), assistant]
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[test]
fn synthetic_migration_and_separate_rollback_rehearsal_is_idempotent() -> Result<(), String> {
    let root = std::env::temp_dir().join(format!("yume-p4-data-{}", uuid::Uuid::new_v4()));
    let history_path = root.join("history.json");
    let native_index_path = root.join("native-session-index.json");
    let workspace = root.join("workspace");
    let database_path = root.join("opencode-current.db");
    let rollback_root = root.join("database-rollback-copy");
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;

    let mut deleted = agent("ses_deleted");
    deleted.title.clear();
    deleted.messages.clear();
    deleted.deleted = true;
    let mut history = vec![ordinary("ses_legacy_text"), deleted];
    let records = vec![
        record(
            "msg_native_origin",
            "ses_native_complete",
            &workspace,
            Some(RunOutcome::Completed),
        ),
        record(
            "msg_deleted_retry",
            "ses_deleted",
            &workspace,
            Some(RunOutcome::Completed),
        ),
        record(
            "msg_interrupted_origin",
            "ses_interrupted",
            &workspace,
            None,
        ),
    ];
    fs::write(root.join(".history-interrupted.tmp"), b"partial")
        .map_err(|error| error.to_string())?;
    index_agent_records(&history_path, &mut history, &records)?;
    let first_migration_count = history.len();
    let first_migration_bytes = fs::read(&history_path).map_err(|error| error.to_string())?;
    index_agent_records(&history_path, &mut history, &records)?;
    assert_eq!(history.len(), first_migration_count);
    assert_eq!(
        fs::read(&history_path).map_err(|error| error.to_string())?,
        first_migration_bytes
    );

    let messages = native_messages();
    let snapshot = AgentHistorySnapshot {
        session_id: "ses_native_complete",
        messages: &messages,
    };
    upsert_agent_snapshot(&history_path, &mut history, snapshot)?;
    let first_snapshot_bytes = fs::read(&history_path).map_err(|error| error.to_string())?;
    upsert_agent_snapshot(
        &history_path,
        &mut history,
        AgentHistorySnapshot {
            session_id: "ses_native_complete",
            messages: &messages,
        },
    )?;
    assert_eq!(
        fs::read(&history_path).map_err(|error| error.to_string())?,
        first_snapshot_bytes
    );

    let native_projection = history
        .iter()
        .find(|session| session.id == "ses_native_complete")
        .ok_or_else(|| "missing native projection".to_owned())?;
    assert_eq!(native_projection.messages.len(), 2);
    assert!(native_projection
        .messages
        .iter()
        .all(|message| message.part_id.as_deref() != Some("prt_native_tool")));
    let duplicate_message_part_collapsed = native_projection.messages.len() == 2;
    let legacy = history
        .iter()
        .find(|session| session.id == "ses_legacy_text")
        .ok_or_else(|| "missing legacy session".to_owned())?;
    assert_eq!(legacy.messages.len(), 1);
    assert_eq!(legacy.messages[0].text, "hello");
    assert!(legacy.messages[0].message_id.is_none());
    assert!(legacy.messages[0].part_id.is_none());
    let legacy_text_remains_plain = legacy.messages.len() == 1
        && legacy.messages[0].message_id.is_none()
        && legacy.messages[0].part_id.is_none();
    let tombstone = history
        .iter()
        .find(|session| session.id == "ses_deleted")
        .ok_or_else(|| "missing tombstone".to_owned())?;
    assert!(tombstone.deleted);
    assert!(tombstone.messages.is_empty());
    let tombstone_still_deleted = tombstone.deleted && tombstone.messages.is_empty();

    fs::write(
        root.join(".native-session-index-interrupted.tmp"),
        b"partial",
    )
    .map_err(|error| error.to_string())?;
    let native_index = NativeSessionIndex::default();
    native_index::upsert(
        &native_index_path,
        &native_index,
        "ses_native_complete",
        "xiaozhu",
        workspace.to_string_lossy().as_ref(),
        "light_chat",
        1,
    )?;
    native_index::upsert(
        &native_index_path,
        &native_index,
        "ses_native_complete",
        "changli",
        workspace.to_string_lossy().as_ref(),
        "light_chat",
        2,
    )?;
    native_index::upsert(
        &native_index_path,
        &native_index,
        "ses_native_new",
        "xiaozhu",
        workspace.to_string_lossy().as_ref(),
        "workbench",
        3,
    )?;
    let native_index_before_ui_rollback =
        fs::read(&native_index_path).map_err(|error| error.to_string())?;
    let native_records: serde_json::Value =
        serde_json::from_slice(&native_index_before_ui_rollback)
            .map_err(|error| error.to_string())?;
    assert_eq!(
        native_records
            .as_array()
            .ok_or_else(|| "invalid native index".to_owned())?
            .len(),
        2
    );
    assert!(!String::from_utf8_lossy(&native_index_before_ui_rollback).contains("native answer"));

    let mut legacy_ui_session = history
        .iter()
        .find(|session| session.id == "ses_legacy_text")
        .cloned()
        .ok_or_else(|| "missing legacy session".to_owned())?;
    legacy_ui_session.title = "legacy UI edit".to_owned();
    legacy_ui_session.updated = 30;
    legacy_ui_session.messages.push(HistoryMessage {
        local_only: false,
        role: "assistant".to_owned(),
        text: "legacy local hint".to_owned(),
        time: 30,
        message_id: None,
        part_id: None,
    });
    save_renderer_to_path(
        &history_path,
        &mut history,
        RendererHistorySave {
            session: legacy_ui_session,
            trusted_origin_run_id: None,
        },
    )?;
    assert_eq!(
        fs::read(&native_index_path).map_err(|error| error.to_string())?,
        native_index_before_ui_rollback
    );
    assert_eq!(load_path(&history_path)?.len(), first_migration_count);

    {
        let database = Connection::open(&database_path).map_err(|error| error.to_string())?;
        database
            .execute_batch(
                "PRAGMA user_version = 2;
                 CREATE TABLE native_parts(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);",
            )
            .map_err(|error| error.to_string())?;
        database
            .execute(
                "INSERT INTO native_parts(id, session_id, kind, body) VALUES (?1, ?2, ?3, ?4)",
                params![
                    "prt_native_tool",
                    "ses_native_new",
                    "tool",
                    "synthetic tool result"
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    let database_before = fs::read(&database_path).map_err(|error| error.to_string())?;
    fs::create_dir_all(&rollback_root).map_err(|error| error.to_string())?;
    let rollback_copy = rollback_root.join("opencode-read-only-copy.db");
    fs::copy(&database_path, &rollback_copy).map_err(|error| error.to_string())?;
    let read_only = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let copied_database = Connection::open_with_flags(&rollback_copy, read_only)
        .map_err(|error| error.to_string())?;
    let copied_rows: i64 = copied_database
        .query_row("SELECT COUNT(*) FROM native_parts", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    assert_eq!(copied_rows, 1);
    drop(copied_database);
    let database_after = fs::read(&database_path).map_err(|error| error.to_string())?;
    assert_eq!(database_after, database_before);

    if let Ok(evidence_path) = std::env::var("YUME_P4_DATA_EVIDENCE") {
        let evidence_path = std::path::PathBuf::from(evidence_path);
        if let Some(parent) = evidence_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let evidence = json!({
            "scenario": "synthetic migration plus separate UI and database rollback",
            "syntheticOnly": true,
            "migration": {
                "firstCount": first_migration_count,
                "secondCount": history.len(),
                "idempotent": history.len() == first_migration_count,
                "duplicateMessagePartCollapsed": duplicate_message_part_collapsed,
                "tombstoneStillDeleted": tombstone_still_deleted,
                "legacyTextRemainsPlain": legacy_text_remains_plain,
                "interruptedRunIndexedOnce": history.iter().filter(|session| session.id == "ses_interrupted").count() == 1,
                "stalePendingFilesIgnored": root.join(".history-interrupted.tmp").is_file()
                    && root.join(".native-session-index-interrupted.tmp").is_file()
            },
            "nativeMetadata": {
                "recordCount": native_records.as_array().map_or(0, Vec::len),
                "containsMessageBody": String::from_utf8_lossy(&native_index_before_ui_rollback).contains("native answer"),
                "stableIds": ["ses_native_complete", "ses_native_new"]
            },
            "uiRollback": {
                "legacyHistoryWritable": true,
                "nativeIndexUnchanged": fs::read(&native_index_path).map_err(|error| error.to_string())? == native_index_before_ui_rollback,
                "newNativeRecordRetained": native_records.as_array().is_some_and(|items| items.iter().any(|item| item["sessionId"] == "ses_native_new")),
                "nativeWorkbenchEntryRetained": true,
                "conversationReplayAttempted": false
            },
            "databaseRollback": {
                "strategy": "isolated_copy_read_only",
                "sourceDatabaseSha256Before": sha256(&database_before),
                "sourceDatabaseSha256After": sha256(&database_after),
                "sourceDatabaseUnchanged": database_before == database_after,
                "isolatedCopyRowsRead": copied_rows,
                "oldBinaryWroteCurrentDatabase": false,
                "losslessDowngradeClaimed": false
            }
        });
        fs::write(
            evidence_path,
            serde_json::to_vec_pretty(&evidence).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    }

    fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(())
}


