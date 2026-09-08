use super::{
    contract::*,
    error::{WorklogError, WorklogResult},
    repository::*,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};

pub(crate) fn report_from_row(r: &Row<'_>) -> rusqlite::Result<Report> {
    Ok(Report {
        id: r.get(0)?,
        kind: decode_enum(r.get(1)?, 1)?,
        period_start: r.get(2)?,
        period_end: r.get(3)?,
        current_version_id: r.get(4)?,
        revision: r.get(5)?,
        stale: r.get(6)?,
        source_deleted: r.get(7)?,
        updated_at: r.get(8)?,
    })
}
pub(crate) fn version_from_row(r: &Row<'_>) -> rusqlite::Result<ReportVersion> {
    Ok(ReportVersion {
        id: r.get(0)?,
        report_id: r.get(1)?,
        version: r.get(2)?,
        body_markdown: r.get(3)?,
        origin: decode_enum(r.get(4)?, 4)?,
        source_revision_manifest: decode(r.get(5)?, 5)?,
        source_snapshot: decode(r.get(6)?, 6)?,
        coverage_dates: decode(r.get(7)?, 7)?,
        generated_at: r.get(8)?,
        model_id: r.get(9)?,
    })
}
impl Repository {
    pub fn list_reports(&self, query: &DateQuery) -> WorklogResult<Vec<Report>> {
        range(&query.start, &query.end)?;
        self.store.with_connection(|db| {
            let mut stmt=db.prepare("SELECT * FROM reports r WHERE period_end>=?1 AND period_start<=?2 AND (?3 IS NULL OR EXISTS (SELECT 1 FROM report_versions v,json_each(v.source_snapshot) s WHERE v.id=r.current_version_id AND json_extract(s.value,'$.project')=?3) OR EXISTS (SELECT 1 FROM report_sources s JOIN report_versions v ON v.id=s.source_id,json_each(v.source_snapshot) j WHERE s.version_id=r.current_version_id AND s.source_kind='daily_version' AND json_extract(j.value,'$.project')=?3)) ORDER BY period_start DESC,kind")?;
            let rows=stmt.query_map(params![query.start,query.end,project(&query.project)?],report_from_row)?.collect::<Result<Vec<_>,_>>()?;
            Ok(rows)
        })
    }
    pub fn get_report(&self, id: &str) -> WorklogResult<ReportDetail> {
        self.store.with_connection(|db| {
            let report = db
                .query_row("SELECT * FROM reports WHERE id=?1", [id], report_from_row)
                .optional()?
                .ok_or_else(WorklogError::missing)?;
            let mut stmt = db.prepare(
                "SELECT * FROM report_versions WHERE report_id=?1 ORDER BY version DESC",
            )?;
            let versions = stmt
                .query_map([id], version_from_row)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ReportDetail { report, versions })
        })
    }
    pub fn save_report(&self, request: &SaveReport) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done)=replay(db,&request.request_id,request)? {return Ok(done);}
            text(&request.body_markdown)?;
            if request.body_markdown.chars().count()>20000 {return Err(WorklogError::validation("Reports are limited to 20000 characters"));}
            range(&request.period_start,&request.period_end)?;
            if request.kind==ReportKind::Daily && request.period_start!=request.period_end {return Err(WorklogError::validation("Daily reports cover one date"));}
            let kind=enum_text(&request.kind)?;
            let prior=db.query_row("SELECT * FROM reports WHERE kind=?1 AND period_start=?2 AND period_end=?3",params![kind,request.period_start,request.period_end],report_from_row).optional()?;
            let now=Utc::now().to_rfc3339();
            let prior_stale=prior.as_ref().is_some_and(|r|r.stale);
            let (id,revision)=match prior {
                Some(report)=> {
                    if request.expected_revision!=Some(report.revision) {return Err(WorklogError::conflict());}
                    (report.id,report.revision+1)
                },
                None=> {
                    if request.expected_revision.is_some() {return Err(WorklogError::conflict());}
                    let id=uuid::Uuid::new_v4().to_string();
                    db.execute("INSERT INTO reports(id,kind,period_start,period_end,updated_at) VALUES (?1,?2,?3,?4,?5)",params![id,kind,request.period_start,request.period_end,now])?;
                    (id,1)
                }
            };
            let version_id=uuid::Uuid::new_v4().to_string();
            let number:i64=db.query_row("SELECT COALESCE(MAX(version),0)+1 FROM report_versions WHERE report_id=?1",[&id],|r|r.get(0))?;
            // Human edits keep existing provenance; direct imports preserve their full original body.
            let previous:Option<(String,String,String)>=db.query_row("SELECT source_revision_manifest,source_snapshot,coverage_dates FROM report_versions WHERE id=(SELECT current_version_id FROM reports WHERE id=?1)",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
            let (manifest,snapshot,coverage)=previous.unwrap_or(("[]".into(),"[]".into(),serde_json::to_string(&vec![request.period_start.clone()])?));
            db.execute("INSERT INTO report_versions VALUES (?1,?2,?3,?4,'manual',?5,?6,?7,?8,NULL)",params![version_id,id,number,request.body_markdown,manifest,snapshot,coverage,now])?;
            db.execute("INSERT INTO report_sources SELECT ?1,source_kind,source_id,source_revision FROM report_sources WHERE version_id=(SELECT current_version_id FROM reports WHERE id=?2)",params![version_id,id])?;
            super::repository_sources::stale_date(db,&request.period_start)?;
            db.execute("UPDATE reports SET stale=?2 WHERE id=?1",params![id,prior_stale])?;
            db.execute("UPDATE reports SET current_version_id=?1,revision=?2,updated_at=?3 WHERE id=?4",params![version_id,revision,now,id])?;
            receipt(db,OperationReceipt {operation_id:request.request_id.clone(),entity_kind:"report".into(),entity_id:id,revision,business_date:Some(request.period_start.clone()),status:"committed".into()},request)
        })
    }
    pub fn apply_version(&self, request: &ApplyVersion) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done)=replay(db,&request.request_id,request)? {return Ok(done);}
            let version=db.query_row("SELECT * FROM report_versions WHERE id=?1 AND report_id=?2",params![request.version_id,request.report_id],version_from_row).optional()?.ok_or_else(WorklogError::missing)?;
            let stale=super::repository_sources::version_stale(db,&version)?;
            let previous:Option<String>=db.query_row("SELECT current_version_id FROM reports WHERE id=?1",[&request.report_id],|r|r.get(0)).optional()?.flatten();
            let id=uuid::Uuid::new_v4().to_string(); let now=Utc::now().to_rfc3339();
            let changed=db.execute("UPDATE reports SET current_version_id=?1,revision=revision+1,updated_at=?2,stale=?5 WHERE id=?3 AND revision=?4",params![id,now,request.report_id,request.expected_revision,stale])?;
            if changed==0 {return Err(WorklogError::conflict());}
            let number:i64=db.query_row("SELECT MAX(version)+1 FROM report_versions WHERE report_id=?1",[&request.report_id],|r|r.get(0))?;
            db.execute("INSERT INTO report_versions VALUES (?1,?2,?3,?4,'manual',?5,?6,?7,?8,?9)",params![id,request.report_id,number,version.body_markdown,serde_json::to_string(&version.source_revision_manifest)?,serde_json::to_string(&version.source_snapshot)?,serde_json::to_string(&version.coverage_dates)?,now,version.model_id])?;
            db.execute("INSERT INTO report_sources SELECT ?1,source_kind,source_id,source_revision FROM report_sources WHERE version_id=?2",params![id,request.version_id])?;
            if let Some(previous)=previous { super::repository_sources::stale_source(db,"daily_version",&previous)?; }
            receipt(db,OperationReceipt {operation_id:request.request_id.clone(),entity_kind:"report".into(),entity_id:request.report_id.clone(),revision:request.expected_revision+1,business_date:None,status:"committed".into()},request)
        })
    }
    pub fn delete_report(&self, request: &DeleteRecord) -> WorklogResult<OperationReceipt> {
        self.store.with_transaction(|db| {
            if let Some(done) = replay(db, &request.request_id, request)? {
                return Ok(done);
            }
            let revision: Option<i64> = db
                .query_row(
                    "SELECT revision FROM reports WHERE id=?1",
                    [&request.id],
                    |r| r.get(0),
                )
                .optional()?;
            if revision != Some(request.expected_revision) {
                return Err(WorklogError::conflict());
            }
            super::repository_sources::erase_report(db, &request.id)?;
            receipt(
                db,
                OperationReceipt {
                    operation_id: request.request_id.clone(),
                    entity_kind: "report".into(),
                    entity_id: request.id.clone(),
                    revision: request.expected_revision,
                    business_date: None,
                    status: "deleted".into(),
                },
                request,
            )
        })
    }
}
