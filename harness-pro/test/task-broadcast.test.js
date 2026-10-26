'use strict';
// Tests des Live-Broadcasters: neue task_events -> 'task:event' an den Renderer.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskBroadcaster } = require('../lib/task-broadcast');
const { TaskQueue } = require('../taskqueue/taskqueue');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-bc-'));
  return path.join(dir, 'tasks.sqlite');
}

function sample(overrides) {
  return Object.assign({
    type: 'request',
    title: 'Test',
    schema_name: 's1',
    payload: { q: 1 },
    source_role: 'boss',
    target_role: 'dev',
    request_id: 'req-' + Math.random().toString(36).slice(2, 8),
  }, overrides || {});
}

test('neuer Task in der DB loest ein task:event aus (Mock-Test)', async () => {
  const queue = new TaskQueue(tmpDb());
  const sent = [];
  const bc = new TaskBroadcaster({
    queue,
    send: (channel, payload) => sent.push({ channel, payload }),
    intervalMs: 100000,
  });

  queue.enqueue(sample({ request_id: 'evt-1' }));
  await bc.tick();

  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].channel, 'task:event');
  assert.strictEqual(sent[0].payload.toState, 'queued');
  assert.strictEqual(sent[0].payload.roleId, 'dev');
  assert.strictEqual(sent[0].payload.sourceRole, 'boss');
  assert.ok(sent[0].payload.taskId);
  assert.ok(sent[0].payload.timestamp);
  queue.close();
});

test('Broadcaster sendet keine Duplikate und zieht lastId nach', async () => {
  const queue = new TaskQueue(tmpDb());
  const sent = [];
  const bc = new TaskBroadcaster({ queue, send: (ch, p) => sent.push(p), intervalMs: 100000 });

  const { task } = queue.enqueue(sample({ request_id: 'evt-2' }));
  await bc.tick();
  const firstCount = sent.length;
  await bc.tick(); // nichts Neues
  assert.strictEqual(sent.length, firstCount);

  queue.claimNextTask('dev');
  await bc.tick();
  assert.ok(sent.length > firstCount);
  assert.strictEqual(sent[sent.length - 1].toState, 'claimed');
  assert.strictEqual(sent[sent.length - 1].taskId, task.id);
  queue.close();
});

test('Statuswechsel laufen als Event-Kette (queued -> claimed -> running -> failed)', async () => {
  const queue = new TaskQueue(tmpDb());
  const sent = [];
  const bc = new TaskBroadcaster({ queue, send: (ch, p) => sent.push(p), intervalMs: 100000 });

  const { task } = queue.enqueue(sample({ request_id: 'evt-3' }));
  queue.claimNextTask('dev');
  queue.updateState(task.id, 'running');
  queue.updateState(task.id, 'failed', { error: 'kaputt' });
  await bc.tick();

  assert.deepStrictEqual(sent.map(e => e.toState), ['queued', 'claimed', 'running', 'failed']);
  queue.close();
});

test('stop() beendet den Timer', () => {
  const bc = new TaskBroadcaster({ queue: { eventsSince: async () => [] }, send: () => {}, intervalMs: 50 });
  bc.start();
  assert.ok(bc.timer);
  bc.stop();
  assert.strictEqual(bc.timer, null);
});
