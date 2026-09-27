use super::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;

pub(crate) struct ResourceStore {
    connection: Mutex<Connection>,
    owned_root: PathBuf,
}

fn storage_error(_: impl std::fmt::Display) -> String {
    "resource_storage_unavailable".into()
}

impl ResourceStore {
    pub(crate) fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let connection = Connection::open(path).map_err(storage_error)?;
        connection.execute_batch("PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, directory TEXT, session_id TEXT, owned INTEGER NOT NULL DEFAULT 0, read_base TEXT);
            CREATE TABLE IF NOT EXISTS resource_messages(resource_id TEXT NOT NULL REFERENCES resources(id), directory TEXT NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(resource_id,directory,session_id,message_id));
            CREATE INDEX IF NOT EXISTS resources_session ON resources(session_id);
            CREATE INDEX IF NOT EXISTS resources_message ON resource_messages(directory,session_id,message_id);").map_err(storage_error)?;
        let root = path
            .parent()
            .unwrap_or(Path::new("."))
            .canonicalize()
            .map_err(storage_error)?;
        Ok(Self {
            connection: Mutex::new(connection),
            owned_root: root.join("chat-resource-uploads"),
        })
    }

    pub(crate) fn register_paths(&self, paths: Vec<PathBuf>) -> Result<Vec<ChatResource>, String> {
        if paths.len() > 32 {
            return Err("resource_selection_too_many".into());
        }
        let mut records = Vec::new();
        for input in paths {
            let path = input.canonicalize().map_err(|_| "resource_missing")?;
            let meta = std::fs::metadata(&path).map_err(|_| "resource_missing")?;
            if !meta.is_file() && !meta.is_dir() {
                return Err("resource_not_file_or_directory".into());
            }
            let name = input
                .file_name()
                .or_else(|| path.file_name())
                .and_then(|n| n.to_str())
                .ok_or("resource_invalid_name")?
                .to_owned();
            let (kind, mime) = classify(&path, meta.is_dir());
            records.push(ResourceRecord {
                id: uuid::Uuid::new_v4().to_string(),
                path,
                name,
                kind,
                mime: mime.into(),
            });
        }
        let mut connection = self.connection.lock().map_err(storage_error)?;
        let tx = connection.transaction().map_err(storage_error)?;
        for record in &records {
            tx.execute(
                "INSERT INTO resources(id,path,name,kind,mime) VALUES(?1,?2,?3,?4,?5)",
                params![
                    record.id,
                    record.path.to_str().ok_or("resource_invalid_path")?,
                    record.name,
                    serde_json::to_string(&record.kind).map_err(storage_error)?,
                    record.mime
                ],
            )
            .map_err(storage_error)?;
        }
        tx.commit().map_err(storage_error)?;
        Ok(records.iter().map(ResourceRecord::metadata).collect())
    }

