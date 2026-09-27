//! Automatic and explicit records share the journal, revisions and source invalidation.
use super::{
    contract::*,
    error::*,
    repository::{date, Repository},
    repository_sources,
};
use crate::memory::automatic::{Registration, WorkFact};
use rusqlite::{params, OptionalExtension};

impl Repository {
    pub(crate) fn automatic_entry_visible(
        &self,
        id: &str,
        workspace: Option<&str>,
    ) -> WorklogResult<bool> {
        let project = workspace
            .and_then(|w| std::path::Path::new(w).file_name())
            .map(|p| p.to_string_lossy().into_owned());
        self.store.with_connection(|db| Ok(db.query_row("SELECT EXISTS(SELECT 1 FROM work_entries e WHERE e.id=?1 AND COALESCE(e.project,'')=?2 AND NOT EXISTS(SELECT 1 FROM work_entry_sources s WHERE s.entry_id=e.id AND COALESCE(s.workspace,'')<>?3))",params![id,project.as_deref().unwrap_or(""),workspace.unwrap_or("")],|row|row.get(0))?))
    }
    pub(crate) fn automatic_source(&self, key: &str) -> WorklogResult<Option<(String, i64)>> {
        self.store.with_connection(|db|Ok(db.query_row("SELECT e.id,e.revision FROM work_entry_sources s JOIN work_entries e ON e.id=s.entry_id WHERE s.source_key=?1",[key],|r|Ok((r.get(0)?,r.get(1)?))).optional()?))
    }
    pub(crate) fn entry_revision(&self, id: &str) -> WorklogResult<Option<i64>> {
        self.store.with_connection(|db| {
            Ok(db
                .query_row("SELECT revision FROM work_entries WHERE id=?1", [id], |r| {
                    r.get(0)
                })
                .optional()?)
        })
    }
    pub(crate) fn archive_automatic(
        &self,
        source_key: &str,
        r: &Registration,
        f: &WorkFact,
    ) -> WorklogResult<()> {
        self.store.with_transaction(|db| {
            use sha2::{Digest, Sha256};
            let fact_key=format!("{:x}", Sha256::digest(f.key.as_bytes()));
            let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM work_entry_sources WHERE source_key=?1)",[source_key],|row|row.get(0))?;
            if exists { return Ok(()); }
            super::repository::text(&f.text)?;
            let day=date(&f.business_date)?;
            if day>chrono::Local::now().date_naive() && f.status!=EntryStatus::Planned { return Err(WorklogError::validation("Future work must be planned")); }
            let project=r.workspace.as_deref().and_then(|s|std::path::Path::new(s).file_name()).map(|s|s.to_string_lossy().into_owned());
            let previous:Option<(String,String,i64,String)>=if let Some(id)=&f.target_id {
                db.query_row("SELECT e.id,e.business_date,e.revision,e.updated_at FROM work_entries e WHERE e.id=?1 AND (EXISTS(SELECT 1 FROM work_entry_sources s WHERE s.entry_id=e.id AND COALESCE(s.workspace,'')=?2) OR (NOT EXISTS(SELECT 1 FROM work_entry_sources s WHERE s.entry_id=e.id) AND COALESCE(e.project,'')=?3))",params![id,r.workspace.as_deref().unwrap_or(""),project.as_deref().unwrap_or("")],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?
            } else {
                db.query_row("SELECT e.id,e.business_date,e.revision,e.updated_at FROM work_entries e WHERE e.business_date=?1 AND ((e.text=?2 AND COALESCE(e.project,'')=?3 AND NOT EXISTS(SELECT 1 FROM work_entry_sources s WHERE s.entry_id=e.id AND COALESCE(s.workspace,'')<>?4)) OR EXISTS(SELECT 1 FROM work_entry_sources s WHERE s.entry_id=e.id AND s.fact_key=?5 AND COALESCE(s.workspace,'')=?4)) ORDER BY e.updated_at DESC LIMIT 1",params![f.business_date,f.text,project.as_deref().unwrap_or(""),r.workspace.as_deref().unwrap_or(""),fact_key],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?
            };
            if f.target_id.is_some() && previous.is_none() { return Ok(()); }
            let suppressed:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM work_entry_sources WHERE deleted=1 AND fact_key=?1 AND COALESCE(workspace,'')=?2 AND source_time>=?3)",params![fact_key,r.workspace.as_deref().unwrap_or(""),r.received_at],|row|row.get(0))?;
            if suppressed { return Ok(()); }
            let now=chrono::Utc::now().to_rfc3339();
            let id=if let Some((id,old_date,revision,updated))=previous {
                let newer:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM work_entry_sources WHERE entry_id=?1 AND source_time>?2)",params![id,r.received_at],|row|row.get(0))?;
                if newer { return Ok(()); }
                // A human edit after this source message wins over background processing.
                let updated=chrono::DateTime::parse_from_rfc3339(&updated).map(|t|t.timestamp_millis()).unwrap_or(0);
                if revision>1 && updated>r.received_at { return Ok(()); }
                db.execute("UPDATE work_entries SET business_date=?2,text=?3,status=?4,revision=revision+1,updated_at=?5 WHERE id=?1",params![id,f.business_date,f.text,enum_text(&f.status)?,now])?;
                repository_sources::stale_source(db,"entry",&id)?;
                repository_sources::stale_date(db,&old_date)?;
                id
            } else {
                let id=uuid::Uuid::new_v4().to_string();
                db.execute("INSERT INTO work_entries VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?9)",params![id,f.business_date,project,f.evidence,f.text,enum_text(&f.status)?,r.catalog_key,r.message_id,now])?;
                id
            };
            repository_sources::stale_date(db,&f.business_date)?;
            db.execute("INSERT INTO work_entry_sources(source_key,entry_id,catalog_key,message_id,workspace,fact_key,source_time) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![source_key,id,r.catalog_key,r.message_id,r.workspace,fact_key,r.received_at])?;
            Ok(())
        })
    }
}
