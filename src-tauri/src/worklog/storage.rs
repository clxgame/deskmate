use super::error::{WorklogError, WorklogResult};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::{path::Path, sync::Mutex, time::Duration};

pub const DB_FILE_NAME: &str = "yume-worklog.db";
pub struct WorklogStore {
    connection: Mutex<Connection>,
}
impl WorklogStore {
    pub fn open(path: &Path) -> WorklogResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| {
                WorklogError::new("STORAGE_UNAVAILABLE", "Cannot create journal directory")
            })?;
        }
        let mut connection = Connection::open(path)?;
        configure(&connection)?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > 1 {
            return Err(WorklogError::new(
                "MIGRATION_FAILED",
                "Journal schema is newer than this application",
            ));
        }
        if version == 0 {
            let tables: i64 = connection.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'",
                [],
                |r| r.get(0),
            )?;
            if tables > 0 {
                let busy: i64 =
                    connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))?;
                if busy != 0 {
                    return Err(WorklogError::new(
                        "MIGRATION_FAILED",
                        "Journal checkpoint is busy",
                    ));
                }
                std::fs::copy(path, path.with_extension("db.pre-migration")).map_err(|_| {
                    WorklogError::new(
                        "MIGRATION_FAILED",
                        "Journal backup failed; migration cancelled",
                    )
                })?;
            }
            let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            tx.execute_batch(include_str!("migrations/001_initial.sql"))
                .map_err(|_| WorklogError::new("MIGRATION_FAILED", "Journal migration failed"))?;
            tx.pragma_update(None, "user_version", 1)?;
            tx.commit()?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
    #[cfg(test)]
    pub fn memory() -> WorklogResult<Self> {
        let connection = Connection::open_in_memory()?;
        configure(&connection)?;
        connection.execute_batch(include_str!("migrations/001_initial.sql"))?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
    pub fn with_connection<T>(
        &self,
        body: impl FnOnce(&Connection) -> WorklogResult<T>,
    ) -> WorklogResult<T> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| WorklogError::new("STORAGE_UNAVAILABLE", "Journal lock unavailable"))?;
        body(&connection)
    }
    pub fn with_transaction<T>(
        &self,
        body: impl FnOnce(&Transaction<'_>) -> WorklogResult<T>,
    ) -> WorklogResult<T> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| WorklogError::new("STORAGE_UNAVAILABLE", "Journal lock unavailable"))?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let result = body(&tx)?;
        tx.commit()?;
        Ok(result)
    }
}
fn configure(connection: &Connection) -> WorklogResult<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;",
    )?;
    Ok(())
}
#[cfg(test)]
#[path = "tests/storage.rs"]
mod tests;
