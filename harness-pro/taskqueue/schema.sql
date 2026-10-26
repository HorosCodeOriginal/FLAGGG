-- language: sql, file: schema.sql, target: sqlite3 (better-sqlite3)
-- Runtime-Store der Task-Queue. desk.json bleibt statisch (Rollen/Keys/Workspaces),
-- alle Tasks und Statuswechsel laufen ausschliesslich hier.

-- 1. Die Tasks (Das Herzstueck der Queue)
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,                 -- UUID v4
    type TEXT NOT NULL,                  -- 'request', 'response', 'report'
    title TEXT NOT NULL,
    description TEXT,
    schema_name TEXT NOT NULL,           -- z.B. 'optimize_sql_v1'
    payload TEXT NOT NULL,               -- JSON-String (validiert gegen schema_name)
    source_role TEXT NOT NULL,           -- roleId des Absenders (z.B. 'boss_01')
    target_role TEXT NOT NULL,           -- roleId des Empfaengers (z.B. 'backend_dev')
    request_id TEXT UNIQUE NOT NULL,     -- Idempotenz-Schluessel (verhindert Doppel-Effekte)
    priority INTEGER DEFAULT 0,          -- 0-9 (hoeher = wichtiger)
    deadline DATETIME,                   -- ISO 8601
    acceptance_criteria TEXT,            -- JSON-String (pruefbare Bedingungen)

    -- Lifecycle (FSM)
    state TEXT NOT NULL DEFAULT 'queued',-- 'queued', 'claimed', 'running', 'waiting_on_child', 'done', 'failed', 'cancelled', 'escalated'
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 2,
    error_history TEXT DEFAULT '[]',     -- JSON-Array (max. 10 Eintraege)
    timeout_ms INTEGER DEFAULT 120000,

    claimed_by TEXT,                     -- roleId des Agenten, der den Task geclaimt hat
    parent_id TEXT,                      -- Eltern-Task (fuer waiting_on_child)

    result TEXT,                         -- JSON-String (nur bei 'done')
    synthesized INTEGER DEFAULT 0,       -- 1 = vom Synthesizer zusammengefasst
    retry_after DATETIME DEFAULT NULL,   -- 429-Backoff: erst danach wieder claimbar
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indizes fuer schnelles Polling und Status-Abfragen
CREATE INDEX IF NOT EXISTS idx_tasks_state_target ON tasks(state, target_role);
CREATE INDEX IF NOT EXISTS idx_tasks_request_id ON tasks(request_id);
-- idx_tasks_parent wird in TaskQueue.ensureColumns() angelegt (Spalte kann bei
-- bestehenden Datenbanken fehlen und wird dort nachgezogen).

-- 2. Event-Log (Audit-Trail fuer die FSM)
CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT NOT NULL,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
