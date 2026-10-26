'use strict';
// client.js — spricht mit dem Queue-Worker (eigener Prozess, JSON-Zeilen).
// Der Worker laeuft bevorzugt als Electron-as-Node (process.execPath +
// ELECTRON_RUN_AS_NODE=1), damit kein System-Node noetig ist. Faellt das aus,
// rotiert der Supervisor auf den naechsten Kandidaten ('node' aus dem PATH).

const path = require('path');
const { spawn } = require('child_process');

const WORKER = path.join(__dirname, 'worker.js');
const DEFAULT_BACKOFF = [500, 1000, 2000, 4000];

// Kandidaten in Prioritaetsreihenfolge
function nodeCandidates(env) {
  const e = env || process.env;
  if (e.ASTRA_NODE_BIN) {
    return [{ label: 'env', cmd: e.ASTRA_NODE_BIN, env: { ELECTRON_RUN_AS_NODE: '1' } }];
  }
  const list = [
    { label: 'electron', cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
    { label: 'node', cmd: 'node', env: {} },
  ];
  const seen = new Set();
  return list.filter(c => {
    const key = c.cmd + '|' + JSON.stringify(c.env);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class QueueClient {
  constructor(dbFile, options) {
    const opts = options || {};
    this.dbFile = dbFile;
    this.timeoutMs = Number(opts.timeoutMs) || 15000;
    this.maxRestarts = opts.maxRestarts === undefined ? 5 : Number(opts.maxRestarts);
    this.backoffMs = Array.isArray(opts.backoffMs) && opts.backoffMs.length ? opts.backoffMs : DEFAULT_BACKOFF;
    this.candidates = Array.isArray(opts.candidates) && opts.candidates.length ? opts.candidates : nodeCandidates(opts.env);
    this.spawnFn = opts.spawnFn || spawn;
    this.logger = opts.logger || console;

    this.candidateIndex = 0;
    this.state = 'idle';
    this.restarts = 0;
    this.lastError = null;
    this.stopping = false;
    this.proc = null;
    this.buffer = '';
    this.pending = new Map();
    this.seq = 0;
    this.timer = null;
    this.statusHandlers = [];
  }

  get candidate() {
    return this.candidates[this.candidateIndex] || null;
  }

  onStatus(handler) {
    if (typeof handler !== 'function') return () => {};
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter(h => h !== handler);
    };
  }

  emitStatus(state, extra) {
    const payload = Object.assign({
      state,
      restarts: this.restarts,
      candidate: this.candidate ? this.candidate.label : null,
      at: new Date().toISOString(),
    }, extra || {});
    this.state = state;
    this.statusHandlers.forEach(handler => {
      try { handler(payload); } catch (e) { /* Handler duerfen den Client nicht killen */ }
    });
    return payload;
  }

  start() {
    if (this.proc) return this;
    if (this.state === 'down') return this;
    this.stopping = false;
    this.spawnCandidate();
    return this;
  }

  spawnCandidate() {
    const cand = this.candidate;
    if (!cand) {
      this.emitStatus('down', { error: 'kein kandidat konfiguriert' });
      return;
    }
    this.emitStatus('starting');
    let child;
    try {
      child = this.spawnFn(cand.cmd, [WORKER, this.dbFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: Object.assign({}, process.env, cand.env),
      });
    } catch (err) {
      this.lastError = err.message;
      this.handleExit(null, err);
      return;
    }
    this.proc = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.onData(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      this.lastError = String(chunk).trim().split('\n').slice(-1)[0];
      this.logger.error('[tasks-worker] ' + this.lastError);
    });
    child.on('exit', code => this.handleExit(code));
    child.on('error', err => {
      this.lastError = err.message;
    });
  }

  handleExit(code, error) {
    const err = error || new Error('queue-worker beendet (code ' + code + ')' + (this.lastError ? ': ' + this.lastError : ''));
    this.pending.forEach(p => p.reject(err));
    this.pending.clear();
    this.proc = null;
    this.buffer = '';

    if (this.stopping) {
      this.emitStatus('stopped');
      return;
    }

    this.restarts += 1;
    if (this.restarts > this.maxRestarts) {
      this.emitStatus('down', { error: err.message });
      return;
    }

    // nach zwei Fehlversuchen derselben Binary auf den naechsten Kandidaten wechseln
    if (this.restarts % 2 === 0 && this.candidates.length > 1) {
      this.candidateIndex = (this.candidateIndex + 1) % this.candidates.length;
    }

    const delay = this.backoffMs[Math.min(this.restarts - 1, this.backoffMs.length - 1)];
    this.emitStatus('restarting', { error: err.message, delayMs: delay });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.spawnCandidate();
    }, delay);
    if (this.timer.unref) this.timer.unref();
  }

  // wartet bis der Worker antwortet (mehrere Kandidaten/Neustarts erlaubt)
  async ready(timeoutMs) {
    const limit = Number(timeoutMs) || 10000;
    const started = Date.now();
    let lastErr = null;
    while (Date.now() - started < limit) {
      try {
        await this.call('ping');
        this.restarts = 0;
        this.emitStatus('up');
        return true;
      } catch (err) {
        lastErr = err;
        if (this.state === 'down') break;
        await new Promise(r => setTimeout(r, 150));
      }
    }
    throw lastErr || new Error('queue nicht bereit');
  }

  onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const pending = this.pending.get(msg.id);
      if (!pending) continue;
      this.pending.delete(msg.id);
      if (msg.ok) pending.resolve(msg.result);
      else {
        const err = new Error((msg.error && msg.error.message) || 'queue-fehler');
        err.code = (msg.error && msg.error.code) || 'TASK_ERROR';
        pending.reject(err);
      }
    }
  }

  call(method, params) {
    if (this.state === 'down') {
      return Promise.reject(new Error('queue ist down (worker nicht startbar)'));
    }
    this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('queue-timeout: ' + method));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: err => { clearTimeout(timer); reject(err); },
      });
      try {
        this.proc.stdin.write(JSON.stringify({ id, method, params: params || {} }) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  // Rueckgaben werden auf die TaskQueue-API normalisiert (task statt {task})
  enqueue(task) { return this.call('enqueue', { task }); }
  claimNextTask(roleId) {
    return this.call('claim', { roleId }).then(r => (r && r.task !== undefined ? r.task : r));
  }
  updateState(taskId, state, options) {
    return this.call('updateState', Object.assign({ taskId, state }, options || {}))
      .then(r => (r && r.task !== undefined ? r.task : r));
  }
  getTask(taskId) { return this.call('get', { taskId }).then(r => (r && r.task !== undefined ? r.task : null)); }
  listTasks(filter) { return this.call('list', { filter: filter || {} }).then(r => (r && r.tasks) || []); }
  setPolicy(roles) { return this.call('setPolicy', { roles: roles || [] }); }
  synthesize(parentRoleId, requestId) { return this.call('synthesize', { parentRoleId, requestId }).then(r => (r && r.report) || null); }
  listChildren(parentId) { return this.call('children', { parentId }).then(r => (r && r.children) || []); }
  checkChildrenStatus(parentId) { return this.call('checkChildren', { parentId }).then(r => (r && r.parent) || null); }
  events(taskId) { return this.call('events', { taskId }).then(r => (r && r.events) || []); }
  eventsSince(afterId, limit) { return this.call('eventsSince', { afterId, limit }).then(r => (r && r.events) || []); }
  countByState() { return this.call('stats', {}).then(r => (r && r.counts) || []); }

  close() {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.proc) {
      this.emitStatus('stopped');
      return;
    }
    try { this.proc.stdin.write(JSON.stringify({ id: ++this.seq, method: 'close' }) + '\n'); } catch (e) { /* egal */ }
    const proc = this.proc;
    setTimeout(() => { try { proc.kill(); } catch (e) { /* egal */ } }, 500);
  }
}

module.exports = { QueueClient, nodeCandidates, WORKER };
