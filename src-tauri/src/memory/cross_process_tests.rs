//! Cross-process safety.
//!
//! The app has no single-instance guard, so two `deskmate.exe` processes can
//! open the same database file. Threads inside one process serialize through the
//! store's mutex; separate processes have only SQLite's locking and busy timeout.
//! These tests use real child processes, because an in-process test cannot
//! observe that boundary at all.

use std::path::Path;
use std::process::Command;

use super::domain::{MemoryQuery, MemoryScope, MemoryStatus, MemoryType, NewMemory, SourceKind};
use super::repository::{MemoryRepository, SystemClock};
use super::storage::{MemoryStore, DB_FILE_NAME};

/// Env var that switches the test binary into "act as a second process" mode.
const WRITER_ENV: &str = "DESKMATE_MEMORY_WRITER_DB";
const WRITER_COUNT_ENV: &str = "DESKMATE_MEMORY_WRITER_COUNT";
const WRITER_OFFSET_ENV: &str = "DESKMATE_MEMORY_WRITER_OFFSET";

fn temp_dir(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "deskmate-memory-{label}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn request(index: usize) -> NewMemory {
    NewMemory {
        scope: MemoryScope::Global,
        persona_id: None,
        memory_type: MemoryType::Preference,
        memory_key: Some(format!("cross.{index}")),
        content: format!("跨进程写入 {index}"),
        importance: None,
        expires_at: None,
        source_kind: SourceKind::Explicit,
        conversation_id: Some("ses_cross".into()),
        message_id: Some(format!("msg_{index}")),
        sensitive_confirmed: false,
    }
}

/// Open the store the way the app does and write `count` memories.
fn write_batch(path: &Path, count: usize, offset: usize) {
    let repository = MemoryRepository::new(
        MemoryStore::open(path).expect("second process could not open the store"),
        SystemClock,
    );
    for index in 0..count {
        repository
            .create(&request(offset + index))
            .expect("second process write failed");
    }
}

/// Spawn this same test binary as a genuinely separate OS process.
fn spawn_writer(path: &Path, count: usize, offset: usize) -> std::process::Child {
    Command::new(std::env::current_exe().expect("test binary path"))
        // Run only the helper test, which the env vars below activate.
        .args(["--exact", "memory::cross_process_tests::writer_helper"])
        .arg("--nocapture")
        .env(WRITER_ENV, path)
        .env(WRITER_COUNT_ENV, count.to_string())
        .env(WRITER_OFFSET_ENV, offset.to_string())
        .spawn()
        .expect("spawn second process")
}

/// Not a real test: the child process entry point. It is a no-op unless the
/// parent set [`WRITER_ENV`], so a normal `cargo test` run just skips it.
#[test]
fn writer_helper() {
    let Ok(path) = std::env::var(WRITER_ENV) else {
        return;
    };
    let count: usize = std::env::var(WRITER_COUNT_ENV)
        .expect("count")
        .parse()
        .expect("count parses");
    let offset: usize = std::env::var(WRITER_OFFSET_ENV)
        .expect("offset")
        .parse()
        .expect("offset parses");
    write_batch(Path::new(&path), count, offset);
}

#[test]
fn a_second_process_can_open_the_same_database() {
    let dir = temp_dir("cross-open");
    let path = dir.join(DB_FILE_NAME);

    // This process creates and migrates the database.
    let repository = MemoryRepository::new(
        MemoryStore::open(&path).expect("first open"),
        SystemClock,
    );
    repository.create(&request(0)).expect("first write");

    // A second process opens the already-migrated file.
    let status = spawn_writer(&path, 1, 500)
        .wait()
        .expect("second process finished");
    assert!(
        status.success(),
        "a second process could not use the database: {status:?}"
    );

    let stored = repository.list(&MemoryQuery::default()).expect("list");
    assert_eq!(stored.len(), 2, "the second process's write is missing");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn concurrent_processes_do_not_lose_writes_or_corrupt_the_database() {
    let dir = temp_dir("cross-write");
    let path = dir.join(DB_FILE_NAME);

    const PER_PROCESS: usize = 120;
    const CHILDREN: usize = 3;

    let repository = MemoryRepository::new(
        MemoryStore::open(&path).expect("first open"),
        SystemClock,
    );

    // Two other processes write while this one does too, all through the same
    // file: the pet, chat, and settings windows of a second app instance.
    let children: Vec<_> = (0..CHILDREN)
        .map(|child| spawn_writer(&path, PER_PROCESS, 1_000 * (child + 1)))
        .collect();
    for index in 0..PER_PROCESS {
        repository.create(&request(index)).expect("local write");
    }
    for mut child in children {
        let status = child.wait().expect("child finished");
        assert!(status.success(), "a concurrent process failed: {status:?}");
    }

    let stored = repository
        .list(&MemoryQuery {
            statuses: Some(vec![
                MemoryStatus::Active,
                MemoryStatus::Superseded,
                MemoryStatus::Expired,
            ]),
            limit: Some(i64::MAX),
            ..MemoryQuery::default()
        })
        .expect("list");
    assert_eq!(
        stored.len(),
        PER_PROCESS * (CHILDREN + 1),
        "writes were lost across processes"
    );

    // The file must still be structurally sound, not just row-complete.
    repository
        .store()
        .with_connection(|connection| {
            let integrity: String = connection
                .query_row("PRAGMA integrity_check", [], |row| row.get(0))
                .expect("integrity_check");
            assert_eq!(integrity, "ok", "database corrupted by concurrent processes");
            Ok(())
        })
        .expect("inspect");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn simultaneous_first_launches_migrate_the_database_exactly_once() {
    let dir = temp_dir("cross-migrate");
    let path = dir.join(DB_FILE_NAME);

    // Nothing exists yet: every process below races to create and migrate the
    // schema, which is what happens when two app instances start together.
    let children: Vec<_> = (0..3)
        .map(|child| spawn_writer(&path, 5, 2_000 * (child + 1)))
        .collect();
    let mut failures = Vec::new();
    for (index, mut child) in children.into_iter().enumerate() {
        let status = child.wait().expect("child finished");
        if !status.success() {
            failures.push(format!("process {index}: {status:?}"));
        }
    }
    assert!(
        failures.is_empty(),
        "a concurrent first launch failed to migrate: {failures:?}"
    );

    let repository = MemoryRepository::new(
        MemoryStore::open(&path).expect("open after the race"),
        SystemClock,
    );
    assert_eq!(
        repository.store().schema_version().expect("version"),
        super::storage::SCHEMA_VERSION,
        "the schema did not settle at the current version"
    );
    let stored = repository.list(&MemoryQuery::default()).expect("list");
    assert_eq!(stored.len(), 15, "writes were lost during the migration race");

    std::fs::remove_dir_all(&dir).ok();
}
