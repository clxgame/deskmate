use std::{path::{Path, PathBuf}, time::Duration};
use rusqlite::{Connection, TransactionBehavior};
use super::catalog_model::CatalogEntry;
use crate::settings::ConversationModelSelection;

pub(crate) struct CatalogStore { path: PathBuf }

impl CatalogStore {
    pub(crate) fn open(path: &Path) -> Result<Self, String> {
        let parent = path.parent().ok_or("history_catalog_unavailable")?;
        std::fs::create_dir_all(parent).map_err(|_| "history_catalog_unavailable")?;
        let store = Self { path: path.to_owned() };
        let mut connection = store.connection()?;
        let version: u32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(db_error)?;
        if version == 2 { return Ok(store); }
        if version > 2 { return Err("history_catalog_version_unsupported".into()); }

        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
        let version: u32 = transaction.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(db_error)?;
        if version > 2 { return Err("history_catalog_version_unsupported".into()); }
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY NOT NULL, metadata TEXT NOT NULL); CREATE TABLE IF NOT EXISTS directories (directory TEXT PRIMARY KEY NOT NULL); CREATE TABLE IF NOT EXISTS model_selections (key TEXT PRIMARY KEY NOT NULL, selection TEXT NOT NULL); CREATE TABLE IF NOT EXISTS recent_workspaces (directory TEXT PRIMARY KEY NOT NULL, selected_at INTEGER NOT NULL); PRAGMA user_version = 2;").map_err(db_error)?;
        transaction.commit().map_err(db_error)?;
        Ok(store)
    }

    fn connection(&self) -> Result<Connection, String> {
        let connection = Connection::open(&self.path).map_err(db_error)?;
        connection.busy_timeout(Duration::from_secs(5)).map_err(db_error)?;
        connection.pragma_update(None, "synchronous", "FULL").map_err(db_error)?;
        Ok(connection)
    }

    pub(crate) fn register_directory(&self, directory: &str) -> Result<(), String> {
        let directory = super::catalog_model::canonical_directory(directory).map_err(|_| "history_identity_invalid")?;
        self.connection()?.execute("INSERT OR IGNORE INTO directories(directory) VALUES (?1)", [directory]).map_err(db_error)?;
        Ok(())
    }
    pub(crate) fn directories(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT directory FROM directories ORDER BY directory").map_err(db_error)?;
        let rows = statement.query_map([], |row| row.get(0)).map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }
    pub(crate) fn all(&self) -> Result<Vec<CatalogEntry>, String> { read_rows(&self.connection()?) }

    pub(crate) fn model_selection(&self, key: &str) -> Result<ConversationModelSelection, String> {
        self.get(key)?;
        let value = self.connection()?.query_row(
            "SELECT selection FROM model_selections WHERE key = ?1", [key], |row| row.get::<_, String>(0)
        );
        match value {
            Ok(json) => serde_json::from_str(&json).map_err(|_| "history_model_selection_invalid".into()),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(ConversationModelSelection::Inherit),
            Err(error) => Err(db_error(error)),
        }
    }

    pub(crate) fn set_model_selection(&self, key: &str, selection: &ConversationModelSelection) -> Result<(), String> {
        self.get(key)?;
        let json = serde_json::to_string(selection).map_err(|_| "history_model_selection_invalid")?;
        self.connection()?.execute(
            "INSERT INTO model_selections(key, selection) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET selection=excluded.selection",
            (key, json),
        ).map_err(db_error)?;
        Ok(())
    }

    pub(crate) fn remember_workspace(&self, directory: &str, selected_at: u64) -> Result<(), String> {
        let directory = super::catalog_model::canonical_directory(directory).map_err(|_| "history_directory_unavailable")?;
        self.register_directory(&directory)?;
        self.connection()?.execute(
            "INSERT INTO recent_workspaces(directory, selected_at) VALUES (?1, ?2) ON CONFLICT(directory) DO UPDATE SET selected_at=excluded.selected_at",
            (directory, i64::try_from(selected_at).map_err(|_| "history_clock_invalid")?),
        ).map_err(db_error)?;
        Ok(())
    }

    pub(crate) fn recent_workspaces(&self) -> Result<Vec<String>, String> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT directory FROM recent_workspaces ORDER BY selected_at DESC, directory LIMIT 5").map_err(db_error)?;
        let rows = statement.query_map([], |row| row.get(0)).map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }

    pub(crate) fn get(&self, key: &str) -> Result<CatalogEntry, String> {
        self.all()?.into_iter().find(|entry| entry.key() == key).ok_or_else(|| "history_not_found".into())
    }

    pub(crate) fn update<T>(&self, edit: impl FnOnce(&mut Vec<CatalogEntry>) -> Result<T, String>) -> Result<T, String> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
        let mut rows = read_rows(&transaction)?;
        let result = edit(&mut rows)?;
        let mut keys = std::collections::HashSet::new();
        for entry in &mut rows {
            entry.identity.validate().map_err(|_| "history_identity_invalid")?;
            if let super::catalog_model::CatalogIdentity::Native { directory, .. } = &mut entry.identity {
                *directory = super::catalog_model::canonical_directory(directory).map_err(|_| "history_identity_invalid")?;
            }
            if !keys.insert(entry.key()) { return Err("history_catalog_duplicate".into()); }
        }
        transaction.execute("DELETE FROM entries", []).map_err(db_error)?;
        for entry in rows {
            let metadata = serde_json::to_string(&entry).map_err(|_| "history_catalog_invalid")?;
            transaction.execute("INSERT INTO entries(key, metadata) VALUES (?1, ?2)", [entry.key(), metadata]).map_err(db_error)?;
        }
        transaction.execute("DELETE FROM model_selections WHERE key NOT IN (SELECT key FROM entries)", []).map_err(db_error)?;
        transaction.commit().map_err(db_error)?;
        Ok(result)
    }
}

fn read_rows(connection: &Connection) -> Result<Vec<CatalogEntry>, String> {
    let mut statement = connection.prepare("SELECT key, metadata FROM entries ORDER BY key").map_err(db_error)?;
    let raw = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(db_error)?;
    raw.map(|row| {
        let (key, metadata) = row.map_err(db_error)?;
        let entry: CatalogEntry = serde_json::from_str(&metadata).map_err(|_| "history_catalog_invalid")?;
        entry.identity.validate().map_err(|_| "history_identity_invalid")?;
        if key != entry.key() { return Err("history_catalog_invalid".into()); }
        Ok(entry)
    }).collect()
}

fn db_error(_: rusqlite::Error) -> String { "history_catalog_unavailable".into() }
