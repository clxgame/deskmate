use super::*;
use crate::memory::{
    domain::*,
    error::{MemoryError, MemoryResult},
    policy,
    repository::{insert_memory, insert_source, Clock, MemoryRepository},
};
use rusqlite::{params, OptionalExtension};

/// A mutation invalidates unfinished memory proposals, without erasing the other branch.
pub(crate) fn invalidate(
    db: &rusqlite::Connection,
    memory: bool,
    worklog: bool,
) -> MemoryResult<()> {
    db.execute("UPDATE memory_automation_state SET memory_epoch=memory_epoch+?1, log_epoch=log_epoch+?2 WHERE id=1", params![memory as i64, worklog as i64])?;
    db.execute(
        "UPDATE memory_jobs SET payload=NULL WHERE state IN ('pending','ready')",
        [],
    )?;
    Ok(())
}

impl<C: Clock> MemoryRepository<C> {
    pub(crate) fn automation_epochs(&self) -> MemoryResult<(i64, i64)> {
        self.store.with_connection(|db| {
            Ok(db.query_row(
                "SELECT memory_epoch,log_epoch FROM memory_automation_state WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?)
        })
    }
    pub(crate) fn invalidate_automation(&self, memory: bool, worklog: bool) -> MemoryResult<()> {
        self.store
            .with_transaction(|db| invalidate(db, memory, worklog))
    }
    pub(crate) fn work_links(&self) -> MemoryResult<Vec<(String, String, i64)>> {
        self.store.with_connection(|db| {
            let mut stmt =
                db.prepare("SELECT memory_id,entry_id,revision FROM memory_work_links")?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }
    pub(crate) fn link_work(
        &self,
        job: &Job,
        f: &Fact,
        entry: &str,
        revision: i64,
    ) -> MemoryResult<()> {
        let r = &job.registration;
        let persona = if f.scope == "global" {
            ""
        } else {
            &r.persona_id
        };
        let workspace = if f.scope == "workspace" {
            r.workspace.as_deref().unwrap_or("")
        } else {
            ""
        };
        let key = format!(
            "auto.{}",
            hash(&format!("{}|{}|{}|{}", f.scope, persona, workspace, f.key))
        );
        self.store.with_connection(|db|{db.execute("INSERT OR IGNORE INTO memory_work_links SELECT c.memory_id,?3,?4 FROM memory_consumed c JOIN memories m ON m.id=c.memory_id WHERE c.job_id=?1 AND c.fact_key=?2 AND m.status='active'",params![job.id,key,entry,revision])?;Ok(())})
    }
    pub(crate) fn pending_sources(
        &self,
        persona: &str,
        workspace: Option<&str>,
    ) -> MemoryResult<Vec<Registration>> {
        self.store.with_connection(|db| {
            let mut stmt=db.prepare("SELECT registration FROM memory_jobs WHERE state IN ('pending','ready') AND memory_done=0 AND memory_epoch=(SELECT memory_epoch FROM memory_automation_state WHERE id=1) AND created_at>?1 ORDER BY created_at DESC LIMIT 12")?;
            let rows=stmt.query_map([now()-30*60*1000],|r|r.get::<_,String>(0))?;
            let mut sources=Vec::new();
            for row in rows { let r:Registration=serde_json::from_str(&row?).map_err(|_|MemoryError::validation_failed("invalid registration"))?;if r.memory && r.persona_id==persona && r.workspace.as_deref()==workspace {sources.push(r); if sources.len()==2 {break;}} }
            Ok(sources)
        })
    }
    pub(crate) fn automation_status(&self) -> MemoryResult<serde_json::Value> {
        self.store.with_connection(|db| {
            let pending: i64 = db.query_row(
                "SELECT count(*) FROM memory_jobs WHERE state IN ('pending','ready')",
                [],
                |r| r.get(0),
            )?;
            let failed: i64 = db.query_row(
                "SELECT count(*) FROM memory_jobs WHERE state='failed'",
                [],
                |r| r.get(0),
            )?;
            Ok(serde_json::json!({"pending":pending,"failed":failed}))
        })
    }
    pub(crate) fn retry_automatic(&self) -> MemoryResult<()> {
        self.store.with_connection(|db|{db.execute("UPDATE memory_jobs SET state='pending',attempts=0,due_at=?1,error_code=NULL WHERE state='failed'",[now()])?;Ok(())})
    }
    pub(crate) fn register_automatic(&self, r: &Registration) -> MemoryResult<String> {
        let id = hash(&format!("{}:{}", r.catalog_key, r.message_id));
        let json = serde_json::to_string(r)
            .map_err(|_| MemoryError::validation_failed("invalid registration"))?;
        self.store.with_transaction(|db| {
            db.execute("INSERT OR IGNORE INTO memory_jobs(id,registration,memory_epoch,log_epoch,memory_done,log_done,due_at,created_at) SELECT ?1,?2,memory_epoch,log_epoch,?3,?4,?5,?6 FROM memory_automation_state WHERE id=1",params![id,json,(!r.memory) as i64,(!r.worklog) as i64,now()+2000,now()])?;
            Ok(id)
        })
    }
    pub(crate) fn next_automatic(&self) -> MemoryResult<Option<Job>> {
        self.store.with_connection(|db| {
            let row = db.query_row("SELECT id,registration,memory_epoch,log_epoch,memory_done,log_done,payload,attempts,child_session FROM memory_jobs WHERE (state IN ('pending','ready') OR child_session IS NOT NULL) AND due_at<=?1 ORDER BY created_at LIMIT 1",[now()],|r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get(2)?,r.get(3)?,r.get::<_,i64>(4)? != 0,r.get::<_,i64>(5)? != 0,r.get(6)?,r.get(7)?,r.get(8)?))).optional()?;
            row.map(|(id,registration,memory_epoch,log_epoch,memory_done,log_done,payload,attempts,child_session)| Ok(Job { id, registration:serde_json::from_str(&registration).map_err(|_| MemoryError::validation_failed("invalid queued registration"))?,memory_epoch,log_epoch,memory_done,log_done,payload,attempts,child_session })).transpose()
        })
    }
    pub(crate) fn automatic_payload(&self, id: &str, payload: &Extraction) -> MemoryResult<()> {
        let payload = serde_json::to_string(payload)
            .map_err(|_| MemoryError::validation_failed("invalid extraction"))?;
        self.store.with_connection(|db| {
            db.execute(
                "UPDATE memory_jobs SET payload=?2,state='ready' WHERE id=?1",
                params![id, payload],
            )?;
            Ok(())
        })
    }
    pub(crate) fn automatic_child(&self, id: &str, child: Option<&str>) -> MemoryResult<()> {
        self.store.with_connection(|db| {
            db.execute(
                "UPDATE memory_jobs SET child_session=?2 WHERE id=?1",
                params![id, child],
            )?;
            Ok(())
        })
    }
    pub(crate) fn finish_automatic(&self, id: &str) -> MemoryResult<()> {
        self.store.with_connection(|db| { db.execute("UPDATE memory_jobs SET state='done',payload=NULL,memory_done=1,log_done=1,error_code=NULL WHERE id=?1",[id])?; Ok(()) })
    }
    pub(crate) fn delay_automatic(&self, id: &str, error: Option<&str>) -> MemoryResult<()> {
        self.store.with_connection(|db| {
            if let Some(error) = error {
                db.execute("UPDATE memory_jobs SET attempts=attempts+1,due_at=?2,error_code=?3,state=CASE WHEN attempts>=2 THEN 'failed' ELSE state END,payload=CASE WHEN attempts>=2 THEN NULL ELSE payload END WHERE id=?1",params![id,now()+15_000,error])?;
            } else { db.execute("UPDATE memory_jobs SET due_at=?2 WHERE id=?1",params![id,now()+3000])?; }
            Ok(())
        })
    }
    pub(crate) fn automatic_branch_done(&self, id: &str, memory: bool) -> MemoryResult<()> {
        self.store.with_connection(|db| {
            db.execute(
                if memory {
                    "UPDATE memory_jobs SET memory_done=1 WHERE id=?1"
                } else {
                    "UPDATE memory_jobs SET log_done=1 WHERE id=?1"
                },
                [id],
            )?;
            Ok(())
        })
    }
    pub(crate) fn apply_automatic_memories(&self, job: &Job, facts: &[Fact]) -> MemoryResult<()> {
        let now_text = self.clock.now();
        self.store.with_transaction(|db| {
            let epoch: i64 = db.query_row("SELECT memory_epoch FROM memory_automation_state WHERE id=1",[],|r| r.get(0))?;
            if job.memory_epoch != epoch { return Ok(()); }
            for f in facts {
                let r=&job.registration;
                let scope = if f.scope=="global" { MemoryScope::Global } else { MemoryScope::Persona };
                let persona = (scope==MemoryScope::Persona).then_some(r.persona_id.clone());
                let workspace = (f.scope=="workspace").then_some(r.workspace.as_deref()).flatten();
                let semantic = format!("auto.{}",hash(&format!("{}|{}|{}|{}",f.scope,persona.as_deref().unwrap_or(""),workspace.unwrap_or(""),f.key)));
                let consumed: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM memory_consumed WHERE job_id=?1 AND fact_key=?2)",params![job.id,semantic],|r| r.get(0))?;
                if consumed { continue; }
                let suppressed: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM memory_suppressed WHERE fact_key=?1 AND before_time>=?2)",params![semantic,r.received_at],|r| r.get(0))?;
                if suppressed { continue; }
                let mut previous: Option<(String,i64)> = db.query_row("SELECT m.id,COALESCE(a.source_time,0) FROM memories m LEFT JOIN memory_applicability a ON a.memory_id=m.id WHERE m.memory_key=?1 AND m.status='active'",[&semantic],|row| Ok((row.get(0)?,row.get(1)?))).optional()?;
                if let Some(target)=&f.target_id {
                    // A target must be visible within this exact scope, never an arbitrary model ID.
                    let target = db.query_row("SELECT m.id,COALESCE(a.source_time,0) FROM memories m LEFT JOIN memory_applicability a ON a.memory_id=m.id WHERE m.id=?1 AND m.status='active' AND m.scope=?2 AND COALESCE(m.persona_id,'')=?3 AND COALESCE(a.workspace,'')=?4",params![target,scope.as_str(),persona.as_deref().unwrap_or(""),workspace.unwrap_or("")],|row| Ok((row.get(0)?,row.get(1)?))).optional()?;
                    if target.is_none() { continue; }
                    previous=target;
                }
                if previous.as_ref().is_some_and(|(_,time)| *time>r.received_at) { continue; }
                let request = NewMemory { scope, persona_id:persona, memory_type:f.kind, memory_key:Some(semantic.clone()),content:f.content.clone(),importance:Some(if f.key.starts_with("communication."){5}else{3}),expires_at:None,source_kind:SourceKind::Extracted,conversation_id:Some(r.catalog_key.clone()),message_id:Some(r.message_id.clone()),sensitive_confirmed:false };
                let accepted=policy::accept_new(&request,&self.clock.now_plus_hours(policy::MOOD_TTL_HOURS))?;
                if let Some((id,_))=&previous { db.execute("UPDATE memories SET status='superseded' WHERE id=?1",[id])?; }
                let memory=insert_memory(db,&accepted,SourceKind::Extracted,previous.as_ref().map(|(id,_)|id.as_str()),&now_text)?;
                insert_source(db,&memory.id,Some(&r.catalog_key),Some(&r.message_id),SourceKind::Extracted,&now_text)?;
                let aliases = if f.key.starts_with("communication.") { format!("@communication {}",f.aliases) } else { f.aliases.clone() };
                db.execute("INSERT INTO memory_applicability VALUES (?1,?2,?3,?4,?5,?6)",params![memory.id,workspace,f.topic,f.state,aliases,r.received_at])?;
                db.execute("INSERT INTO memory_consumed VALUES (?1,?2,?3)",params![job.id,semantic,memory.id])?;
            }
            db.execute("UPDATE memory_jobs SET memory_done=1 WHERE id=?1",[&job.id])?;
            Ok(())
        })
    }
}
