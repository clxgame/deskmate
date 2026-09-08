use super::super::{error::WorklogError, repository::Repository, storage::WorklogStore};
use chrono::{DateTime, Duration, Utc};
use rusqlite::params;
pub(super) fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-09-08T10:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
}
pub(super) fn fixture() -> Repository {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    repo.store.with_connection(|db|{
        db.execute("INSERT INTO work_entries(id,business_date,original_text,text,status,created_at,updated_at) VALUES('entry','2026-09-07','test','test','done',?1,?1)",[now().to_rfc3339()])?;
        db.execute("INSERT INTO report_runs(id,kind,period_start,period_end,occurrence_key,state,model_id,created_at,updated_at) VALUES('run','weekly','2026-09-07','2026-09-11','manual:test','queued','fixture/test',?1,?1)",[now().to_rfc3339()])?;
        Ok(())
    }).unwrap();
    repo
}
#[test]
fn expired_attempt_is_fenced_and_publication_is_unique() {
    let repo = fixture();
    let first = repo.claim_run(now()).unwrap().unwrap();
    let later = now() + Duration::minutes(7);
    let second = repo.claim_run(later).unwrap().unwrap();
    assert_eq!(second.attempt, 2);
    assert!(repo.publish_run(&first, ("late", later)).is_err());
    let id = repo
        .publish_run(&second, ("complete", later))
        .unwrap()
        .unwrap();
    assert!(repo.publish_run(&second, ("duplicate", later)).is_err());
    repo.store
        .with_connection(|db| {
            assert_eq!(
                db.query_row(
                    "SELECT count(*) FROM report_versions WHERE report_id=?1",
                    [id],
                    |r| r.get::<_, i64>(0)
                )?,
                1
            );
            Ok(())
        })
        .unwrap();
}
#[test]
fn failure_retries_after_one_then_five_minutes_and_stops() {
    let repo = fixture();
    let error = WorklogError::new("MODEL_SERVICE_ERROR", "fixture");
    let first = repo.claim_run(now()).unwrap().unwrap();
    repo.fail_run(&first, (&error, now())).unwrap();
    assert!(repo
        .claim_run(now() + Duration::seconds(59))
        .unwrap()
        .is_none());
    let second = repo
        .claim_run(now() + Duration::minutes(1))
        .unwrap()
        .unwrap();
    repo.fail_run(&second, (&error, now() + Duration::minutes(1)))
        .unwrap();
    assert!(repo
        .claim_run(now() + Duration::minutes(5))
        .unwrap()
        .is_none());
    let third = repo
        .claim_run(now() + Duration::minutes(6))
        .unwrap()
        .unwrap();
    repo.fail_run(&third, (&error, now() + Duration::minutes(6)))
        .unwrap();
    assert!(repo.claim_run(now() + Duration::days(1)).unwrap().is_none());
}
#[test]
fn manual_edit_during_generation_remains_current_and_cancel_rejects_result() {
    let repo = fixture();
    let run = repo.claim_run(now()).unwrap().unwrap();
    repo.store.with_connection(|db| {
        db.execute("INSERT INTO reports(id,kind,period_start,period_end,current_version_id,updated_at) VALUES('manual','weekly','2026-09-07','2026-09-11','manual-v',?1)",[now().to_rfc3339()])?;
        db.execute("INSERT INTO report_versions(id,report_id,version,body_markdown,origin,source_revision_manifest,source_snapshot,coverage_dates,generated_at) VALUES('manual-v','manual',1,'human','manual','[]','[]','[]',?1)",[now().to_rfc3339()])?;Ok(())
    }).unwrap();
    repo.publish_run(&run, ("candidate", now())).unwrap();
    repo.store
        .with_connection(|db| {
            assert_eq!(
                db.query_row(
                    "SELECT current_version_id FROM reports WHERE id='manual'",
                    [],
                    |r| r.get::<_, String>(0)
                )?,
                "manual-v"
            );
            Ok(())
        })
        .unwrap();
    let repo = fixture();
    let run = repo.claim_run(now()).unwrap().unwrap();
    repo.store
        .with_connection(|db| {
            db.execute(
                "UPDATE report_runs SET state='cancelled' WHERE id=?1",
                params![run.id],
            )?;
            Ok(())
        })
        .unwrap();
    assert!(repo.publish_run(&run, ("late", now())).is_err());
}
#[test]
fn empty_material_finishes_without_a_model_result() {
    let repo = fixture();
    repo.store
        .with_connection(|db| {
            db.execute("DELETE FROM work_entries", [])?;
            Ok(())
        })
        .unwrap();
    let run = repo.claim_run(now()).unwrap().unwrap();
    assert!(run.sources.is_empty());
    assert!(repo.publish_run(&run, ("", now())).unwrap().is_none());
}

