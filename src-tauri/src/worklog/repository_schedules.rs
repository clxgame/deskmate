use super::{
    calendar::CalendarRule,
    contract::*,
    contract_runtime::*,
    error::{WorklogError, WorklogResult},
    repository::*,
};
use chrono::{Local, Utc};
use rusqlite::{params, OptionalExtension, Row};

pub(crate) fn schedule_from_row(r: &Row<'_>) -> rusqlite::Result<Schedule> {
    Ok(Schedule {
        id: r.get(0)?,
        kind: decode_enum(r.get(1)?, 1)?,
        weekday_set: decode(r.get(2)?, 2)?,
        local_time: r.get(3)?,
        timezone_mode: r.get(4)?,
        enabled: r.get(5)?,
        revision: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        next_due_at: r.get(9)?,
    })
}
impl Repository {
    pub fn list_schedules(&self) -> WorklogResult<Vec<Schedule>> {
        self.store.with_connection(|db| {
            let mut stmt = db.prepare("SELECT * FROM report_schedules ORDER BY created_at")?;
            let rows = stmt
                .query_map([], schedule_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }
    pub fn save_schedule(&self, request: &SaveSchedule) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done)=replay(db,&request.request_id,request)? {return Ok(done);}
            if request.kind==ReportKind::Custom {return Err(WorklogError::validation("Custom reports cannot be scheduled"));}
            let rule=CalendarRule::parse(&request.weekday_set,&request.local_time,request.kind==ReportKind::Weekly).map_err(WorklogError::validation)?;
            let now=Utc::now();
            let due=if request.enabled {rule.next_due(now,&Local).map(|o|o.due_at.to_rfc3339())} else {None};
            let (id,revision)=match &request.id {
                Some(id)=>{
                    let expected=request.expected_revision.ok_or_else(WorklogError::conflict)?;
                    let changed=db.execute("UPDATE report_schedules SET kind=?1,weekday_set=?2,local_time=?3,enabled=?4,revision=revision+1,updated_at=?5,next_due_at=?6 WHERE id=?7 AND revision=?8",params![enum_text(&request.kind)?,serde_json::to_string(&request.weekday_set)?,request.local_time,request.enabled,now.to_rfc3339(),due,id,expected])?;
                    if changed==0 {return Err(WorklogError::conflict());}
                    db.execute("UPDATE report_runs SET state='cancelled',lease_until=NULL,updated_at=?1 WHERE schedule_id=?2 AND state IN ('queued','retry_wait','running')",params![now.to_rfc3339(),id])?;
                    (id.clone(),expected+1)
                },
                None=>{
                    if request.expected_revision.is_some() {return Err(WorklogError::conflict());}
                    let id=uuid::Uuid::new_v4().to_string();
                    db.execute("INSERT INTO report_schedules(id,kind,weekday_set,local_time,enabled,created_at,updated_at,next_due_at) VALUES (?1,?2,?3,?4,?5,?6,?6,?7)",params![id,enum_text(&request.kind)?,serde_json::to_string(&request.weekday_set)?,request.local_time,request.enabled,now.to_rfc3339(),due])?;
                    (id,1)
                }
            };
            receipt(db,OperationReceipt {operation_id:request.request_id.clone(),entity_kind:"schedule".into(),entity_id:id,revision,business_date:None,status:"committed".into()},request)
        })
    }
    pub fn delete_schedule(&self, request: &DeleteRecord) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done)=replay(db,&request.request_id,request)? {return Ok(done);}
            let revision:Option<i64>=db.query_row("SELECT revision FROM report_schedules WHERE id=?1",[&request.id],|r|r.get(0)).optional()?;
            if revision!=Some(request.expected_revision) {return Err(WorklogError::conflict());}
            db.execute("UPDATE report_runs SET state='cancelled',lease_until=NULL WHERE schedule_id=?1 AND state IN ('queued','retry_wait','running')",[&request.id])?;
            db.execute("DELETE FROM report_schedules WHERE id=?1",[&request.id])?;
            db.execute("UPDATE worklog_operations SET status='deleted' WHERE entity_kind='schedule' AND entity_id=?1",[&request.id])?;
            receipt(db,OperationReceipt {operation_id:request.request_id.clone(),entity_kind:"schedule".into(),entity_id:request.id.clone(),revision:request.expected_revision,business_date:None,status:"deleted".into()},request)
        })
    }
}
