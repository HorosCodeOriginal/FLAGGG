'use strict';
// runtime.js — AgentRuntime: eine Rolle pollt die Queue, fuehrt Tasks aus und
// schreibt das Ergebnis (done/failed) inkl. Eltern-Benachrichtigung zurueck.
// Mit workspace bekommt die Rolle Haende (ToolRunner) und kann Tools aufrufen.

const { ToolRunner } = require('../lib/tool-runner');

// Antwort eines Agenten kann ein Tool-Aufruf sein: {"tool":"read_file","args":{...}}
function stripFences(text) {
  const value = String(text || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value);
  return fenced ? fenced[1].trim() : value;
}

function parseToolCall(reply) {
  const candidates = [];
  if (typeof reply === 'string') candidates.push(reply);
  // Transport liefert teils das bereits entpackte Objekt { tool, args }
  if (reply && typeof reply === 'object' && typeof reply.tool === 'string') {
    return { tool: reply.tool, args: reply.args || {} };
  }
  if (reply && typeof reply.content === 'string') candidates.push(reply.content);
  if (reply && reply.result && typeof reply.result === 'object') {
    if (typeof reply.result.text === 'string') candidates.push(reply.result.text);
    if (typeof reply.result.tool === 'string') {
      return { tool: reply.result.tool, args: reply.result.args || {} };
    }
  }
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(stripFences(raw));
      if (parsed && typeof parsed.tool === 'string') {
        return { tool: parsed.tool, args: parsed.args || {} };
      }
    } catch (e) { /* kein Tool-Aufruf */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-Healing: Kind-Fehler (stderr) extrahieren und als Kontext aufbereiten.
// Der Boss bekommt bei jedem Re-Claim die Kind-Ergebnisse inkl. error_history
// und wird per Prompt dazu gezwungen, einen Fix-Task zu delegieren.
// ---------------------------------------------------------------------------
const SELF_HEAL_INSTRUCTION = 'Ein vorheriger Task ist fehlgeschlagen. Hier ist der stderr: ';
const SELF_HEAL_ACTION = ' Delegiere einen Fix-Task an den Agenten, um das Problem zu beheben.';
// Diagnose: ASTRA_DEBUG_RUNTIME=1 loggt jeden Tool-Aufruf (Start/Ende/Dauer).
const TOOL_DEBUG = process.env.ASTRA_DEBUG_RUNTIME === '1';

function childStderr(child) {
  const c = child || {};
  const history = Array.isArray(c.error_history) ? c.error_history : [];
  for (const entry of history) {
    if (entry && entry.stderr) return String(entry.stderr);
  }
  for (const entry of history) {
    if (entry && entry.error) return String(entry.error);
  }
  if (c.result && typeof c.result === 'object') {
    if (c.result.stderr) return String(c.result.stderr);
    if (c.result.error) return String(c.result.error);
  }
  return '';
}

function failedChildResults(childResults) {
  return (Array.isArray(childResults) ? childResults : [])
    .filter(c => c && (c.state === 'failed' || c.state === 'escalated'));
}

function selfHealContext(childResults) {
  const all = (Array.isArray(childResults) ? childResults : []).filter(Boolean);
  if (!all.length) return null;
  // Nur UNGELOESTE Fehler: ist das neueste Kind done, wurde der Fehler durch
  // einen Fix-Task behoben -> keine weitere Fix-Delegation erzwingen.
  const last = all[all.length - 1];
  if (!last || (last.state !== 'failed' && last.state !== 'escalated')) return null;
  const failed = all.filter(c => c && (c.state === 'failed' || c.state === 'escalated'));
  const stderr = childStderr(last) || 'unbekannter Fehler (kein stderr)';
  return {
    required: true,
    failed_children: failed.map(c => ({
      id: c.id,
      title: c.title,
      state: c.state,
      attempts: c.attempts,
      error_history: c.error_history,
    })),
    stderr,
    instruction: SELF_HEAL_INSTRUCTION + stderr + '.' + SELF_HEAL_ACTION,
  };
}

// Finale Agenten-Antwort kann einen Fehlschlag explizit melden:
// {"ok":false,"error":"..."} -> Task wird failed (statt faelschlich done).
function explicitFailure(reply) {
  if (!reply || typeof reply !== 'object') return null;
  const payload = reply.result && typeof reply.result === 'object' ? reply.result : reply;
  if (!payload || typeof payload !== 'object') return null;
  if (payload.ok === false || payload.failed === true || payload.success === false) {
    return { message: String(payload.error || payload.message || 'Agent meldet Fehlschlag') };
  }
  return null;
}

class AgentRuntime {
  constructor(options) {
    const o = options || {};
    if (!o.queue) throw new Error('AgentRuntime: queue fehlt');
    if (!o.roleId) throw new Error('AgentRuntime: roleId fehlt');
    if (typeof o.chat !== 'function') throw new Error('AgentRuntime: chat-funktion fehlt');

    this.queue = o.queue;
    this.roleId = o.roleId;
    this.model = o.model || 'astra';
    this.chat = o.chat;
    this.validator = o.validator || null;
    this.policy = o.policy || null;
    this.workspace = o.workspace || null;
    this.toolRunner = this.workspace ? new ToolRunner(this.workspace) : null;
    this.pollMs = Number(o.pollMs) || 1000;
    this.logger = o.logger || console;
    this.onDone = o.onDone || null;
    this.onFailed = o.onFailed || null;

    this.timer = null;
    // Semaphore: hoechstens maxConcurrent Tasks gleichzeitig ausfuehren
    this.maxConcurrent = Math.max(1, Number(o.maxConcurrent) || 2);
    this.active = 0;
    this._waiters = [];
    this.stats = { claimed: 0, done: 0, failed: 0, toolCalls: 0, delegated: 0 };
  }

  start() {
    if (this.timer) return this;
    const every = Math.max(50, this.pollMs);
    this.timer = setInterval(() => {
      this.tick().catch(err => this.logger.error('[runtime ' + this.roleId + '] tick-fehler: ' + err.message));
    }, every);
    if (this.timer.unref) this.timer.unref();
    // sofort einmal pollen
    this.tick().catch(err => this.logger.error('[runtime ' + this.roleId + '] tick-fehler: ' + err.message));
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  // Semaphore: blockiert, bis ein Ausfuehrungs-Slot frei ist
  _acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise(resolve => this._waiters.push(resolve)).then(() => { this.active += 1; });
  }

  _release() {
    this.active = Math.max(0, this.active - 1);
    const next = this._waiters.shift();
    if (next) next();
  }

  // holt genau einen Task und fuehrt ihn aus
  async tick() {
    // kein unbegrenztes Warten ansammeln (Polling-Timer wuerde sonst auflaufen)
    if (this._waiters.length >= this.maxConcurrent) return null;
    await this._acquire();
    try {
      const task = await this.queue.claimNextTask(this.roleId);
      if (!task) return null;
      // Defense-in-depth: Quelle muss laut Graph berechtigt sein
      if (this.policy && typeof this.policy.canReceive === 'function' &&
          !this.policy.canReceive(this.roleId, task.source_role)) {
        const failed = await this.queue.updateState(task.id, 'failed', {
          error: 'UNAUTHORIZED: ' + task.source_role + ' darf nicht an ' + this.roleId + ' senden',
          code: 'UNAUTHORIZED',
        });
        this.stats.failed += 1;
        await this.notifyParent(failed);
        return { ok: false, task: failed, error: new Error('UNAUTHORIZED') };
      }
      this.stats.claimed += 1;
      return await this.execute(task);
    } finally {
      this._release();
    }
  }

  async execute(task) {
    // claimed -> running
    let running;
    try {
      running = await this.queue.updateState(task.id, 'running', { message: 'claimed by ' + this.roleId });
    } catch (err) {
      this.logger.error('[runtime ' + this.roleId + '] running fehlgeschlagen: ' + err.message);
      return { ok: false, task, error: err };
    }

    let result;
    try {
      // nach einem Delegations-Roundtrip liegen die Kind-Ergebnisse bereit.
      // Wichtig fuer Self-Healing: inkl. error_history/stderr der Kinder laden.
      let context = running;
      if (typeof this.queue.listChildren === 'function') {
        const children = await this.queue.listChildren(running.id);
        const finished = children.filter(c => c.state === 'done' || c.state === 'failed' || c.state === 'escalated');
        if (finished.length) {
          const childResults = finished.map(c => ({
            id: c.id,
            title: c.title,
            state: c.state,
            attempts: c.attempts,
            result: c.result,
            error_history: c.error_history,
            stderr: childStderr(c),
          }));
          context = Object.assign({}, running, { child_results: childResults });
          const selfHeal = selfHealContext(childResults);
          if (selfHeal) context.self_heal = selfHeal;
        }
      }
      result = await this.chatWithTools(context);
      if (result && result.__delegated) {
        // Elternteil wartet auf das Kind; die Fortsetzung kommt beim Re-Claim
        this.stats.delegated += 1;
        return { ok: true, task: await this.queue.getTask(task.id), delegated: result.tool_result.childId };
      }
      if (this.validator) {
        const valid = await this.validator(running, result);
        if (valid === false) {
          const err = new Error('schema-validierung fehlgeschlagen fuer "' + running.schema_name + '"');
          err.code = 'SCHEMA_INVALID';
          throw err;
        }
      }
    } catch (err) {
      // stderr des letzten fehlgeschlagenen Tool-Aufrufs in die Task-History
      const toolResult = err && err.toolResult;
      const stderr = toolResult && (toolResult.stderr || toolResult.error);
      const failed = await this.queue.updateState(task.id, 'failed', {
        error: err.message || String(err),
        code: err.code || null,
        stderr: stderr || undefined,
        tool: toolResult && toolResult.tool,
        exitCode: toolResult ? toolResult.exitCode : undefined,
      });
      this.stats.failed += 1;
      await this.notifyParent(failed);
      if (this.onFailed) this.onFailed(failed);
      return { ok: false, task: failed, error: err };
    }

    const done = await this.queue.updateState(task.id, 'done', {
      result,
      message: 'done by ' + this.roleId,
    });
    this.stats.done += 1;
    await this.notifyParent(done);
    if (this.onDone) this.onDone(done);
    return { ok: true, task: done };
  }

  /**
   * chatWithTools(task, maxRounds = 5)
   * Solange der Agent mit {"tool":...,"args":{...}} antwortet, fuehrt die Runtime
   * das Tool aus und schickt das Ergebnis als tool_result zurueck. Nach
   * maxRounds ohne finale Antwort bricht sie mit einem Fehler ab.
   */
  async chatWithTools(task, maxRounds) {
    const limit = Math.max(1, Number(maxRounds) || 5);
    let context = Object.assign({}, task);
    let lastToolFailure = null;
    for (let round = 0; round < limit; round += 1) {
      if (TOOL_DEBUG) this.logger.log('[runtime ' + this.roleId + '] chat-start runde ' + (round + 1) + ' task=' + (task.title || ''));
      const reply = await this.chat({ task: context, roleId: this.roleId, model: this.model });
      if (TOOL_DEBUG) this.logger.log('[runtime ' + this.roleId + '] chat-ende runde ' + (round + 1));
      const call = parseToolCall(reply);
      if (!call) {
        // expliziter Fehlschlag des Agenten -> Task failed (Self-Healing-Kette)
        const failure = explicitFailure(reply);
        if (failure) {
          const err = new Error('AGENT_FAILED: ' + failure.message);
          err.code = 'AGENT_FAILED';
          if (lastToolFailure) err.toolResult = lastToolFailure;
          throw err;
        }
        return reply;
      }

      // Delegation ist kein Datei-Tool: sie erzeugt einen Kind-Task und pausiert
      // den Parent (waiting_on_child), bis das Kind fertig ist.
      if (call.tool === 'delegate') {
        const delegated = await this.delegateTask(call.args || {}, task);
        this.stats.toolCalls += 1;
        if (delegated.ok) return { __delegated: true, tool_result: delegated };
        context = Object.assign({}, task, { tool_result: {
          tool: 'delegate', ok: false, error: delegated.error,
        }, previous_answer: reply });
        continue;
      }

      if (!this.toolRunner) throw new Error('Tool-Aufruf ohne Workspace: ' + call.tool);

      let toolResult;
      const toolStarted = Date.now();
      if (TOOL_DEBUG) {
        this.logger.log('[runtime ' + this.roleId + '] tool-start ' + call.tool +
          ' ' + JSON.stringify(call.args || {}).slice(0, 200));
      }
      try {
        const output = await this.toolRunner.run(call.tool, call.args || {});
        toolResult = { tool: call.tool, ok: true, output };
        if (TOOL_DEBUG) {
          this.logger.log('[runtime ' + this.roleId + '] tool-ende ' + call.tool +
            ' ok=true dauer=' + (Date.now() - toolStarted) + 'ms');
        }
      } catch (err) {
        // Fehler ist ein Ergebnis, kein Abbruch: der Agent bekommt ihn zurueck.
        // stderr wird mitgeliefert, damit der Agent (und spaeter der Boss) den
        // konkreten Fehler analysieren kann.
        toolResult = {
          tool: call.tool,
          ok: false,
          error: err.message || String(err),
          stderr: err.stderr === undefined || err.stderr === null ? '' : String(err.stderr),
          exitCode: err.exitCode === undefined ? null : err.exitCode,
        };
        if (!lastToolFailure) lastToolFailure = toolResult;
        if (TOOL_DEBUG) {
          this.logger.log('[runtime ' + this.roleId + '] tool-ende ' + call.tool +
            ' ok=false dauer=' + (Date.now() - toolStarted) + 'ms error=' + (err.message || '').slice(0, 160));
        }
      }
      this.stats.toolCalls += 1;
      context = Object.assign({}, task, { tool_result: toolResult, previous_answer: reply });
    }
    const limitError = new Error('Tool-Loop-Limit erreicht');
    limitError.code = 'TOOL_LOOP_LIMIT';
    if (lastToolFailure) limitError.toolResult = lastToolFailure;
    throw limitError;
  }

  // Task an Untergebenen/Peer delegieren (Delegation ist eine Graph-Kante,
  // keine Datei-Operation). Erzeugt einen Kind-Task und pausiert den Parent.
  async delegateTask(args, task) {
    const a = args || {};
    const target = String(a.role || a.target_role || '');
    if (!target) return { ok: false, error: 'delegate: role fehlt' };
    if (this.policy && typeof this.policy.canSend === 'function' &&
        !this.policy.canSend(this.roleId, target)) {
      return { ok: false, error: 'UNAUTHORIZED: ' + this.roleId + ' darf nicht an ' + target + ' delegieren' };
    }
    // Zuerst waiting_on_child, dann enqueue: sonst kann das Kind fertig sein,
    // bevor der Parent wartet, und checkChildrenStatus no-opt -> Parent haengt.
    await this.queue.updateState(task.id, 'waiting_on_child', {
      message: 'delegiere an ' + target,
    });
    let created;
    try {
      created = await this.queue.enqueue({
        type: 'request',
        title: a.title || ('Delegiert: ' + (task.title || task.id)),
        description: a.description || '',
        schema_name: a.schema_name || 'delegated',
        payload: a.payload === undefined ? {} : a.payload,
        source_role: this.roleId,
        target_role: target,
        parent_id: task.id,
        request_id: a.request_id || ('deleg-' + task.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
        priority: Number(a.priority) || Number(task.priority) || 0,
      });
    } catch (err) {
      try {
        await this.queue.updateState(task.id, 'running', { message: 'delegation fehlgeschlagen' });
      } catch (_) { /* Parent bleibt waiting; Watchdog raeumt auf */ }
      throw err;
    }
    if (created && created.task && created.task.state === 'failed') {
      try {
        await this.queue.updateState(task.id, 'running', { message: 'delegation unauthorized' });
      } catch (_) { /* ignore */ }
      return { ok: false, error: 'UNAUTHORIZED: delegierter Task wurde abgelehnt' };
    }
    // Falls Kind schon fertig: Parent sofort wieder claimbar machen
    try {
      await this.queue.checkChildrenStatus(task.id);
    } catch (_) { /* ignore */ }
    return { ok: true, delegated: true, childId: created.task.id, target };
  }

  // Boss-Agent informieren: Eltern-Task zurueck auf running, wenn alle Kinder fertig sind
  async notifyParent(task) {
    if (!task || !task.parent_id) return null;
    try {
      return await this.queue.checkChildrenStatus(task.parent_id);
    } catch (err) {
      this.logger.error('[runtime ' + this.roleId + '] parent-callback fehlgeschlagen: ' + err.message);
      return null;
    }
  }
}

module.exports = {
  AgentRuntime,
  parseToolCall,
  childStderr,
  failedChildResults,
  selfHealContext,
  explicitFailure,
  SELF_HEAL_INSTRUCTION,
  SELF_HEAL_ACTION,
};
