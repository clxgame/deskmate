use super::contract::enum_text;
use super::error::{WorklogError, WorklogResult};
use super::repository::Repository;
use super::repository_runtime::ClaimedRun;
use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use std::collections::BTreeSet;

impl Repository {
    pub fn publish_run(
        &self,
        run: &ClaimedRun,
        result: (&str, DateTime<Utc>),
    ) -> WorklogResult<Option<String>> {
        let (body, now) = result;
        self.store.with_transaction(|tx| {
            let owns:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM report_runs WHERE id=?1 AND attempt=?2 AND state='running' AND lease_until>?3)",params![run.id,run.attempt,now.to_rfc3339()],|row|row.get(0))?;
            if !owns {return Err(WorklogError::new("RUN_CANCELLED","Report attempt no longer owns its lease"));}
            if run.sources.is_empty() {
                tx.execute("UPDATE report_runs SET state='no_material',lease_until=NULL,updated_at=?2 WHERE id=?1",params![run.id,now.to_rfc3339()])?;
                return Ok(None);
            }
            let current_sources=super::repository_material::freeze(tx,run)?;
            let current_keys:BTreeSet<_>=current_sources.iter().map(super::reports::source_key).collect();
            let frozen_keys:BTreeSet<_>=run.sources.iter().map(super::reports::source_key).collect();
            let mut stale=current_keys!=frozen_keys;
            for source in &run.sources {
                let revision:Option<i64>=match source.source.kind.as_str() {
                    "entry"=>tx.query_row("SELECT revision FROM work_entries WHERE id=?1",[&source.source.id],|row|row.get(0)).optional()?,
                    "daily_version"=>tx.query_row("SELECT version FROM report_versions WHERE id=?1",[&source.source.id],|row|row.get(0)).optional()?,
                    _=>return Err(WorklogError::validation("Unknown source kind")),
                };
                if revision.is_none() {return Err(WorklogError::new("SOURCE_DELETED","A report source was deleted during generation"));}
                stale|=revision!=Some(source.source.revision);
                if source.source.kind=="daily_version" {
                    let current:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM reports WHERE current_version_id=?1 AND stale=0 AND source_deleted=0)",[&source.source.id],|row|row.get(0))?;
                    stale|=!current;
                }
            }
            let existing:Option<(String,i64,Option<String>)>=tx.query_row("SELECT r.id,r.revision,v.origin FROM reports r LEFT JOIN report_versions v ON v.id=r.current_version_id WHERE r.kind=?1 AND r.period_start=?2 AND r.period_end=?3",params![enum_text(&run.kind)?,run.period_start,run.period_end],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
            let(id,revision,origin)=existing.unwrap_or_else(||(uuid::Uuid::new_v4().to_string(),0,None));
            let stamp=now.to_rfc3339();
            tx.execute("INSERT OR IGNORE INTO reports(id,kind,period_start,period_end,revision,updated_at) VALUES(?1,?2,?3,?4,0,?5)",params![id,enum_text(&run.kind)?,run.period_start,run.period_end,stamp])?;
            let version:i64=tx.query_row("SELECT COALESCE(MAX(version),0)+1 FROM report_versions WHERE report_id=?1",[&id],|row|row.get(0))?;
            let version_id=uuid::Uuid::new_v4().to_string();
            let manifest:Vec<_>=run.sources.iter().map(|source|&source.source).collect();
            let dates:BTreeSet<_>=run.sources.iter().map(|source|&source.business_date).collect();
            tx.execute("INSERT INTO report_versions(id,report_id,version,body_markdown,origin,source_revision_manifest,source_snapshot,coverage_dates,generated_at,model_id) VALUES(?1,?2,?3,?4,'generated',?5,?6,?7,?8,?9)",params![version_id,id,version,body,serde_json::to_string(&manifest)?,serde_json::to_string(&run.sources)?,serde_json::to_string(&dates)?,stamp,run.model_id])?;
            for source in manifest {
                tx.execute("INSERT INTO report_sources(version_id,source_kind,source_id,source_revision) VALUES(?1,?2,?3,?4)",params![version_id,source.kind,source.id,source.revision])?;
            }
            let promote=origin.as_deref()!=Some("manual") && (revision==0 || Some(revision)==run.base_revision);
            if promote {
                let previous:Option<String>=tx.query_row("SELECT current_version_id FROM reports WHERE id=?1",[&id],|row|row.get(0))?;
                if let Some(previous)=previous {super::repository_sources::stale_source(tx,"daily_version",&previous)?;}
                tx.execute("UPDATE reports SET current_version_id=?2,revision=revision+1,stale=?3,updated_at=?4 WHERE id=?1",params![id,version_id,stale,stamp])?;
            } else {
                tx.execute("UPDATE reports SET stale=1,updated_at=?2 WHERE id=?1",params![id,stamp])?;
            }
            tx.execute("UPDATE report_runs SET state='succeeded',result_report_id=?2,lease_until=NULL,updated_at=?3 WHERE id=?1",params![run.id,id,stamp])?;
            Ok(Some(id))
        })
    }
}
