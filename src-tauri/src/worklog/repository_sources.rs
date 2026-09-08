use super::{contract::*, error::WorklogResult};
use rusqlite::{params, Connection};

pub(crate) fn stale_date(db: &Connection, date: &str) -> WorklogResult<()> {
    db.execute(
        "UPDATE reports SET stale=1 WHERE period_start<=?1 AND period_end>=?1",
        [date],
    )?;
    Ok(())
}
pub(crate) fn stale_source(db: &Connection, kind: &str, id: &str) -> WorklogResult<()> {
    db.execute("WITH RECURSIVE affected(id) AS (SELECT v.report_id FROM report_sources s JOIN report_versions v ON v.id=s.version_id WHERE s.source_kind=?1 AND s.source_id=?2 UNION SELECT v.report_id FROM report_sources s JOIN report_versions v ON v.id=s.version_id JOIN report_versions source ON source.id=s.source_id JOIN affected a ON a.id=source.report_id WHERE s.source_kind='daily_version') UPDATE reports SET stale=1 WHERE id IN (SELECT id FROM affected)",params![kind,id])?;
    Ok(())
}
pub(crate) fn erase_source(
    db: &Connection,
    kind: &str,
    request: &DeleteRecord,
) -> WorklogResult<()> {
    stale_source(db, kind, &request.id)?;
    let mut stmt=db.prepare("SELECT DISTINCT v.report_id FROM report_sources s JOIN report_versions v ON v.id=s.version_id WHERE s.source_kind=?1 AND s.source_id=?2")?;
    let linked = stmt
        .query_map(params![kind, request.id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for report in linked {
        if kind == "entry" {
            let mut versions = db.prepare("SELECT id FROM report_versions WHERE report_id=?1")?;
            let ids = versions
                .query_map([&report], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for id in ids {
                erase_source(
                    db,
                    "daily_version",
                    &DeleteRecord {
                        request_id: String::new(),
                        id,
                        expected_revision: 0,
                        delete_linked_reports: request.delete_linked_reports,
                    },
                )?;
            }
        }
        if request.delete_linked_reports {
            erase_report(db, &report)?;
        } else {
            db.execute("UPDATE reports SET source_deleted=1 WHERE id=?1", [&report])?;
        }
    }
    // Snapshots exist independently of report_sources, including unfinished runs.
    let mut versions =
        db.prepare("SELECT id,source_revision_manifest,source_snapshot FROM report_versions")?;
    let rows = versions
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, manifest, snapshot) in rows {
        let mut refs: Vec<SourceRef> = serde_json::from_str(&manifest)?;
        let mut snaps: Vec<SourceSnapshot> = serde_json::from_str(&snapshot)?;
        refs.retain(|s| s.kind != kind || s.id != request.id);
        snaps.retain(|s| s.source.kind != kind || s.source.id != request.id);
        db.execute(
            "UPDATE report_versions SET source_revision_manifest=?1,source_snapshot=?2 WHERE id=?3",
            params![
                serde_json::to_string(&refs)?,
                serde_json::to_string(&snaps)?,
                id
            ],
        )?;
    }
    let mut runs = db.prepare("SELECT id,source_manifest,source_snapshot FROM report_runs")?;
    let rows = runs
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, manifest, snapshot) in rows {
        let mut refs: Vec<SourceRef> = serde_json::from_str(&manifest)?;
        let mut snaps: Vec<SourceSnapshot> = serde_json::from_str(&snapshot)?;
        let affected = refs.iter().any(|s| s.kind == kind && s.id == request.id);
        refs.retain(|s| s.kind != kind || s.id != request.id);
        snaps.retain(|s| s.source.kind != kind || s.source.id != request.id);
        if affected {
            db.execute("UPDATE report_runs SET source_manifest=?1,source_snapshot=?2,state=CASE WHEN state IN ('queued','running','retry_wait') THEN 'cancelled' ELSE state END WHERE id=?3",params![serde_json::to_string(&refs)?,serde_json::to_string(&snaps)?,id])?;
        }
    }
    db.execute(
        "DELETE FROM report_sources WHERE source_kind=?1 AND source_id=?2",
        params![kind, request.id],
    )?;
    Ok(())
}
pub(crate) fn erase_report(db: &Connection, id: &str) -> WorklogResult<()> {
    let mut stmt = db.prepare("SELECT id FROM report_versions WHERE report_id=?1")?;
    let versions = stmt
        .query_map([id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for version in versions {
        erase_source(
            db,
            "daily_version",
            &DeleteRecord {
                request_id: String::new(),
                id: version,
                expected_revision: 0,
                delete_linked_reports: false,
            },
        )?;
    }
    db.execute("DELETE FROM reports WHERE id=?1", [id])?;
    db.execute("UPDATE worklog_operations SET status='deleted' WHERE entity_kind='report' AND entity_id=?1",[id])?;
    Ok(())
}

pub(crate) fn version_stale(db: &Connection, version: &ReportVersion) -> WorklogResult<bool> {
    use rusqlite::OptionalExtension;
    for source in &version.source_revision_manifest {
        let current: Option<i64> = match source.kind.as_str() {
            "entry" => db.query_row("SELECT revision FROM work_entries WHERE id=?1",[&source.id],|r|r.get(0)).optional()?,
            "daily_version" => db.query_row("SELECT v.version FROM report_versions v JOIN reports r ON r.current_version_id=v.id WHERE v.id=?1 AND r.stale=0",[&source.id],|r|r.get(0)).optional()?,
            _ => return Err(super::error::WorklogError::validation("Unknown report source kind")),
        };
        if current != Some(source.revision) {
            return Ok(true);
        }
    }
    Ok(db.query_row("SELECT EXISTS(SELECT 1 FROM work_entries e JOIN reports r ON r.id=?1 WHERE e.business_date BETWEEN r.period_start AND r.period_end AND e.updated_at>?2) OR EXISTS(SELECT 1 FROM reports WHERE id=?1 AND source_deleted=1)",params![version.report_id,version.generated_at],|r|r.get(0))?)
}
