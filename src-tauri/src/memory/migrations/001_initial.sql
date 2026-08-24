-- deskmate memory schema v1.
--
-- Design rules encoded here:
--   * `scope='global'` rows have NULL persona_id; `scope='persona'` rows must
--     name a persona. Cross-persona leakage is prevented at the schema level.
--   * `sensitivity='secret'` is not a storable value: credentials are rejected
--     before they reach SQLite.
--   * Forgetting is a hard DELETE. Only `memory_events` survives, and it holds
--     no content.
--   * `memory_search` is an FTS5 index over active content, kept in sync by
--     triggers inside the same transaction as the base-table write.

CREATE TABLE memories (
    id             TEXT PRIMARY KEY NOT NULL,
    scope          TEXT NOT NULL CHECK (scope IN ('global', 'persona')),
    persona_id     TEXT,
    type           TEXT NOT NULL CHECK (type IN (
                       'identity', 'preference', 'boundary', 'routine',
                       'goal', 'event', 'shared_moment', 'mood'
                   )),
    memory_key     TEXT,
    content        TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
    status         TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'expired')),
    confidence     REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    importance     INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
    sensitivity    TEXT NOT NULL CHECK (sensitivity IN ('normal', 'sensitive')),
    source_kind    TEXT NOT NULL CHECK (source_kind IN ('explicit', 'extracted', 'onboarding', 'follow_up')),
    valid_from     TEXT NOT NULL,
    expires_at     TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    revision       INTEGER NOT NULL CHECK (revision >= 1),
    supersedes_id  TEXT REFERENCES memories (id) ON DELETE SET NULL,
    CHECK ((scope = 'global' AND persona_id IS NULL)
        OR (scope = 'persona' AND persona_id IS NOT NULL AND length(persona_id) > 0))
);

CREATE INDEX idx_memories_scope_status
    ON memories (scope, persona_id, status);

-- One active row per (scope, persona, key): a changed stable fact supersedes
-- the old one instead of accumulating duplicates.
CREATE UNIQUE INDEX idx_memories_key
    ON memories (scope, IFNULL(persona_id, ''), memory_key)
    WHERE memory_key IS NOT NULL AND status = 'active';

-- Provenance only: never a copy of the raw chat text.
CREATE TABLE memory_sources (
    id              TEXT PRIMARY KEY NOT NULL,
    memory_id       TEXT NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
    conversation_id TEXT,
    message_id      TEXT,
    source_kind     TEXT NOT NULL CHECK (source_kind IN ('explicit', 'extracted', 'onboarding', 'follow_up')),
    created_at      TEXT NOT NULL
);

CREATE INDEX idx_memory_sources_conversation
    ON memory_sources (conversation_id);

CREATE UNIQUE INDEX idx_memory_sources_unique
    ON memory_sources (memory_id, IFNULL(conversation_id, ''), IFNULL(message_id, ''));

-- Normal, non-secret extraction proposals awaiting a user decision. Sensitive
-- proposals stay in process memory and never reach this table.
CREATE TABLE memory_candidates (
    id              TEXT PRIMARY KEY NOT NULL,
    scope           TEXT NOT NULL CHECK (scope IN ('global', 'persona')),
    persona_id      TEXT,
    type            TEXT NOT NULL,
    memory_key      TEXT,
    content         TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 500),
    confidence      REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    importance      INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
    decision        TEXT NOT NULL CHECK (decision IN ('pending', 'accepted', 'dismissed')),
    conversation_id TEXT,
    message_id      TEXT,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    accepted_memory_id TEXT REFERENCES memories (id) ON DELETE SET NULL,
    CHECK ((scope = 'global' AND persona_id IS NULL)
        OR (scope = 'persona' AND persona_id IS NOT NULL AND length(persona_id) > 0))
);

CREATE INDEX idx_memory_candidates_decision
    ON memory_candidates (decision, expires_at);

-- Links a memory to a task that lives in `Settings.scheduled_tasks`. This is a
-- relation, not a second task store: deleting a link never deletes a task.
CREATE TABLE memory_task_links (
    memory_id  TEXT NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
    task_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (memory_id, task_id)
);

CREATE TABLE relationship_states (
    persona_id  TEXT PRIMARY KEY NOT NULL,
    familiarity INTEGER NOT NULL DEFAULT 0 CHECK (familiarity >= 0),
    summary     TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 400),
    revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_at  TEXT NOT NULL
);

-- Audit metadata only. Deliberately has no content column so a hard delete
-- cannot leave the forgotten text behind.
CREATE TABLE memory_events (
    id         TEXT PRIMARY KEY NOT NULL,
    memory_id  TEXT NOT NULL,
    action     TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_memory_events_memory
    ON memory_events (memory_id);

-- Full-text index over active content and stable keys.
--
-- `trigram` rather than `unicode61`: unicode61 treats an unbroken run of CJK as
-- a single token, so "甜食" would never match "不喜欢甜食" in a Chinese-first
-- app. Trigram gives case-insensitive substring matching in every script, at
-- the cost of needing at least three characters per query (the repository falls
-- back to LIKE below that).
--
-- The index holds its own copy of the text instead of `content='memories'` so a
-- hard delete has something concrete to overwrite under `secure_delete`.
CREATE VIRTUAL TABLE memory_search USING fts5 (
    memory_id UNINDEXED,
    content,
    memory_key,
    tokenize = 'trigram'
);

CREATE TRIGGER trg_memories_search_insert
AFTER INSERT ON memories
WHEN NEW.status = 'active'
BEGIN
    INSERT INTO memory_search (memory_id, content, memory_key)
    VALUES (NEW.id, NEW.content, IFNULL(NEW.memory_key, ''));
END;

CREATE TRIGGER trg_memories_search_delete
AFTER DELETE ON memories
BEGIN
    DELETE FROM memory_search WHERE memory_id = OLD.id;
END;

CREATE TRIGGER trg_memories_search_update
AFTER UPDATE ON memories
BEGIN
    DELETE FROM memory_search WHERE memory_id = OLD.id;
    INSERT INTO memory_search (memory_id, content, memory_key)
    SELECT NEW.id, NEW.content, IFNULL(NEW.memory_key, '')
    WHERE NEW.status = 'active';
END;