    pub(super) fn get(&self, id: &str) -> Result<ResourceRecord, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "resource_invalid_id")?;
        let connection = self.connection.lock().map_err(storage_error)?;
        connection
            .query_row(
                "SELECT id,path,name,kind,mime FROM resources WHERE id=?1",
                [id],
                read_record,
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| "resource_unknown".into())
    }

    pub(super) fn bind(
        &self,
        directory: &str,
        session: &str,
        ids: &[String],
        message: Option<&str>,
    ) -> Result<Vec<ResourceRecord>, String> {
        if ids.len() > 32
            || !crate::worklog::bridge::safe_id(session)
            || message.is_some_and(|m| !crate::worklog::bridge::safe_id(m))
        {
            return Err("resource_invalid_submission".into());
        }
        let records = ids
            .iter()
            .map(|id| self.get(id))
            .collect::<Result<Vec<_>, _>>()?;
        for record in &records {
            record.checked_path()?;
        }
        let mut connection = self.connection.lock().map_err(storage_error)?;
        let tx = connection.transaction().map_err(storage_error)?;
        for record in &records {
            let owner: (Option<String>, Option<String>) = tx
                .query_row(
                    "SELECT directory,session_id FROM resources WHERE id=?1",
                    [&record.id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(storage_error)?;
            if owner.0.as_deref().is_some_and(|d| d != directory)
                || owner.1.as_deref().is_some_and(|s| s != session)
            {
                return Err("resource_wrong_session".into());
            }
            tx.execute(
                "UPDATE resources SET directory=?1,session_id=?2 WHERE id=?3",
                params![directory, session, record.id],
            )
            .map_err(storage_error)?;
            if let Some(message) = message {
                tx.execute("INSERT OR IGNORE INTO resource_messages(resource_id,directory,session_id,message_id) VALUES(?1,?2,?3,?4)", params![record.id,directory,session,message]).map_err(storage_error)?;
            }
        }
        tx.commit().map_err(storage_error)?;
        Ok(records)
    }

    pub(crate) fn scopes(&self, directory: &str, session: &str) -> Result<Vec<ReadScope>, String> {
        let connection = self.connection.lock().map_err(storage_error)?;
        let mut statement = connection
            .prepare(
                "SELECT id,path,name,kind,mime,read_base FROM resources WHERE directory=?1 AND session_id=?2",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![directory, session], |row| {
                let r = read_record(row)?;
                Ok(ReadScope {
                    path: r.path,
                    directory: r.kind == ResourceKind::Directory,
                    read_base: row.get::<_, Option<String>>(5)?.map(PathBuf::from),
                })
            })
            .map_err(storage_error)?;
        rows.map(|row| row.map_err(storage_error)).collect()
    }

    pub(super) fn set_read_base(
        &self,
        directory: &str,
        session: &str,
        base: &Path,
    ) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(storage_error)?
            .execute(
                "UPDATE resources SET read_base=?1 WHERE directory=?2 AND session_id=?3",
                params![base.to_string_lossy(), directory, session],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub(crate) fn session_directory(&self, session: &str) -> Result<Option<PathBuf>, String> {
        let connection = self.connection.lock().map_err(storage_error)?;
        let mut statement = connection
            .prepare("SELECT DISTINCT directory FROM resources WHERE session_id=?1 LIMIT 2")
            .map_err(storage_error)?;
        let rows = statement
            .query_map([session], |row| row.get::<_, String>(0).map(PathBuf::from))
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        if rows.len() > 1 {
            return Err("resource_ambiguous_session".into());
        }
        Ok(rows.into_iter().next())
    }

    pub(super) fn mark_owned(&self, id: &str) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(storage_error)?
            .execute("UPDATE resources SET owned=1 WHERE id=?1", [id])
            .map_err(storage_error)?;
        Ok(())
    }

    pub(super) fn discard_unbound(&self, ids: &[String]) -> Result<(), String> {
        if ids.len() > 32 {
            return Err("resource_selection_too_many".into());
        }
        for id in ids {
            uuid::Uuid::parse_str(id).map_err(|_| "resource_invalid_id")?;
        }
        let mut connection = self.connection.lock().map_err(storage_error)?;
        let tx = connection.transaction().map_err(storage_error)?;
        let mut owned = Vec::new();
        for id in ids {
            let record: Option<(String, bool)> = tx
                .query_row(
                    "SELECT path,owned FROM resources WHERE id=?1 AND session_id IS NULL",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(storage_error)?;
            if let Some((path, true)) = record {
                owned.push(PathBuf::from(path));
            }
            tx.execute(
                "DELETE FROM resources WHERE id=?1 AND session_id IS NULL",
                [id],
            )
            .map_err(storage_error)?;
        }
        tx.commit().map_err(storage_error)?;
        self.cleanup_owned(owned);
        Ok(())
    }

    pub(crate) fn revoke_session(&self, directory: &str, session: &str) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(storage_error)?;
        let tx = connection.transaction().map_err(storage_error)?;
        let owned = {
            let mut statement = tx
                .prepare(
                    "SELECT path FROM resources WHERE directory=?1 AND session_id=?2 AND owned=1",
                )
                .map_err(storage_error)?;
            let rows = statement
                .query_map(params![directory, session], |row| {
                    row.get::<_, String>(0).map(PathBuf::from)
                })
                .map_err(storage_error)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)?
        };
        tx.execute(
            "DELETE FROM resource_messages WHERE directory=?1 AND session_id=?2",
            params![directory, session],
        )
        .map_err(storage_error)?;
        tx.execute(
            "DELETE FROM resources WHERE directory=?1 AND session_id=?2",
            params![directory, session],
        )
        .map_err(storage_error)?;
        tx.commit().map_err(storage_error)?;
        self.cleanup_owned(owned);
        Ok(())
    }

    fn cleanup_owned(&self, owned: Vec<PathBuf>) {
        for path in owned {
            if path.parent().and_then(Path::parent) != Some(self.owned_root.as_path()) {
                continue;
            }
            // Only delete the app-created upload copy, never a selected original or link target.
            let _ = std::fs::remove_file(&path);
            if let Some(parent) = path.parent() {
                let _ = std::fs::remove_dir(parent);
            }
        }
    }

    pub(super) fn message_resources(
        &self,
        directory: &str,
        session: &str,
        message: &str,
    ) -> Result<Vec<ChatResource>, String> {
        let connection = self.connection.lock().map_err(storage_error)?;
        let mut statement = connection.prepare("SELECT r.id,r.path,r.name,r.kind,r.mime FROM resources r JOIN resource_messages m ON m.resource_id=r.id WHERE m.directory=?1 AND m.session_id=?2 AND m.message_id=?3 ORDER BY m.rowid").map_err(storage_error)?;
        let rows = statement
            .query_map(params![directory, session, message], read_record)
            .map_err(storage_error)?;
        rows.map(|row| row.map(|r| r.metadata()).map_err(storage_error))
            .collect()
    }

    pub(super) fn list_directory(
        &self,
        id: &str,
        relative: &str,
    ) -> Result<DirectoryListing, String> {
        let record = self.get(id)?;
        if record.kind != ResourceKind::Directory {
            return Err("resource_not_directory".into());
        }
        let root = record.checked_path()?;
        if Path::new(relative).components().any(|c| {
            !matches!(
                c,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        }) {
            return Err("resource_outside_directory".into());
        }
        let path = root
            .join(relative)
            .canonicalize()
            .map_err(|_| "resource_missing")?;
        if !path.starts_with(&root) {
            return Err("resource_outside_directory".into());
        }
        let mut entries = Vec::new();
        let mut truncated = false;
        for (inspected, entry) in std::fs::read_dir(path)
            .map_err(|_| "resource_read_failed")?
            .enumerate()
        {
            let entry = entry.map_err(|_| "resource_read_failed")?;
            if entries.len() == 100 || inspected == 1000 {
                truncated = true;
                break;
            }
            // Do not traverse links, including links which escape the selected tree.
            let meta =
                std::fs::symlink_metadata(entry.path()).map_err(|_| "resource_read_failed")?;
            if meta.file_type().is_symlink() || (!meta.is_file() && !meta.is_dir()) {
                continue;
            }
            let (kind, _) = classify(&entry.path(), meta.is_dir());
            entries.push(DirectoryEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                kind,
                size: meta.is_file().then(|| meta.len()),
            });
        }
        entries.sort_by(|a, b| {
            (a.kind != ResourceKind::Directory, a.name.to_lowercase())
                .cmp(&(b.kind != ResourceKind::Directory, b.name.to_lowercase()))
        });
        Ok(DirectoryListing {
            relative_path: relative.to_owned(),
            entries,
            truncated,
        })
    }
}

fn read_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResourceRecord> {
    let kind: String = row.get(3)?;
    let kind = serde_json::from_str(&kind).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(ResourceRecord {
        id: row.get(0)?,
        path: PathBuf::from(row.get::<_, String>(1)?),
        name: row.get(2)?,
        kind,
        mime: row.get(4)?,
    })
}
