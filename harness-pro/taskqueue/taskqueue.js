'use strict';
// taskqueue.js — SQLite-Runtime-Store fuer Tasks (better-sqlite3).
// desk.json bleibt statisch; hier liegen ausschliesslich Tasks, Status und Events.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const { assertTransition, isState, isTerminal, FsmError } = require('./fsm');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
const MAX_ERROR_HISTORY = 10;
const MAX_ERROR_STDERR = 8000;
const DEFAULT_MAX_LOOPS = 10;
const QUOTA_MAX_RETRIES = 5;
const QUOTA_BASE_DELAY_MS = 60000;

class TaskAuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskAuthorizationError';
    this.code = 'UNAUTHORIZED';
  }
}

class TaskValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskValidationError';
    this.code = 'TASK_INVALID';
  }
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function toJson(value) {
  if (typeof value === 'string') {
    // Strings werden als JSON-Wert gespeichert, damit payload/result immer gueltiges JSON sind
    return JSON.stringify(value);
  }
  return JSON.stringify(value === undefined ? null : value);
}

class TaskQueue {
  constructor(dbFile, options) {
    const opts = options || {};
    this.validators = opts.validators || {};
    this.policy = opts.policy || null;
    this.dbFile = dbFile === ':memory:' ? ':memory:' : path.resolve(dbFile);
    if (this.dbFile !== ':memory:') {
      fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
    }
    this.db = new Database(this.dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(fs.readFileSync(SCHEMA_FILE, 'utf8'));
    this.ensureColumns();
    this.watchdogTimer = null;
  }

  // bestehende Datenbanken um neue Spalten erweitern (idempotent)
  ensureColumns() {
    const have = new Set(this.db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name));
    if (!have.has('claimed_by')) this.db.exec('ALTER TABLE tasks ADD COLUMN claimed_by TEXT');
    if (!have.has('parent_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN parent_id TEXT');
    if (!have.has('synthesized')) this.db.exec('ALTER TABLE tasks ADD COLUMN synthesized INTEGER DEFAULT 0');
    if (!have.has('retry_after')) this.db.exec('ALTER TABLE tasks ADD COLUMN retry_after DATETIME DEFAULT NULL');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)');
  }