#[test]
fn schedule_tick_is_persistently_unique_after_clock_rollback() {
    let repo = Repository::new(WorklogStore::memory().unwrap());
    repo.store.with_connection(|db| {
        db.execute("INSERT INTO report_schedules(id,kind,weekday_set,local_time,enabled,created_at,updated_at) VALUES('schedule','weekly','[5]','17:00',1,'2026-08-01T00:00:00+00:00','2026-08-01T00:00:00+00:00')",[])?;Ok(())
    }).unwrap();
    assert_eq!(repo.enqueue_due(now(), "fixture/test").unwrap(), 1);
    assert_eq!(repo.enqueue_due(now(), "fixture/test").unwrap(), 0);
    assert_eq!(
        repo.enqueue_due(now() - Duration::hours(1), "fixture/test")
            .unwrap(),
        0
    );
    assert_eq!(
        repo.enqueue_due(now() + Duration::weeks(1), "fixture/test")
            .unwrap(),
        1
    );
}

#[test]
fn empty_runner_never_looks_up_model_service() {
    struct Unavailable;
    impl super::RunnerEnvironment for Unavailable {
        fn endpoint(&self) -> Option<super::ModelEndpoint> {
            panic!("empty material must not contact model")
        }
        fn changed(&self) {}
    }
    let repo = fixture();
    repo.store
        .with_connection(|db| {
            db.execute("DELETE FROM work_entries", [])?;
            Ok(())
        })
        .unwrap();
    let run = repo.claim_run(Utc::now()).unwrap().unwrap();
    super::execute(
        &repo,
        &run,
        (&Unavailable, &std::sync::atomic::AtomicBool::new(false)),
    )
    .unwrap();
}

#[test]
fn daily_current_version_covers_its_entries_and_later_daily_edit_marks_candidate_stale() {
    let repo = fixture();
    repo.store.with_connection(|db| {
        db.execute("INSERT INTO reports(id,kind,period_start,period_end,current_version_id,updated_at) VALUES('daily','daily','2026-09-07','2026-09-07','daily-v',?1)",[now().to_rfc3339()])?;
        db.execute("INSERT INTO report_versions(id,report_id,version,body_markdown,origin,source_revision_manifest,source_snapshot,coverage_dates,generated_at) VALUES('daily-v','daily',1,'edited daily','manual','[{\"kind\":\"entry\",\"id\":\"entry\",\"revision\":1}]','[]','[]',?1)",[now().to_rfc3339()])?;
        db.execute("INSERT INTO work_entries(id,business_date,original_text,text,status,created_at,updated_at) VALUES('uncovered','2026-09-08','new','new','planned',?1,?1)",[now().to_rfc3339()])?;Ok(())
    }).unwrap();
    let run = repo.claim_run(now()).unwrap().unwrap();
    assert_eq!(run.sources.len(), 2);
    assert!(run
        .sources
        .iter()
        .any(|source| source.text == "edited daily"));
    assert!(run.sources.iter().all(|source| source.source.id != "entry"));
    repo.store.with_connection(|db| {
        db.execute("INSERT INTO report_versions(id,report_id,version,body_markdown,origin,source_revision_manifest,source_snapshot,coverage_dates,generated_at) VALUES('daily-v2','daily',2,'later edit','manual','[]','[]','[]',?1)",[now().to_rfc3339()])?;
        db.execute("UPDATE reports SET current_version_id='daily-v2',revision=2 WHERE id='daily'",[])?;Ok(())
    }).unwrap();
    let id = repo
        .publish_run(&run, ("from frozen daily", now()))
        .unwrap()
        .unwrap();
    repo.store
        .with_connection(|db| {
            assert!(
                db.query_row("SELECT stale FROM reports WHERE id=?1", [id], |row| row
                    .get::<_, bool>(0))?
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn manual_retry_refreezes_material_and_receives_a_fresh_bounded_budget() {
    let repo = fixture();
    let first = repo.claim_run(now()).unwrap().unwrap();
    repo.fail_run(
        &first,
        (&WorklogError::new("MODEL_CONFIGURATION", "fixture"), now()),
    )
    .unwrap();
    repo.retry_run(
        &super::super::contract_runtime::RetryRun {
            request_id: uuid::Uuid::new_v4().to_string(),
            id: first.id.clone(),
        },
        "fixture/rebound",
    )
    .unwrap();
    let second = repo.claim_run(Utc::now()).unwrap().unwrap();
    assert_eq!(second.attempt, 2);
    assert_eq!(second.max_attempt, 4);
    assert_eq!(second.sources.len(), 1);
    assert_eq!(second.model_id, "fixture/rebound");
    repo.fail_run(
        &second,
        (&WorklogError::new("MODEL_SERVICE_ERROR", "fixture"), now()),
    )
    .unwrap();
    assert!(repo
        .claim_run(now() + Duration::seconds(59))
        .unwrap()
        .is_none());
    assert!(repo
        .claim_run(now() + Duration::minutes(1))
        .unwrap()
        .is_some());
}
