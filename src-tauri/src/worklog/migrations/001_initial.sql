CREATE TABLE work_entries (
 id TEXT PRIMARY KEY, business_date TEXT NOT NULL, project TEXT,
 original_text TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('done','in_progress','blocked','planned')),
 source_session_id TEXT, source_message_id TEXT, revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX work_entries_date_project ON work_entries(business_date,project);
CREATE TABLE reports (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 current_version_id TEXT, revision INTEGER NOT NULL DEFAULT 1, stale INTEGER NOT NULL DEFAULT 0,
 source_deleted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 UNIQUE(kind,period_start,period_end)
);
CREATE TABLE report_versions (
 id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, body_markdown TEXT NOT NULL, origin TEXT NOT NULL,
 source_revision_manifest TEXT NOT NULL, source_snapshot TEXT NOT NULL,
 coverage_dates TEXT NOT NULL, generated_at TEXT NOT NULL, model_id TEXT,
 UNIQUE(report_id,version)
);
CREATE TABLE report_sources (
 version_id TEXT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
 source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
 PRIMARY KEY(version_id,source_kind,source_id)
);
CREATE INDEX report_source_lookup ON report_sources(source_kind,source_id);
CREATE TABLE report_schedules (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, weekday_set TEXT NOT NULL, local_time TEXT NOT NULL,
 timezone_mode TEXT NOT NULL DEFAULT 'system_local', enabled INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_due_at TEXT
);
CREATE INDEX schedules_due ON report_schedules(enabled,next_due_at);
CREATE TABLE report_runs (
 id TEXT PRIMARY KEY, schedule_id TEXT REFERENCES report_schedules(id) ON DELETE SET NULL,
 kind TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, occurrence_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, lease_until TEXT, session_id TEXT,
 base_report_revision INTEGER, source_manifest TEXT NOT NULL DEFAULT '[]', source_snapshot TEXT NOT NULL DEFAULT '[]',
 model_id TEXT NOT NULL, result_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL, error_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, max_attempt INTEGER NOT NULL DEFAULT 3
);
CREATE INDEX runs_due ON report_runs(state,next_retry_at);
CREATE TABLE worklog_operations (
 request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL,
 revision INTEGER NOT NULL, business_date TEXT, status TEXT NOT NULL DEFAULT 'committed'
);