  close() {
    this.stopWatchdog();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // -------------------------------------------------------------------------
  // enqueue: idempotent ueber request_id
  // -------------------------------------------------------------------------
  enqueue(task) {
    if (!task || typeof task !== 'object') throw new TaskValidationError('task fehlt');
    ['type', 'title', 'schema_name', 'source_role', 'target_role', 'request_id'].forEach(key => {
      if (!task[key] || typeof task[key] !== 'string') {
        throw new TaskValidationError('Feld "' + key + '" fehlt oder ist kein String');
      }
    });
    if (task.payload === undefined) throw new TaskValidationError('Feld "payload" fehlt');
    if (!isState(task.state || 'queued')) throw new TaskValidationError('unbekannter state');

    const existing = this.findByRequestId(task.request_id);
    if (existing) {
      return { task: this.hydrate(existing), duplicate: true };
    }

    const id = task.id || crypto.randomUUID();
    const denied = !!(this.policy && typeof this.policy.canSend === 'function' &&
      !this.policy.canSend(task.source_role, task.target_role));
    const now = new Date().toISOString();
    const row = {
      id,
      type: task.type,
      title: task.title,
      description: task.description || null,
      schema_name: task.schema_name,
      payload: toJson(task.payload),
      source_role: task.source_role,
      target_role: task.target_role,
      request_id: task.request_id,
      priority: Math.min(9, Math.max(0, Number(task.priority) || 0)),
      deadline: task.deadline || null,
      acceptance_criteria: task.acceptance_criteria === undefined ? null : toJson(task.acceptance_criteria),
      state: denied ? 'failed' : (task.state || 'queued'),
      attempts: 0,
      max_attempts: Number(task.max_attempts) || 2,
      error_history: denied ? JSON.stringify([{ at: now, error: 'UNAUTHORIZED: ' + task.source_role + ' darf nicht an ' + task.target_role + ' senden', code: 'UNAUTHORIZED' }]) : '[]',
      timeout_ms: Number(task.timeout_ms) || 120000,
      claimed_by: null,
      parent_id: task.parent_id || null,
      result: null,
      created_at: now,
      updated_at: now,
    };

    try {
      this.db.prepare(
        'INSERT INTO tasks (id, type, title, description, schema_name, payload, source_role, target_role,' +
        ' request_id, priority, deadline, acceptance_criteria, state, attempts, max_attempts, error_history,' +
        ' timeout_ms, claimed_by, parent_id, result, created_at, updated_at)' +
        ' VALUES (@id, @type, @title, @description, @schema_name, @payload, @source_role, @target_role,' +
        ' @request_id, @priority, @deadline, @acceptance_criteria, @state, @attempts, @max_attempts,' +
        ' @error_history, @timeout_ms, @claimed_by, @parent_id, @result, @created_at, @updated_at)'
      ).run(row);
    } catch (err) {
      // parallel eingefuegte request_id: bestehenden Task zurueckgeben
      if (String(err.code || '').indexOf('SQLITE_CONSTRAINT') === 0) {
        const again = this.findByRequestId(task.request_id);
        if (again) return { task: this.hydrate(again), duplicate: true };
      }
      throw err;
    }

    this.recordEvent(id, null, row.state, denied ? 'UNAUTHORIZED' : 'enqueued');
    return { task: this.getTask(id), duplicate: false };
  }

  // -------------------------------------------------------------------------
  // claimNextTask: atomar (BEGIN IMMEDIATE + UPDATE ... WHERE state='queued')
  // -------------------------------------------------------------------------
  claimNextTask(roleId) {
    if (!roleId) throw new TaskValidationError('roleId fehlt');

    const pick = this.db.prepare(
      "SELECT id FROM tasks WHERE state = 'queued' AND target_role = ?" +
      ' AND (retry_after IS NULL OR retry_after <= ?)' +
      ' ORDER BY priority DESC, created_at ASC LIMIT 1'
    );
    const take = this.db.prepare(
      "UPDATE tasks SET state = 'claimed', claimed_by = ?, attempts = attempts + 1, retry_after = NULL, updated_at = ?" +
      " WHERE id = ? AND state = 'queued'"
    );

    const claim = this.db.transaction(() => {
      for (let i = 0; i < 20; i += 1) {
        const candidate = pick.get(roleId, new Date().toISOString());
        if (!candidate) return null;
        if (this.policy && typeof this.policy.canReceive === 'function') {
          const src = this.db.prepare('SELECT source_role FROM tasks WHERE id = ?').get(candidate.id);
          if (src && !this.policy.canReceive(roleId, src.source_role)) {
            this.failUnauthorized(candidate.id, src.source_role, roleId);
            continue;
          }
        }
        const info = take.run(roleId, new Date().toISOString(), candidate.id);
        if (info.changes === 1) {
          this.recordEvent(candidate.id, 'queued', 'claimed', 'claimed by ' + roleId);
          return this.getTask(candidate.id);
        }
      }
      return null;
    });

    return claim.immediate();
  }

  // -------------------------------------------------------------------------
  // updateState: FSM-Pruefung + Event-Log
  // -------------------------------------------------------------------------
  updateState(taskId, newState, options) {
    const opts = options || {};
    const task = this.getTask(taskId);
    if (!task) throw new TaskValidationError('task nicht gefunden: ' + taskId);

    // Quota-Fehler: zurueck in die Queue statt failed
    if (newState === 'failed' && this.isQuotaError(opts)) {
      const retried = this.applyQuotaBackoff(task, opts);
      if (retried) return retried;
    }

    assertTransition(task.state, newState);

    // failed -> queued nur solange Versuche uebrig sind
    if (task.state === 'failed' && newState === 'queued' && task.attempts >= task.max_attempts) {
      throw new FsmError('failed', 'queued', 'max_attempts erreicht, stattdessen "escalated"');
    }

    let resultJson = null;
    if (newState === 'done') {
      if (opts.result === undefined) throw new TaskValidationError('done erfordert ein valides result');
      const validator = this.validators[task.schema_name];
      if (typeof validator === 'function') {
        const ok = validator(opts.result, task);
        if (ok === false) throw new TaskValidationError('result entspricht nicht schema "' + task.schema_name + '"');
      }
      resultJson = toJson(opts.result);
    }

    const errorHistory = Array.isArray(task.error_history) ? task.error_history.slice() : [];
    const now = new Date().toISOString();
    if (newState === 'failed') {
      const msg = opts.error || opts.message || 'unbekannter Fehler';
      const entry = { at: now, error: String(msg), code: opts.code || null };
      // Self-Healing: den stderr des fehlgeschlagenen Tool-Aufrufs mitschreiben,
      // damit der Boss (Eltern-Task) den Fehler analysieren und einen Fix-Task
      // delegieren kann.
      const stderr = opts.stderr === undefined || opts.stderr === null ? '' : String(opts.stderr);
      if (stderr) entry.stderr = stderr.slice(0, MAX_ERROR_STDERR);
      if (opts.tool) entry.tool = String(opts.tool);
      if (opts.exitCode !== undefined && opts.exitCode !== null) entry.exitCode = opts.exitCode;
      errorHistory.unshift(entry);
      while (errorHistory.length > MAX_ERROR_HISTORY) errorHistory.pop();
    }

    // claimed_by nur beim Zurueckstellen in die Queue loeschen; sonst bleibt der Agent vermerkt
    const expectedState = task.state;
    const clearClaim = (expectedState === 'failed' || expectedState === 'waiting_on_child') && newState === 'queued';
    const apply = this.db.transaction(() => {
      let info;
      if (clearClaim) {
        info = this.db.prepare(
          'UPDATE tasks SET state = ?, result = COALESCE(?, result), error_history = ?, claimed_by = NULL, updated_at = ? WHERE id = ? AND state = ?'
        ).run(newState, resultJson, JSON.stringify(errorHistory), now, taskId, expectedState);
      } else {
        info = this.db.prepare(
          'UPDATE tasks SET state = ?, result = COALESCE(?, result), error_history = ?, updated_at = ? WHERE id = ? AND state = ?'
        ).run(newState, resultJson, JSON.stringify(errorHistory), now, taskId, expectedState);
      }
      if (info.changes !== 1) {
        throw new TaskValidationError(
          'state-Konflikt: Task ' + taskId + ' nicht mehr in "' + expectedState + '" (CAS)'
        );
      }
      this.recordEvent(taskId, expectedState, newState, opts.message || null);
      return this.getTask(taskId);
    });

    return apply.immediate();
  }

  // 429/Quota: kein finaler Fehlschlag, sondern spaeter erneut versuchen.
  // attempts bleibt unveraendert, retry_after bekommt exponentielles Backoff.
  isQuotaError(opts) {
    const o = opts || {};
    const code = String(o.code || '');
    const text = String(o.error || o.message || '');
    if (code === '429' || code === 'QUOTA_EXCEEDED') return true;
    return /(^|\D)429(\D|$)|quota|FreeUsageLimit|rate.?limit/i.test(code + ' ' + text);
  }

  applyQuotaBackoff(task, opts) {
    const history = Array.isArray(task.error_history) ? task.error_history.slice() : [];
    const retries = history.filter(e => e && (String(e.code) === '429' || String(e.code) === 'QUOTA_EXCEEDED')).length;
    if (retries >= QUOTA_MAX_RETRIES) return null; // Budget aufgebraucht -> normaler Fehlschlag
    const delayMs = QUOTA_BASE_DELAY_MS * Math.pow(2, retries);
    const now = new Date();
    history.unshift({ at: now.toISOString(), error: String(opts.error || opts.message || 'HTTP 429'), code: '429' });
    while (history.length > MAX_ERROR_HISTORY) history.pop();
    const info = this.db.prepare(
      "UPDATE tasks SET state = 'queued', retry_after = ?, error_history = ?, claimed_by = NULL, updated_at = ? WHERE id = ? AND state = ?"
    ).run(
      new Date(now.getTime() + delayMs).toISOString(),
      JSON.stringify(history),
      now.toISOString(),
      task.id,
      task.state,
    );
    if (info.changes !== 1) {
      throw new TaskValidationError(
        'state-Konflikt: Quota-Backoff fuer ' + task.id + ' (nicht mehr in "' + task.state + '")'
      );
    }
    this.recordEvent(task.id, task.state, 'queued', 'QUOTA-Backoff ' + Math.round(delayMs / 1000) + 's (429)');
    return this.getTask(task.id);
  }
  // unerlaubte Quelle: Task endgueltig ablehnen (Code UNAUTHORIZED)
  failUnauthorized(taskId, sourceRole, roleId) {
    const now = new Date().toISOString();
    const history = JSON.stringify([{ at: now, error: 'UNAUTHORIZED: ' + sourceRole + ' darf nicht an ' + roleId + ' senden', code: 'UNAUTHORIZED' }]);
    this.db.prepare("UPDATE tasks SET state = 'failed', error_history = ?, updated_at = ? WHERE id = ?").run(history, now, taskId);
    this.recordEvent(taskId, 'queued', 'failed', 'UNAUTHORIZED');
  }

  // alle Kind-Tasks eines Parents (jeder Zustand)
  listChildren(parentId) {
    if (!parentId) return [];
    return this.db.prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at').all(parentId).map(row => this.hydrate(row));
  }

  // Kind-Tasks, die fertig sind (done/failed/escalated) und noch nicht
  // synthetisiert wurden. Der Aufruf kommt periodisch aus dem Orchestrator.
  listUnsynthizedChildren(parentId) {
    if (!parentId) return [];
    return this.db.prepare(
      "SELECT * FROM tasks WHERE parent_id = ? AND state IN ('done', 'failed', 'escalated') AND COALESCE(synthesized, 0) = 0 ORDER BY created_at"
    ).all(parentId).map(row => this.hydrate(row));
  }

  markSynthesized(ids) {
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) return 0;
    // CAS: nur markieren wenn noch nicht synthetisiert (verhindert Doppel-Reports)
    const stmt = this.db.prepare(
      'UPDATE tasks SET synthesized = 1, updated_at = ? WHERE id = ? AND COALESCE(synthesized, 0) = 0'
    );
    const now = new Date().toISOString();
    let changed = 0;
    this.db.transaction(() => {
      list.forEach(id => { changed += stmt.run(now, id).changes; });
    })();
    return changed;
  }

