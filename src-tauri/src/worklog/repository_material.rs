use super::contract::{ReportKind, SourceRef, SourceSnapshot};
use super::error::WorklogResult;
use super::repository_runtime::ClaimedRun;
use rusqlite::{params, Transaction};
use std::collections::BTreeMap;

pub fn freeze(tx: &Transaction<'_>, run: &ClaimedRun) -> WorklogResult<Vec<SourceSnapshot>> {
    let mut sources = Vec::new();
    let mut covered = BTreeMap::new();
    match run.kind {
        ReportKind::Daily => {}
        ReportKind::Weekly | ReportKind::Custom => {
            let mut statement=tx.prepare("SELECT v.id,v.version,r.period_start,v.body_markdown,v.source_revision_manifest FROM reports r JOIN report_versions v ON v.id=r.current_version_id WHERE r.kind='daily' AND (r.stale=0 OR v.origin='manual') AND r.period_start>=?1 AND r.period_end<=?2 ORDER BY r.period_start,r.id")?;
            let rows = statement.query_map(params![run.period_start, run.period_end], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;
            for row in rows {
                let (id, revision, date, text, manifest) = row?;
                let manifest: Vec<SourceRef> = serde_json::from_str(&manifest)?;
                for item in manifest {
                    if item.kind == "entry" {
                        covered.insert(item.id, item.revision);
                    }
                }
                sources.push(SourceSnapshot {
                    source: SourceRef {
                        kind: "daily_version".into(),
                        id,
                        revision,
                    },
                    business_date: date,
                    project: None,
                    entry_status: None,
                    text,
                });
            }
        }
    }
    let mut statement=tx.prepare("SELECT id,revision,business_date,project,text,status FROM work_entries WHERE business_date>=?1 AND business_date<=?2 ORDER BY business_date,created_at,id")?;
    let rows = statement.query_map(params![run.period_start, run.period_end], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;
    for row in rows {
        let (id, revision, business_date, project, text, status) = row?;
        if covered.get(&id) == Some(&revision) {
            continue;
        }
        let text=match covered.get(&id) {
            Some(previous)=>format!("[entry revision {revision} supersedes revision {previous} covered by a daily report]\n[{status}] {text}"),
            None=>format!("[{status}] {text}"),
        };
        sources.push(SourceSnapshot {
            source: SourceRef {
                kind: "entry".into(),
                id,
                revision,
            },
            business_date,
            project,
            entry_status: Some(serde_json::from_value(serde_json::Value::String(
                status.clone(),
            ))?),
            text,
        });
    }
    sources.sort_by(|a, b| {
        (&a.business_date, &a.source.kind, &a.source.id).cmp(&(
            &b.business_date,
            &b.source.kind,
            &b.source.id,
        ))
    });
    Ok(sources)
}
