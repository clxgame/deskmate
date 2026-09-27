-- Automatic processing stores derived facts, never another chat transcript.
CREATE TABLE memory_automation_state (
 id INTEGER PRIMARY KEY CHECK(id=1), memory_epoch INTEGER NOT NULL DEFAULT 0,
 log_epoch INTEGER NOT NULL DEFAULT 0
);
INSERT INTO memory_automation_state(id) VALUES (1);
CREATE TABLE memory_applicability (
 memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
 workspace TEXT, topic TEXT, state TEXT NOT NULL DEFAULT 'active',
 aliases TEXT NOT NULL DEFAULT '', source_time INTEGER NOT NULL,
 CHECK(state IN ('active','paused','completed'))
);
CREATE INDEX memory_applicability_workspace ON memory_applicability(workspace,topic);
CREATE TABLE memory_jobs (
 id TEXT PRIMARY KEY, registration TEXT NOT NULL,
 memory_epoch INTEGER NOT NULL, log_epoch INTEGER NOT NULL,
 memory_done INTEGER NOT NULL DEFAULT 0, log_done INTEGER NOT NULL DEFAULT 0,
 payload TEXT, state TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, due_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL, child_session TEXT,
 error_code TEXT
);
CREATE INDEX memory_jobs_due ON memory_jobs(state,due_at);
CREATE TABLE memory_consumed (
 job_id TEXT NOT NULL, fact_key TEXT NOT NULL, memory_id TEXT,
 PRIMARY KEY(job_id,fact_key)
);
CREATE TABLE memory_suppressed (
 fact_key TEXT PRIMARY KEY, before_time INTEGER NOT NULL
);
-- This is also invoked by deletion through the existing Memory Center.
CREATE TRIGGER memory_auto_forget BEFORE DELETE ON memories BEGIN
 INSERT INTO memory_suppressed(fact_key,before_time)
 SELECT OLD.memory_key,CAST(unixepoch('now','subsec')*1000 AS INTEGER)
 WHERE OLD.memory_key IS NOT NULL
 ON CONFLICT(fact_key) DO UPDATE SET before_time=excluded.before_time;
 UPDATE memory_automation_state SET memory_epoch=memory_epoch+1 WHERE id=1;
 UPDATE memory_jobs SET payload=NULL WHERE state IN ('pending','ready');
 DELETE FROM relationship_states;
END;

CREATE TABLE memory_work_links (
 memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
 entry_id TEXT NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(memory_id,entry_id)
);
