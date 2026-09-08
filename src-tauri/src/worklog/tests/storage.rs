use super::*;
#[test]
fn transaction_failure_rolls_back() {
    let store = WorklogStore::memory().unwrap();
    let failed:WorklogResult<()>=store.with_transaction(|db| {
        db.execute("INSERT INTO work_entries VALUES ('x','2026-09-07',NULL,'x','x','done',NULL,NULL,1,'now','now')",[])?;
        Err(WorklogError::validation("injected failure"))
    });
    assert!(failed.is_err());
    store
        .with_connection(|db| {
            assert_eq!(
                db.query_row("SELECT count(*) FROM work_entries", [], |r| r
                    .get::<_, i64>(0))?,
                0
            );
            Ok(())
        })
        .unwrap();
}
#[test]
fn backup_failure_stops_migration() {
    let dir = std::env::temp_dir().join(format!("worklog-migration-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("journal.db");
    {
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE legacy(value TEXT); INSERT INTO legacy VALUES ('preserved');",
        )
        .unwrap();
    }
    std::fs::create_dir(path.with_extension("db.pre-migration")).unwrap();
    assert_eq!(
        WorklogStore::open(&path).err().unwrap().code,
        "MIGRATION_FAILED"
    );
    {
        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.query_row("SELECT value FROM legacy", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "preserved"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn invalid_database_path_reports_failure() {
    let dir = std::env::temp_dir().join(format!("worklog-invalid-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(
        WorklogStore::open(&dir).err().unwrap().code,
        "STORAGE_UNAVAILABLE"
    );
    std::fs::remove_dir(dir).unwrap();
}
