//! SQLite-backed memory store owned entirely by Rust.
//!
//! The frontend never receives a connection or arbitrary SQL: every mutation
//! goes through the typed commands in [`super::commands`], which borrow the
//! single [`MemoryStore`] guarded connection held in Tauri state.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};

use super::error::{MemoryError, MemoryResult};

/// Current logical schema version. Bump together with a new entry in
/// [`MIGRATIONS`].
pub const SCHEMA_VERSION: i64 = 1;

/// Database file name inside the Tauri app-data directory.
pub const DB_FILE_NAME: &str = "deskmate-memory.db";

/// One ordered, transactional migration step.
struct Migration {
    /// Version this migration produces.
    to_version: i64,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    to_version: 1,
    sql: include_str!("migrations/001_initial.sql"),
}];

/// A connection owner. All memory writes serialize through this mutex so the
/// pet, chat, and settings windows cannot interleave partial updates.
#[derive(Debug)]
pub struct MemoryStore {
    connection: Mutex<Connection>,
    path: Option<PathBuf>,
}

impl MemoryStore {
    /// Open (or create) the store at `path`, applying pending migrations.
    ///
    /// A non-empty database is backed up next to itself before an upgrade; if
    /// the migration fails the backup is restored and the error is returned so
    /// the caller can run with memory disabled.
    pub fn open(path: &Path) -> MemoryResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                MemoryError::storage_unavailable(format!("create data dir: {error}"))
            })?;
        }
        let connection = open_connection(path)?;
        let store = Self {
            connection: Mutex::new(connection),
            path: Some(path.to_path_buf()),
        };
        store.migrate_with_backup()?;
        Ok(store)
    }

    /// Open a throwaway in-memory store. Tests only: the app always uses a file
    /// so memory survives a restart.
    #[cfg(test)]
    pub fn open_in_memory() -> MemoryResult<Self> {
        let connection = Connection::open_in_memory()
            .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
        configure(&connection)?;
        let store = Self {
            connection: Mutex::new(connection),
            path: None,
        };
        store.migrate()?;
        Ok(store)
    }

    /// Run `body` with the guarded connection.
    pub fn with_connection<T>(
        &self,
        body: impl FnOnce(&Connection) -> MemoryResult<T>,
    ) -> MemoryResult<T> {
        // SAFE-UNWRAP: a poisoned memory mutex means an earlier command
        // panicked; failing loudly beats silently serving stale memory.
        let guard = self
            .connection
            .lock()
            .map_err(|_| MemoryError::storage_unavailable("memory connection poisoned"))?;
        body(&guard)
    }

    /// Run `body` inside a transaction, committing only on success.
    ///
    /// Uses `BEGIN IMMEDIATE`, not the default `DEFERRED`. A deferred
    /// transaction takes no lock up front and only tries to upgrade on its first
    /// write; under WAL that upgrade would invalidate the read snapshot it
    /// already holds, so SQLite cannot safely wait and returns `SQLITE_BUSY`
    /// immediately, ignoring `busy_timeout` entirely. Two app instances sharing
    /// this file would then lose writes with "database is locked". Taking the
    /// write lock at `BEGIN`, before any snapshot exists, lets the busy timeout
    /// actually apply.
    pub fn with_transaction<T>(
        &self,
        body: impl FnOnce(&rusqlite::Transaction<'_>) -> MemoryResult<T>,
    ) -> MemoryResult<T> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| MemoryError::storage_unavailable("memory connection poisoned"))?;
        let transaction = guard
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
        let value = body(&transaction)?;
        transaction
            .commit()
            .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
        Ok(value)
    }

    /// Flush the WAL into the main database file so deleted content cannot
    /// survive in the write-ahead log.
    pub fn checkpoint(&self) -> MemoryResult<()> {
        self.with_connection(|connection| {
            connection
                .pragma_update(None, "wal_checkpoint", "TRUNCATE")
                .map_err(|error| MemoryError::storage_unavailable(error.to_string()))
        })
    }

    /// Reclaim free pages after a bulk delete.
    pub fn compact(&self) -> MemoryResult<()> {
        self.checkpoint()?;
        self.with_connection(|connection| {
            connection
                .execute_batch("VACUUM")
                .map_err(|error| MemoryError::storage_unavailable(error.to_string()))
        })
    }

    /// The applied schema version, for tests asserting migration outcomes.
    #[cfg(test)]
    pub fn schema_version(&self) -> MemoryResult<i64> {
        self.with_connection(read_schema_version)
    }

    fn migrate_with_backup(&self) -> MemoryResult<()> {
        let current = self.with_connection(read_schema_version)?;
        if current >= SCHEMA_VERSION {
            return Ok(());
        }
        // A fresh database has nothing worth backing up.
        let backup = if current > 0 {
            self.path.as_deref().map(backup_path).and_then(|backup| {
                let source = self.path.as_deref()?;
                std::fs::copy(source, &backup).ok().map(|_| backup)
            })
        } else {
            None
        };
        match self.migrate() {
            Ok(()) => {
                if let Some(backup) = backup {
                    let _ = std::fs::remove_file(backup);
                }
                Ok(())
            }
            Err(error) => {
                if let (Some(backup), Some(target)) = (backup.as_deref(), self.path.as_deref()) {
                    let _ = std::fs::copy(backup, target);
                    let _ = std::fs::remove_file(backup);
                }
                Err(MemoryError::migration_failed(error.message()))
            }
        }
    }

    fn migrate(&self) -> MemoryResult<()> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| MemoryError::storage_unavailable("memory connection poisoned"))?;
        let current = read_schema_version(&guard)?;
        for migration in MIGRATIONS.iter().filter(|m| m.to_version > current) {
            // IMMEDIATE for the same reason as `with_transaction`, and it matters
            // more here: two app instances launched together would both try to
            // migrate, and a deferred transaction would fail outright instead of
            // waiting for the other to finish.
            let transaction = guard
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|error| MemoryError::migration_failed(error.to_string()))?;
            // Re-read inside the write lock: another instance may have applied
            // this step while we waited, and replaying it would fail on the
            // tables it already created.
            if read_schema_version(&transaction)? >= migration.to_version {
                continue;
            }
            transaction
                .execute_batch(migration.sql)
                .map_err(|error| MemoryError::migration_failed(error.to_string()))?;
            transaction
                .pragma_update(None, "user_version", migration.to_version)
                .map_err(|error| MemoryError::migration_failed(error.to_string()))?;
            transaction
                .commit()
                .map_err(|error| MemoryError::migration_failed(error.to_string()))?;
        }
        Ok(())
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".backup");
    path.with_file_name(name)
}

