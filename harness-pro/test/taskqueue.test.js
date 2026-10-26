'use strict';
// Tests der TaskQueue: Idempotenz, atomarer Claim, FSM, Event-Log.
// Ausfuehren: npm test  (node --test test/)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { FsmError } = require('../taskqueue/fsm');

function tmpDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-tq-'));
  return path.join(dir, name || 'tasks.sqlite');
}

function sample(overrides) {
  return Object.assign({
    type: 'request',
    title: 'SQL optimieren',
    description: 'Index pruefen',
    schema_name: 'optimize_sql_v1',
    payload: { query: 'select * from users' },
    source_role: 'role_boss_01',
    target_role: 'role_dev_01',
    request_id: 'req-1',
    priority: 5,
    max_attempts: 2,
  }, overrides || {});
}

test('enqueue ist idempotent ueber request_id', () => {
  const q = new TaskQueue(tmpDb());
  const first = q.enqueue(sample());
  const second = q.enqueue(sample({ title: 'anderer Titel' }));
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(second.task.id, first.task.id);
  assert.strictEqual(q.listTasks({}).length, 1);
  q.close();
});

test('claimNextTask: nur einer von zwei parallelen Aufrufen bekommt den Task', () => {
  const file = tmpDb();
  const q1 = new TaskQueue(file);
  const q2 = new TaskQueue(file);
  q1.enqueue(sample());

  const a = q1.claimNextTask('role_dev_01');
  const b = q2.claimNextTask('role_dev_01');

  const winners = [a, b].filter(Boolean);
  assert.strictEqual(winners.length, 1, 'genau ein Claim darf gewinnen');
  assert.strictEqual(winners[0].state, 'claimed');
  assert.strictEqual(winners[0].attempts, 1);

  q1.close();
  q2.close();
});

test('claimNextTask respektiert Ziel-Rolle und Prioritaet', () => {
  const q = new TaskQueue(tmpDb());
  q.enqueue(sample({ request_id: 'r-low', priority: 1 }));
  q.enqueue(sample({ request_id: 'r-high', priority: 9 }));
  q.enqueue(sample({ request_id: 'r-other', target_role: 'role_qa_01' }));

  const claimed = q.claimNextTask('role_dev_01');
  assert.strictEqual(claimed.request_id, 'r-high');
  q.close();
});

test('unerlaubter FSM-Uebergang queued -> done wirft', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample());
  assert.throws(() => q.updateState(task.id, 'done', { result: {} }), FsmError);
  assert.strictEqual(q.getTask(task.id).state, 'queued');
  q.close();
});

test('running -> done verlangt valides result', () => {
  const q = new TaskQueue(tmpDb(), {
    validators: {
      optimize_sql_v1: result => !!result && typeof result.sql === 'string',
    },
  });
  const { task } = q.enqueue(sample());
  q.claimNextTask('role_dev_01');
  q.updateState(task.id, 'running');

  assert.throws(() => q.updateState(task.id, 'done', {}), /result/);
  assert.throws(() => q.updateState(task.id, 'done', { result: { sql: 1 } }), /schema/);

  const done = q.updateState(task.id, 'done', { result: { sql: 'select 1' } });
  assert.strictEqual(done.state, 'done');
  assert.deepStrictEqual(done.result, { sql: 'select 1' });
  q.close();
});

test('failed -> queued nur solange Versuche uebrig sind, sonst escalated', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample({ max_attempts: 1 }));

  q.claimNextTask('role_dev_01');
  q.updateState(task.id, 'running');
  const failed = q.updateState(task.id, 'failed', { error: 'timeout' });
  assert.strictEqual(failed.state, 'failed');
  assert.strictEqual(failed.error_history.length, 1);

  assert.throws(() => q.updateState(task.id, 'queued'), /escalated/);

  const escalated = q.updateState(task.id, 'escalated');
  assert.strictEqual(escalated.state, 'escalated');
  q.close();
});

test('failed -> queued erlaubt, solange attempts < max_attempts', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample({ max_attempts: 2 }));

  q.claimNextTask('role_dev_01');
  q.updateState(task.id, 'running');
  q.updateState(task.id, 'failed', { error: 'erster Versuch' });
  const requeued = q.updateState(task.id, 'queued');
  assert.strictEqual(requeued.state, 'queued');
  q.close();
});

test('jeder Wechsel landet im Event-Log', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample());
  q.claimNextTask('role_dev_01');
  q.updateState(task.id, 'running');
  const events = q.events(task.id);
  assert.deepStrictEqual(events.map(e => e.to_state), ['queued', 'claimed', 'running']);
  q.close();
});
