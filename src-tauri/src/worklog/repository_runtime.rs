use super::contract::{ReportKind, SourceRef, SourceSnapshot};
use super::error::{WorklogError, WorklogResult};
use super::repository::Repository;
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, OptionalExtension};

#[derive(Debug, Clone)]
pub struct ClaimedRun {
    pub id: String,
    pub attempt: i64,
    pub max_attempt: i64,
    pub kind: ReportKind,
    pub period_start: String,
    pub period_end: String,
    pub model_id: String,
    pub base_revision: Option<i64>,
    pub sources: Vec<SourceSnapshot>,
}
impl Repository {
    pub fn claim_run(&self, now: DateTime<Utc>) -> WorklogResult<Option<ClaimedRun>> {
        self.store.with_transaction(|tx| {
            let stamp = now.to_rfc3339();
            tx.execute("UPDATE report_runs SET state='failed',error_code='ATTEMPTS_EXHAUSTED',lease_until=NULL WHERE state='running' AND lease_until<=?1 AND attempt>=max_attempt",[&stamp])?;
            let candidate = tx.query_row("SELECT id,attempt,kind,period_start,period_end,model_id,base_report_revision,source_snapshot,state,max_attempt FROM report_runs WHERE state='queued' OR (state='retry_wait' AND next_retry_at<=?1) OR (state='running' AND lease_until<=?1 AND attempt<max_attempt) ORDER BY created_at,id LIMIT 1",[&stamp],|row|Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,String>(5)?,row.get::<_,Option<i64>>(6)?,row.get::<_,String>(7)?,row.get::<_,String>(8)?,row.get::<_,i64>(9)?))).optional()?;
            let Some((id,attempt,kind,start,end,model_id,base_revision,snapshot,state,max_attempt))=candidate else { return Ok(None); };
            let kind: ReportKind = serde_json::from_value(serde_json::Value::String(kind))?;
            let mut run = ClaimedRun {id,attempt:attempt+1,max_attempt,kind,period_start:start,period_end:end,model_id,base_revision,sources:serde_json::from_str(&snapshot)?};
            if state=="queued" {
                run.sources = super::repository_material::freeze(tx,&run)?;
                run.base_revision = tx.query_row("SELECT revision FROM reports WHERE kind=?1 AND period_start=?2 AND period_end=?3",params![super::contract::enum_text(&run.kind)?,run.period_start,run.period_end],|row|row.get(0)).optional()?;
            }
            let manifest: Vec<&SourceRef> = run.sources.iter().map(|source|&source.source).collect();
            tx.execute("UPDATE report_runs SET state='running',attempt=?2,lease_until=?3,session_id=NULL,base_report_revision=?4,source_snapshot=?5,source_manifest=?6,error_code=NULL,updated_at=?7 WHERE id=?1",params![run.id,run.attempt,(now+Duration::minutes(6)).to_rfc3339(),run.base_revision,serde_json::to_string(&run.sources)?,serde_json::to_string(&manifest)?,stamp])?;
            Ok(Some(run))
        })
    }
    pub fn renew_run(&self, run: &ClaimedRun, now: DateTime<Utc>) -> WorklogResult<()> {
        self.store.with_connection(|db| {
            let changed=db.execute("UPDATE report_runs SET lease_until=?3,updated_at=?4 WHERE id=?1 AND attempt=?2 AND state='running' AND lease_until>?4",params![run.id,run.attempt,(now+Duration::minutes(6)).to_rfc3339(),now.to_rfc3339()])?;
            if changed==1 {Ok(())} else {Err(WorklogError::new("RUN_CANCELLED","Report attempt no longer owns its lease"))}
        })
    }
    pub fn set_run_session(&self, run: &ClaimedRun, session: &str) -> WorklogResult<()> {
        self.store.with_connection(|db| {
            let changed=db.execute("UPDATE report_runs SET session_id=?3 WHERE id=?1 AND attempt=?2 AND state='running'",params![run.id,run.attempt,session])?;
            if changed==1 {Ok(())} else {Err(WorklogError::conflict())}
        })
    }
    pub fn fail_run(
        &self,
        run: &ClaimedRun,
        failure: (&WorklogError, DateTime<Utc>),
    ) -> WorklogResult<()> {
        let (error, now) = failure;
        let retry = matches!(
            error.code.as_str(),
            "MODEL_TIMEOUT" | "MODEL_SERVICE_ERROR" | "SIDECAR_UNAVAILABLE"
        ) && run.attempt < run.max_attempt;
        let state = if retry { "retry_wait" } else { "failed" };
        let next = retry.then(|| {
            (now + Duration::minutes(if run.attempt == run.max_attempt - 2 {
                1
            } else {
                5
            }))
            .to_rfc3339()
        });
        self.store.with_connection(|db| {
            db.execute("UPDATE report_runs SET state=?3,next_retry_at=?4,lease_until=NULL,error_code=?5,updated_at=?6 WHERE id=?1 AND attempt=?2 AND state='running'",params![run.id,run.attempt,state,next,error.code,now.to_rfc3339()])?;
            Ok(())
        })
    }
}
