//! SQLite-backed memory store owned entirely by Rust.
//!
//! The frontend never receives a connection or arbitrary SQL: every mutation
//! goes through the typed commands in [`super::commands`], which borrow the
//! single [`MemoryStore`] guarded connection held in Tauri state.

use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};

use super::error::{MemoryError, MemoryResult};

/// Current logical schema version. Bump together with a new entry in
/// [`MIGRATIONS`].
pub const SCHEMA_VERSION: i64 = 2;

/// Database file name inside the Tauri app-data directory.
pub const DB_FILE_NAME: &str = "deskmate-memory.db";

/// One ordered, transactional migration step.
struct Migration {
    /// Version this migration produces.
    to_version: i64,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        to_version: 1,
        sql: include_str!("migrations/001_initial.sql"),
    },
    Migration {
        to_version: 2,
        sql: include_str!("migrations/002_automatic.sql"),
    },
];

/// A connection owner. All memory writes serialize through this mutex so the
/// pet, chat, and settings windows cannot interleave partial updates.
#[derive(Debug)]
pub struct MemoryStore {
    connection: Mutex<Connection>,
}

impl MemoryStore {
    /// Open (or create) the store at `path`, applying pending migrations.
    ///
    /// Pending migrations commit atomically. A failed upgrade leaves the old
    /// schema and committed WAL data intact; future schemas are rejected.
    pub fn open(path: &Path) -> MemoryResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                MemoryError::storage_unavailable(format!("create data dir: {error}"))
            })?;
        }
        let connection = open_connection(path)?;
        let store = Self {
            connection: Mutex::new(connection),
        };
        store.migrate()?;
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

    fn migrate(&self) -> MemoryResult<()> {
        self.migrate_steps(MIGRATIONS)
    }

    fn migrate_steps(&self, migrations: &[Migration]) -> MemoryResult<()> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| MemoryError::storage_unavailable("memory connection poisoned"))?;
        let transaction = guard
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| MemoryError::migration_failed(error.to_string()))?;
        // Read only after acquiring the writer lock; a competing opener may
        // have completed the entire upgrade while this connection waited.
        let current = read_schema_version(&transaction)?;
        reject_future_schema(current)?;
        for migration in migrations.iter().filter(|m| m.to_version > current) {
            transaction
                .execute_batch(migration.sql)
                .map_err(|error| MemoryError::migration_failed(error.to_string()))?;
            transaction
                .pragma_update(None, "user_version", migration.to_version)
                .map_err(|error| MemoryError::migration_failed(error.to_string()))?;
        }
        transaction
            .commit()
            .map_err(|error| MemoryError::migration_failed(error.to_string()))
    }
}