  // -------------------------------------------------------------------------
  // Eltern-Task: wieder auf running, sobald alle Kinder fertig sind
  // -------------------------------------------------------------------------
  checkChildrenStatus(parentId) {
    if (!parentId) return null;
    const parent = this.getTask(parentId);
    if (!parent) return null;
    const children = this.db.prepare('SELECT state FROM tasks WHERE parent_id = ?').all(parentId);
    if (!children.length) return null;

    const finished = state => state === 'done' || state === 'cancelled' || state === 'failed' || state === 'escalated';
    const allFinished = children.every(c => finished(c.state));
    if (!allFinished) return parent;
    if (parent.state !== 'waiting_on_child') return parent;

    const failedChildren = children.filter(c => c.state === 'failed' || c.state === 'escalated');
    // Self-Healing-Loop-Schutz: max_loops kommt aus dem Master-Payload
    // (Default 10). Zu viele fehlgeschlagene Kinder -> Parent endgueltig failed.
    const maxLoops = Number(parent.payload && parent.payload.max_loops) > 0
      ? Number(parent.payload.max_loops)
      : DEFAULT_MAX_LOOPS;
    if (failedChildren.length >= maxLoops) {
      return this.updateState(parentId, 'failed', {
        error: 'LOOP_LIMIT: ' + failedChildren.length + ' fehlgeschlagene Kinder (max_loops=' + maxLoops + ')',
        code: 'LOOP_LIMIT',
      });
    }

    // Kind(er) fehlgeschlagen -> Parent wieder claimbar machen. Die Runtime
    // laedt beim Re-Claim die Kind-Ergebnisse inkl. error_history/stderr und
    // erzwingt ueber den Self-Healing-Prompt einen Fix-Task.
    const message = failedChildren.length
      ? 'self-heal: ' + failedChildren.length + '/' + children.length + ' kinder fehlgeschlagen'
      : 'alle kinder fertig (' + children.length + ')';
    return this.updateState(parentId, 'queued', { message });
  }

