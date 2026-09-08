use super::{
    contract::*,
    error::{WorklogError, WorklogResult},
    repository::*,
};
use chrono::{Local, Utc};
use rusqlite::{params, Row};

pub(crate) fn entry_from_row(r: &Row<'_>) -> rusqlite::Result<Entry> {
    Ok(Entry {
        id: r.get(0)?,
        business_date: r.get(1)?,
        project: r.get(2)?,
        original_text: r.get(3)?,
        text: r.get(4)?,
        status: decode_enum(r.get(5)?, 5)?,
        source_session_id: r.get(6)?,
        source_message_id: r.get(7)?,
        revision: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}
impl Repository {
    pub fn record_entry(&self, request: &RecordEntry) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done) = replay(db, &request.request_id, request)? {
                return Ok(done);
            }
            text(&request.text)?;
            if request.text.chars().count() > 8000 {
                return Err(WorklogError::validation(
                    "Entries are limited to 8000 characters",
                ));
            }
            text(&request.original_text)?;
            if request.original_text.chars().count() > 8000 {
                return Err(WorklogError::validation(
                    "Entries are limited to 8000 characters",
                ));
            }
            let business_date = date(&request.business_date)?;
            if business_date > Local::now().date_naive() && request.status != EntryStatus::Planned {
                return Err(WorklogError::validation("Future entries must be planned"));
            }
            let id = uuid::Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();
            db.execute(
                "INSERT INTO work_entries VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?9)",
                params![
                    id,
                    request.business_date,
                    project(&request.project)?,
                    request.original_text,
                    request.text.trim(),
                    enum_text(&request.status)?,
                    request.source_session_id,
                    request.source_message_id,
                    now
                ],
            )?;
            super::repository_sources::stale_date(db, &request.business_date)?;
            receipt(
                db,
                OperationReceipt {
                    operation_id: request.request_id.clone(),
                    entity_kind: "entry".into(),
                    entity_id: id,
                    revision: 1,
                    business_date: Some(request.business_date.clone()),
                    status: "committed".into(),
                },
                request,
            )
        })
    }
    pub fn update_entry(&self, request: &UpdateEntry) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done)=replay(db,&request.request_id,request)? { return Ok(done); }
            text(&request.text)?; if request.text.chars().count()>8000 { return Err(WorklogError::validation("Entries are limited to 8000 characters")); }
            if date(&request.business_date)?>Local::now().date_naive() && request.status!=EntryStatus::Planned { return Err(WorklogError::validation("Future entries must be planned")); }
            let old_date:String=db.query_row("SELECT business_date FROM work_entries WHERE id=?1",[&request.id],|r|r.get(0))?;
            let changed=db.execute("UPDATE work_entries SET business_date=?1,project=?2,text=?3,status=?4,revision=revision+1,updated_at=?5 WHERE id=?6 AND revision=?7",params![request.business_date,project(&request.project)?,request.text.trim(),enum_text(&request.status)?,Utc::now().to_rfc3339(),request.id,request.expected_revision])?;
            if changed==0 { return Err(WorklogError::conflict()); }
            super::repository_sources::stale_source(db,"entry",&request.id)?;
            super::repository_sources::stale_date(db,&old_date)?;
            super::repository_sources::stale_date(db,&request.business_date)?;
            receipt(db,OperationReceipt { operation_id:request.request_id.clone(),entity_kind:"entry".into(),entity_id:request.id.clone(),revision:request.expected_revision+1,business_date:Some(request.business_date.clone()),status:"committed".into() },request)
        })
    }
    pub fn query_entries(&self, query: &DateQuery) -> WorklogResult<Vec<Entry>> {
        range(&query.start, &query.end)?;
        self.store.with_connection(|db| {
            let mut stmt=db.prepare("SELECT * FROM work_entries WHERE business_date>=?1 AND business_date<=?2 AND (?3 IS NULL OR project=?3) ORDER BY business_date,created_at,id")?;
            let result=stmt.query_map(params![query.start,query.end,project(&query.project)?],entry_from_row)?.collect::<Result<Vec<_>,_>>()?;
            Ok(result)
        })
    }
    pub fn delete_entry(&self, request: &DeleteRecord) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done)=replay(db,&request.request_id,request)? { return Ok(done); }
            let old_date:String=db.query_row("SELECT business_date FROM work_entries WHERE id=?1",[&request.id],|r|r.get(0))?;
            let changed=db.execute("DELETE FROM work_entries WHERE id=?1 AND revision=?2",params![request.id,request.expected_revision])?;
            if changed==0 { return Err(WorklogError::conflict()); }
            super::repository_sources::erase_source(db,"entry",request)?;
            super::repository_sources::stale_date(db,&old_date)?;
            db.execute("UPDATE worklog_operations SET status='deleted' WHERE entity_kind='entry' AND entity_id=?1",[&request.id])?;
            receipt(db,OperationReceipt { operation_id:request.request_id.clone(),entity_kind:"entry".into(),entity_id:request.id.clone(),revision:request.expected_revision,business_date:None,status:"deleted".into() },request)
        })
    }
}