fn reject_future_schema(version: i64) -> MemoryResult<()> {
    if version > SCHEMA_VERSION {
        return Err(MemoryError::migration_failed(format!(
            "unsupported future memory schema {version}; supported {SCHEMA_VERSION}"
        )));
    }
    Ok(())
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
    // Reject a future schema before changing persistent journal settings.
    connection
        .busy_timeout(std::time::Duration::from_millis(100))
        .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
    reject_future_schema(read_schema_version(connection)?)?;
    let started = std::time::Instant::now();
    let budget = std::time::Duration::from_secs(5);
    loop {
        match connection.execute_batch("PRAGMA journal_mode = WAL") {
            Ok(()) => break,
            Err(rusqlite::Error::SqliteFailure(error, _))
                if matches!(
                    error.code,
                    rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                ) && started.elapsed() < budget =>
            {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            Err(error) => {
                return Err(MemoryError::storage_unavailable(format!(
                    "journal_mode WAL: {error}"
                )))
            }
        }
    }
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| MemoryError::storage_unavailable(error.to_string()))?;
    for statement in [
        "PRAGMA foreign_keys = ON",
        "PRAGMA synchronous = NORMAL",
        "PRAGMA secure_delete = ON",
    ] {
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
        let dir =
            std::env::temp_dir().join(format!("deskmate-memory-{label}-{}", uuid::Uuid::new_v4()));
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
    fn failed_upgrade_preserves_old_schema_and_uncheckpointed_wal() {
        let dir = temp_dir("migration-wal");
        let path = dir.join(DB_FILE_NAME);
        let connection = Connection::open(&path).expect("old connection");
        connection
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
            .expect("wal");
        connection
            .execute_batch(MIGRATIONS[0].sql)
            .expect("valid v1 schema");
        connection.execute_batch("PRAGMA user_version=1; INSERT INTO memory_events(id,memory_id,action,created_at) VALUES('e1','m1','created','old'); CREATE TABLE memory_work_links(conflict TEXT);").expect("committed old data and late migration conflict");
        assert!(path.with_extension("db-wal").exists());
        let error = MemoryStore::open(&path).expect_err("late v2 failure");
        assert_eq!(
            error.code(),
            super::super::error::MemoryErrorCode::MigrationFailed
        );
        assert_eq!(read_schema_version(&connection).expect("old version"), 1);
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM memory_events", [], |row| row.get(0))
            .expect("wal row survived");
        assert_eq!(count, 1);
        let partial: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='memory_jobs'",
                [],
                |row| row.get(0),
            )
            .expect("no partial migration");
        assert_eq!(partial, 0);
        drop(connection);
        let reopened = Connection::open(&path).expect("reopen");
        let integrity: String = reopened
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("integrity");
        assert_eq!(integrity, "ok");
        assert_eq!(
            read_schema_version(&reopened).expect("version after reopen"),
            1
        );
        drop(reopened);
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn multiple_pending_migrations_roll_back_as_one_unit() {
        let store = MemoryStore {
            connection: Mutex::new(Connection::open_in_memory().expect("open")),
        };
        let broken = [
            Migration {
                to_version: 1,
                sql: MIGRATIONS[0].sql,
            },
            Migration {
                to_version: 2,
                sql: "CREATE TABLE injected(value TEXT); INVALID SQL;",
            },
        ];
        assert!(store.migrate_steps(&broken).is_err());
        assert_eq!(store.schema_version().expect("version"), 0);
        assert!(!table_exists(&store, "memories"));
        assert!(!table_exists(&store, "injected"));
    }

    #[test]
    fn upgrades_each_supported_schema_and_rejects_future_without_journal_changes() {
        for version in [0, 1, SCHEMA_VERSION, SCHEMA_VERSION + 1] {
            let dir = temp_dir("versions");
            let path = dir.join(DB_FILE_NAME);
            let connection = Connection::open(&path).expect("open fixture");
            for step in MIGRATIONS.iter().filter(|step| step.to_version <= version) {
                connection.execute_batch(step.sql).expect("fixture schema");
            }
            connection
                .pragma_update(None, "user_version", version)
                .expect("fixture version");
            drop(connection);
            if version > SCHEMA_VERSION {
                assert!(MemoryStore::open(&path)
                    .expect_err("future rejected")
                    .message()
                    .contains("future memory schema"));
                let connection = Connection::open(&path).expect("future readable");
                assert_eq!(
                    read_schema_version(&connection).expect("future version intact"),
                    version
                );
                let journal: String = connection
                    .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                    .expect("journal");
                assert_eq!(journal, "delete");
            } else {
                let store = MemoryStore::open(&path).expect("upgrade");
                assert_eq!(
                    store.schema_version().expect("current version"),
                    SCHEMA_VERSION
                );
                assert!(table_exists(&store, "memory_jobs"));
            }
            std::fs::remove_dir_all(dir).expect("cleanup");
        }
    }

    #[test]
    fn wal_initialization_wait_is_bounded_and_can_retry_after_writer_releases() {
        let dir = temp_dir("wal-busy");
        let path = dir.join(DB_FILE_NAME);
        let writer = Connection::open(&path).expect("writer");
        writer
            .execute_batch("CREATE TABLE sentinel(value TEXT); BEGIN IMMEDIATE;")
            .expect("hold rollback-journal write lock");
        let started = std::time::Instant::now();
        assert!(MemoryStore::open(&path).is_err());
        assert!(started.elapsed() < std::time::Duration::from_secs(7));
        assert!(started.elapsed() >= std::time::Duration::from_secs(4));
        writer.execute_batch("ROLLBACK").expect("release");
        drop(writer);
        assert_eq!(
            MemoryStore::open(&path)
                .expect("retry")
                .schema_version()
                .expect("version"),
            SCHEMA_VERSION
        );
        std::fs::remove_dir_all(dir).expect("cleanup");
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
