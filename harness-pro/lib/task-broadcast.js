'use strict';
// task-broadcast.js — pollt task_events und schickt neue Eintraege an den Renderer.
// Bewusst polling statt Trigger: SQLite kennt keine Push-Events, und der Worker
// laeuft in einem eigenen Prozess.

const DEFAULTS = { intervalMs: 1000, batch: 100 };

class TaskBroadcaster {
  constructor(options) {
    const o = options || {};
    if (!o.queue) throw new Error('TaskBroadcaster: queue fehlt');
    if (typeof o.send !== 'function') throw new Error('TaskBroadcaster: send fehlt');

    this.queue = o.queue;
    this.send = o.send;
    this.channel = o.channel || 'task:event';
    this.intervalMs = Number(o.intervalMs) || DEFAULTS.intervalMs;
    this.batch = Number(o.batch) || DEFAULTS.batch;
    this.logger = o.logger || console;
    this.lastId = Number(o.startAfterId) || 0;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      this.tick().catch(err => this.logger.error('[task-broadcast] tick-fehler: ' + err.message));
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  // liest alle neuen Events und schickt sie einzeln weiter
  async tick() {
    if (this.running) return [];
    this.running = true;
    const sent = [];
    try {
      const events = await this.queue.eventsSince(this.lastId, this.batch);
      if (!Array.isArray(events)) return sent;
      for (const evt of events) {
        if (!evt || typeof evt.id !== 'number') continue;
        if (evt.id <= this.lastId) continue;
        this.lastId = evt.id;
        const payload = {
          id: evt.id,
          taskId: evt.taskId,
          fromState: evt.fromState,
          toState: evt.toState,
          roleId: evt.roleId,
          sourceRole: evt.sourceRole,
          message: evt.message || null,
          timestamp: evt.timestamp,
        };
        this.send(this.channel, payload);
        sent.push(payload);
      }
    } finally {
      this.running = false;
    }
    return sent;
  }
}

module.exports = { TaskBroadcaster };