  // -------------------------------------------------------------------------
  // Timeout-Watchdog: haengende running/waiting_on_child-Tasks auf failed
  // -------------------------------------------------------------------------
  sweepTimeouts(nowMs) {
    const now = nowMs || Date.now();
    const stuck = this.db.prepare(
      "SELECT id, state, timeout_ms, updated_at FROM tasks WHERE state IN ('running', 'waiting_on_child')"
    ).all();

    const expired = stuck.filter(row => {
      const updated = Date.parse(row.updated_at || '') || 0;
      const limit = Number(row.timeout_ms) || 120000;
      return now - updated > limit;
    });
    if (!expired.length) return [];

    const out = [];
    const sweep = this.db.transaction(() => {
      expired.forEach(row => {
        try {
          out.push(this.updateState(row.id, 'failed', {
            error: 'TIMEOUT: laenger als ' + row.timeout_ms + 'ms in ' + row.state,
            code: 'TIMEOUT',
          }));
        } catch (err) {
          this.recordEvent(row.id, row.state, row.state, 'timeout-fehler: ' + err.message);
        }
      });
    });
    sweep.immediate();
    return out;
  }

  startWatchdog(intervalMs) {
    this.stopWatchdog();
    const every = Math.max(1000, Number(intervalMs) || 10000);
    this.watchdogTimer = setInterval(() => {
      try {
        this.sweepTimeouts();
      } catch (err) {
        // Watchdog darf den Prozess nie beenden
        this.recordEvent('-', null, 'failed', 'watchdog-fehler: ' + err.message);
      }
    }, every);
    if (this.watchdogTimer.unref) this.watchdogTimer.unref();
    return this.watchdogTimer;
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Lesen
  // -------------------------------------------------------------------------
  getTask(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? this.hydrate(row) : null;
  }

  findByRequestId(requestId) {
    return this.db.prepare('SELECT * FROM tasks WHERE request_id = ?').get(requestId) || null;
  }

  listTasks(filter) {
    const f = filter || {};
    const where = [];
    const params = [];
    if (f.type) { where.push('type = ?'); params.push(f.type); }
    if (f.state) { where.push('state = ?'); params.push(f.state); }
    if (f.targetRole) { where.push('target_role = ?'); params.push(f.targetRole); }
    if (f.sourceRole) { where.push('source_role = ?'); params.push(f.sourceRole); }
    const sql = 'SELECT * FROM tasks' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY priority DESC, created_at ASC LIMIT ?';
    params.push(Math.min(500, Number(f.limit) || 100));
    return this.db.prepare(sql).all.apply(this.db.prepare(sql), params).map(r => this.hydrate(r));
  }

  events(taskId) {
    return this.db.prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC').all(taskId);
  }

  // Events seit einer id (fuer den Live-Stream in die UI)
  eventsSince(afterId, limit) {
    const rows = this.db.prepare(
      'SELECT e.id, e.task_id, e.from_state, e.to_state, e.message, e.timestamp,' +
      ' t.target_role, t.source_role, t.state AS task_state, t.title AS task_title' +
      ' FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id' +
      ' WHERE e.id > ? ORDER BY e.id ASC LIMIT ?'
    ).all(Number(afterId) || 0, Math.min(200, Number(limit) || 100));
    return rows.map(row => ({
      id: row.id,
      taskId: row.task_id,
      fromState: row.from_state,
      toState: row.to_state,
      message: row.message,
      timestamp: row.timestamp,
      roleId: row.target_role || null,
      sourceRole: row.source_role || null,
      taskState: row.task_state || null,
      taskTitle: row.task_title || null,
    }));
  }

  countByState() {
    return this.db.prepare('SELECT state, COUNT(*) AS n FROM tasks GROUP BY state').all();
  }

  // -------------------------------------------------------------------------
  // intern
  // -------------------------------------------------------------------------
  recordEvent(taskId, fromState, toState, message) {
    this.db.prepare(
      'INSERT INTO task_events (task_id, from_state, to_state, message, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(taskId, fromState, toState, message, new Date().toISOString());
  }

  hydrate(row) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      schema_name: row.schema_name,
      payload: parseJson(row.payload, null),
      source_role: row.source_role,
      target_role: row.target_role,
      request_id: row.request_id,
      priority: row.priority,
      deadline: row.deadline,
      acceptance_criteria: parseJson(row.acceptance_criteria, null),
      state: row.state,
      attempts: row.attempts,
      max_attempts: row.max_attempts,
      error_history: parseJson(row.error_history, []),
      timeout_ms: row.timeout_ms,
      claimed_by: row.claimed_by || null,
      parent_id: row.parent_id || null,
      result: parseJson(row.result, null),
      synthesized: Number(row.synthesized) || 0,
      retry_after: row.retry_after || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      terminal: isTerminal(row.state),
    };
  }
}

module.exports = { TaskQueue, TaskValidationError, TaskAuthorizationError, MAX_ERROR_HISTORY };
