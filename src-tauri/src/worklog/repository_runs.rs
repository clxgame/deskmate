use super::{
    contract::*,
    contract_runtime::*,
    error::{WorklogError, WorklogResult},
    repository::*,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};

pub(crate) fn run_from_row(r: &Row<'_>) -> rusqlite::Result<Run> {
    Ok(Run {
        id: r.get(0)?,
        schedule_id: r.get(1)?,
        kind: decode_enum(r.get(2)?, 2)?,
        period_start: r.get(3)?,
        period_end: r.get(4)?,
        occurrence_key: r.get(5)?,
        state: decode_enum(r.get(6)?, 6)?,
        attempt: r.get(7)?,
        next_retry_at: r.get(8)?,
        lease_until: r.get(9)?,
        session_id: r.get(10)?,
        base_report_revision: r.get(11)?,
        source_manifest: decode(r.get(12)?, 12)?,
        source_snapshot: decode(r.get(13)?, 13)?,
        model_id: r.get(14)?,
        result_report_id: r.get(15)?,
        error_code: r.get(16)?,
        created_at: r.get(17)?,
        updated_at: r.get(18)?,
    })
}
impl Repository {
    pub fn generate_report(&self, request: &GenerateReport) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            let intent=(&request.request_id,&request.kind,&request.period_start,&request.period_end);
            if let Some(done)=replay(db,&request.request_id,&intent)? {return Ok(done);}
            range(&request.period_start,&request.period_end)?;
            if request.kind==ReportKind::Daily && request.period_start!=request.period_end {return Err(WorklogError::validation("Daily reports cover one date"));}
            if request.model_id.split_once('/').is_none() || request.model_id.len()>256 {return Err(WorklogError::validation("Choose a configured provider/model"));}
            let id=uuid::Uuid::new_v4().to_string(); let now=Utc::now().to_rfc3339();
            db.execute("INSERT INTO report_runs(id,kind,period_start,period_end,occurrence_key,state,model_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,'queued',?6,?7,?7)",params![id,enum_text(&request.kind)?,request.period_start,request.period_end,format!("manual:{}",request.request_id),request.model_id,now])?;
            receipt(db,OperationReceipt {operation_id:request.request_id.clone(),entity_kind:"run".into(),entity_id:id,revision:1,business_date:Some(request.period_start.clone()),status:"committed".into()},&intent)
        })
    }
    pub fn list_runs(&self) -> WorklogResult<Vec<Run>> {
        self.store.with_connection(|db| {
            let mut stmt =
                db.prepare("SELECT * FROM report_runs ORDER BY created_at DESC LIMIT 100")?;
            let rows = stmt
                .query_map([], run_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }
    pub fn retry_run(&self, request: &RetryRun, model: &str) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done)=replay(db,&request.request_id,request)? {return Ok(done);}
            if model.split_once('/').is_none() || model.len()>256 {return Err(WorklogError::validation("Choose a configured provider/model"));}
            let run=db.query_row("SELECT * FROM report_runs WHERE id=?1",[&request.id],run_from_row).optional()?.ok_or_else(WorklogError::missing)?;
            match run.state {
                RunState::Failed|RunState::NoMaterial=>{},
                RunState::Queued|RunState::Running|RunState::Succeeded|RunState::RetryWait|RunState::Cancelled=>return Err(WorklogError::conflict()),
            }
            if let Some(schedule)=run.schedule_id {
                let enabled:bool=db.query_row("SELECT enabled FROM report_schedules WHERE id=?1",[schedule],|r|r.get(0))?;
                if !enabled {return Err(WorklogError::conflict());}
            }
            // Attempt remains monotonic so a timed-out former worker cannot publish after a retry.
            db.execute("UPDATE report_runs SET state='queued',max_attempt=attempt+3,next_retry_at=NULL,lease_until=NULL,error_code=NULL,source_manifest='[]',source_snapshot='[]',model_id=?3,updated_at=?1 WHERE id=?2",params![Utc::now().to_rfc3339(),request.id,model])?;
            receipt(db,OperationReceipt {operation_id:request.request_id.clone(),entity_kind:"run".into(),entity_id:request.id.clone(),revision:run.attempt+1,business_date:Some(run.period_start),status:"committed".into()},request)
        })
    }
}
