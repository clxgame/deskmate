CREATE TABLE work_entry_sources (
 source_key TEXT PRIMARY KEY, entry_id TEXT REFERENCES work_entries(id) ON DELETE SET NULL,
 catalog_key TEXT NOT NULL, message_id TEXT NOT NULL, workspace TEXT,
 fact_key TEXT NOT NULL, source_time INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'auto',
 deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX work_entry_fact ON work_entry_sources(workspace,fact_key);
CREATE TRIGGER work_entry_auto_delete BEFORE DELETE ON work_entries BEGIN
 UPDATE work_entry_sources SET deleted=1, source_time=CAST(unixepoch('now','subsec')*1000 AS INTEGER) WHERE entry_id=OLD.id;
END;