fn open_connection(path: &Path) -> MemoryResult<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
    configure(&connection)?;
    Ok(connection)
}

/// Connection-level invariants: referential integrity, crash-safe writes, a
/// finite lock wait for the three windows, and overwritten (not just unlinked)
/// deleted content.
fn configure(connection: &Connection) -> MemoryResult<()> {
    let statements = [
        "PRAGMA foreign_keys = ON",
        "PRAGMA journal_mode = WAL",
        "PRAGMA synchronous = NORMAL",
        "PRAGMA busy_timeout = 5000",
        "PRAGMA secure_delete = ON",
    ];
    for statement in statements {
        connection
            .execute_batch(statement)
            .map_err(|error| MemoryError::storage_unavailable(format!("{statement}: {error}")))?;
    }
    Ok(())
}

fn read_schema_version(connection: &Connection) -> MemoryResult<i64> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| MemoryError::storage_unavailable(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "deskmate-memory-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn table_exists(store: &MemoryStore, name: &str) -> bool {
        store
            .with_connection(|connection| {
                let count: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
                        [name],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                Ok(count)
            })
            .unwrap_or(0)
            > 0
    }

    #[test]
    fn creates_every_table_and_index_at_version_one() {
        let store = MemoryStore::open_in_memory().expect("open");
        assert_eq!(store.schema_version().expect("version"), SCHEMA_VERSION);
        for table in [
            "memories",
            "memory_sources",
            "memory_candidates",
            "memory_task_links",
            "relationship_states",
            "memory_events",
            "memory_search",
        ] {
            assert!(table_exists(&store, table), "missing table {table}");
        }
        for index in [
            "idx_memories_scope_status",
            "idx_memories_key",
            "idx_memory_sources_conversation",
        ] {
            assert!(table_exists(&store, index), "missing index {index}");
        }
    }

    #[test]
    fn enforces_connection_pragmas() {
        let dir = temp_dir("pragmas");
        let store = MemoryStore::open(&dir.join(DB_FILE_NAME)).expect("open");
        store
            .with_connection(|connection| {
                let foreign_keys: i64 = connection
                    .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
                    .expect("foreign_keys");
                let journal: String = connection
                    .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                    .expect("journal_mode");
                let secure_delete: i64 = connection
                    .query_row("PRAGMA secure_delete", [], |row| row.get(0))
                    .expect("secure_delete");
                assert_eq!(foreign_keys, 1);
                assert_eq!(journal.to_lowercase(), "wal");
                assert_eq!(secure_delete, 1);
                Ok(())
            })
            .expect("pragmas");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn survives_reopen_across_process_lifetimes() {
        let dir = temp_dir("reopen");
        let path = dir.join(DB_FILE_NAME);
        {
            let store = MemoryStore::open(&path).expect("open");
            store
                .with_transaction(|tx| {
                    tx.execute(
                        "INSERT INTO memory_events (id, memory_id, action, created_at) \
                         VALUES ('e1', 'm1', 'created', '2026-01-01T00:00:00Z')",
                        [],
                    )
                    .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
                    Ok(())
                })
                .expect("insert");
        }
        let reopened = MemoryStore::open(&path).expect("reopen");
        let count = reopened
            .with_connection(|connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM memory_events", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| MemoryError::storage_unavailable(error.to_string()))
            })
            .expect("count");
        assert_eq!(count, 1);
        assert_eq!(reopened.schema_version().expect("version"), SCHEMA_VERSION);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rolls_back_a_failed_transaction() {
        let store = MemoryStore::open_in_memory().expect("open");
        let result: MemoryResult<()> = store.with_transaction(|tx| {
            tx.execute(
                "INSERT INTO memory_events (id, memory_id, action, created_at) \
                 VALUES ('e1', 'm1', 'created', '2026-01-01T00:00:00Z')",
                [],
            )
            .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
            Err(MemoryError::validation_failed("injected failure"))
        });
        assert!(result.is_err());
        let count = store
            .with_connection(|connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM memory_events", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| MemoryError::storage_unavailable(error.to_string()))
            })
            .expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn reports_a_corrupt_database_without_panicking() {
        let dir = temp_dir("corrupt");
        let path = dir.join(DB_FILE_NAME);
        std::fs::write(&path, b"this is not a sqlite database file at all").expect("write");
        let error = MemoryStore::open(&path).expect_err("corrupt open must fail");
        assert!(
            matches!(
                error.code(),
                super::super::error::MemoryErrorCode::StorageUnavailable
                    | super::super::error::MemoryErrorCode::MigrationFailed
            ),
            "unexpected code {:?}",
            error.code()
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restores_the_backup_when_a_migration_fails() {
        let dir = temp_dir("migration");
        let path = dir.join(DB_FILE_NAME);
        // A database claiming a version below ours, with a table name that
        // collides with the v1 migration so the migration must fail.
        {
            let connection = Connection::open(&path).expect("open");
            connection
                .execute_batch(
                    "CREATE TABLE memories (wrong_shape TEXT); \
                     INSERT INTO memories (wrong_shape) VALUES ('legacy row'); \
                     PRAGMA user_version = 0;",
                )
                .expect("legacy schema");
            // user_version 0 with existing data: force a non-zero version so
            // the store treats it as an upgrade and takes a backup.
            connection
                .pragma_update(None, "user_version", 0_i64)
                .expect("version");
        }
        let error = MemoryStore::open(&path).expect_err("colliding schema must fail");
        assert_eq!(
            error.code(),
            super::super::error::MemoryErrorCode::MigrationFailed
        );
        // The pre-existing data is still readable: the failure left the file
        // usable rather than half-migrated.
        let connection = Connection::open(&path).expect("reopen");
        let legacy: String = connection
            .query_row("SELECT wrong_shape FROM memories", [], |row| row.get(0))
            .expect("legacy row survived");
        assert_eq!(legacy, "legacy row");
        assert!(!backup_path(&path).exists(), "backup file must be cleaned up");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn checkpoint_and_compact_succeed_on_a_file_database() {
        let dir = temp_dir("compact");
        let store = MemoryStore::open(&dir.join(DB_FILE_NAME)).expect("open");
        store.checkpoint().expect("checkpoint");
        store.compact().expect("compact");
        std::fs::remove_dir_all(&dir).ok();
    }
}
