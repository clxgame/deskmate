use super::super::{contract::ReportKind, repository::Repository};
use super::tests::{fixture, now};

fn add_daily(repo: &Repository, origin: &str, stale: bool) {
    repo.store.with_connection(|db|{
        db.execute("INSERT INTO reports(id,kind,period_start,period_end,current_version_id,stale,updated_at) VALUES('daily','daily','2026-09-07','2026-09-07','daily-v',?1,?2)",rusqlite::params![stale,now().to_rfc3339()])?;
        db.execute("INSERT INTO report_versions(id,report_id,version,body_markdown,origin,source_revision_manifest,source_snapshot,coverage_dates,generated_at) VALUES('daily-v','daily',1,'daily text',?1,'[{\"kind\":\"entry\",\"id\":\"entry\",\"revision\":1}]','[]','[]',?2)",rusqlite::params![origin,now().to_rfc3339()])?;Ok(())
    }).unwrap();
}
fn assert_stale(repo: &Repository, id: &str) {
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
fn entry_inserted_after_snapshot_keeps_generated_report_stale() {
    let repo = fixture();
    let run = repo.claim_run(now()).unwrap().unwrap();
    repo.store.with_connection(|db|{
        db.execute("INSERT INTO work_entries(id,business_date,original_text,text,status,created_at,updated_at) VALUES('new','2026-09-08','new','new','done',?1,?1)",[now().to_rfc3339()])?;Ok(())
    }).unwrap();
    let id = repo
        .publish_run(&run, ("snapshot body", now()))
        .unwrap()
        .unwrap();
    assert_stale(&repo, &id);
}
#[test]
fn new_daily_during_generation_keeps_weekly_stale() {
    let repo = fixture();
    let run = repo.claim_run(now()).unwrap().unwrap();
    add_daily(&repo, "manual", false);
    let id = repo
        .publish_run(&run, ("snapshot body", now()))
        .unwrap()
        .unwrap();
    assert_stale(&repo, &id);
}
#[test]
fn stale_generated_daily_does_not_mask_current_entry_revision() {
    let repo = fixture();
    add_daily(&repo, "generated", true);
    repo.store
        .with_connection(|db| {
            db.execute(
                "UPDATE work_entries SET revision=2,text='revised entry' WHERE id='entry'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let run = repo.claim_run(now()).unwrap().unwrap();
    assert_eq!(run.kind, ReportKind::Weekly);
    assert_eq!(run.sources.len(), 1);
    assert_eq!(run.sources[0].source.kind, "entry");
    assert_eq!(run.sources[0].source.revision, 2);
    assert!(run.sources[0].text.contains("revised entry"));
}
#[test]
fn stale_manual_daily_is_preserved_without_hiding_updated_entry_or_claiming_freshness() {
    let repo = fixture();
    add_daily(&repo, "manual", true);
    repo.store
        .with_connection(|db| {
            db.execute(
                "UPDATE work_entries SET revision=2,text='revised entry' WHERE id='entry'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let run = repo.claim_run(now()).unwrap().unwrap();
    assert_eq!(run.sources.len(), 2);
    assert!(run.sources.iter().any(|source| source.text == "daily text"));
    assert!(run.sources.iter().any(|source| source.source.id == "entry"
        && source.source.revision == 2
        && source.text.contains("supersedes revision 1")));
    let id = repo
        .publish_run(&run, ("manual plus revision", now()))
        .unwrap()
        .unwrap();
    assert_stale(&repo, &id);
}
