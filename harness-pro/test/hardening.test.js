'use strict';
// Tests fuer Haertung (Watchdog, claimed_by, parent/child) und AgentRuntime.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { AgentRuntime } = require('../taskqueue/runtime');
const { sendChatWithRetry, isRetryable } = require('../lib/chat-retry');
const { FsmError } = require('../taskqueue/fsm');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-hard-'));
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
    max_attempts: 2,
  }, overrides || {});
}

test('queued -> cancelled ist erlaubt', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample());
  const cancelled = q.updateState(task.id, 'cancelled', { message: 'abgebrochen' });
  assert.strictEqual(cancelled.state, 'cancelled');
  q.close();
});

test('claimed_by wird beim Claim gesetzt und bei failed -> queued gecleart', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample());

  const claimed = q.claimNextTask('dev');
  assert.strictEqual(claimed.claimed_by, 'dev');

  q.updateState(task.id, 'running');
  q.updateState(task.id, 'failed', { error: 'kaputt' });
  assert.strictEqual(q.getTask(task.id).claimed_by, 'dev', 'bleibt nach failed gesetzt');

  const requeued = q.updateState(task.id, 'queued');
  assert.strictEqual(requeued.claimed_by, null, 'wird beim Zurueckstellen gecleart');
  q.close();
});

test('Timeout-Watchdog setzt haengende Tasks auf failed (TIMEOUT)', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample({ timeout_ms: 50 }));
  q.claimNextTask('dev');
  q.updateState(task.id, 'running');

  // updated_at kuenstlich in die Vergangenheit ziehen (haengender Task)
  q.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 60000).toISOString(), task.id);

  const swept = q.sweepTimeouts(Date.now());
  assert.strictEqual(swept.length, 1);
  assert.strictEqual(swept[0].state, 'failed');
  assert.match(swept[0].error_history[0].error, /TIMEOUT/);
  q.close();
});

test('Watchdog laesst frische Tasks unberuehrt', () => {
  const q = new TaskQueue(tmpDb());
  const { task } = q.enqueue(sample({ timeout_ms: 60000 }));
  q.claimNextTask('dev');
  q.updateState(task.id, 'running');
  assert.strictEqual(q.sweepTimeouts(Date.now()).length, 0);
  q.close();
});

test('checkChildrenStatus stellt Eltern-Task wieder in die Queue', () => {
  const q = new TaskQueue(tmpDb());
  const parent = q.enqueue(sample({ request_id: 'p-1', target_role: 'boss' })).task;
  q.claimNextTask('boss');
  q.updateState(parent.id, 'running');
  q.updateState(parent.id, 'waiting_on_child');

  const c1 = q.enqueue(sample({ request_id: 'c-1', parent_id: parent.id })).task;
  const c2 = q.enqueue(sample({ request_id: 'c-2', parent_id: parent.id })).task;

  q.claimNextTask('dev'); // c1
  q.updateState(c1.id, 'running');
  q.updateState(c1.id, 'done', { result: { ok: 1 } });
  assert.strictEqual(q.getTask(parent.id).state, 'waiting_on_child');

  q.claimNextTask('dev'); // c2
  q.updateState(c2.id, 'running');
  q.updateState(c2.id, 'done', { result: { ok: 2 } });

  const parentState = q.checkChildrenStatus(parent.id);
  assert.strictEqual(parentState.state, 'queued', 'Parent muss fuer die Fortsetzung wieder claimbar sein');
  assert.ok(q.claimNextTask('boss'), 'Parent ist wieder claimbar');
  q.close();
});

test('AgentRuntime: claim -> running -> done mit Mock-Antwort', async () => {
  const q = new TaskQueue(tmpDb(), { validators: { s1: r => !!r && r.answer === 'pong' } });
  const rt = new AgentRuntime({
    queue: q,
    roleId: 'dev',
    pollMs: 50,
    chat: async () => ({ answer: 'pong' }),
    validator: (task, result) => result && result.answer === 'pong',
    logger: { error() {} },
  });
  q.enqueue(sample({ request_id: 'rt-1' }));

  const out = await rt.tick();
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.task.state, 'done');
  assert.deepStrictEqual(out.task.result, { answer: 'pong' });
  assert.strictEqual(q.events(out.task.id).map(e => e.to_state).join('>'), 'queued>claimed>running>done');
  q.close();
});

test('AgentRuntime: ungueltiges Ergebnis -> failed mit Error-History', async () => {
  const q = new TaskQueue(tmpDb());
  const rt = new AgentRuntime({
    queue: q,
    roleId: 'dev',
    chat: async () => ({ answer: 'falsch' }),
    validator: () => false,
    logger: { error() {} },
  });
  q.enqueue(sample({ request_id: 'rt-2' }));

  const out = await rt.tick();
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.task.state, 'failed');
  assert.match(out.task.error_history[0].error, /schema-validierung/);
  q.close();
});

test('AgentRuntime: notifyParent stellt den Boss wieder in die Queue', async () => {
  const q = new TaskQueue(tmpDb());
  const parent = q.enqueue(sample({ request_id: 'p-2', target_role: 'boss' })).task;
  q.claimNextTask('boss');
  q.updateState(parent.id, 'running');
  q.updateState(parent.id, 'waiting_on_child');

  q.enqueue(sample({ request_id: 'kid-1', parent_id: parent.id }));
  const rt = new AgentRuntime({
    queue: q, roleId: 'dev', chat: async () => ({ ok: true }), logger: { error() {} },
  });
  const out = await rt.tick();
  assert.strictEqual(out.ok, true);
  assert.strictEqual(q.getTask(parent.id).state, 'queued', 'Parent muss wieder claimbar sein');
  q.close();
});

test('sendChatWithRetry rotiert bei 429 zur naechsten Instanz', async () => {
  const seen = [];
  const candidates = [{ nr: 1 }, { nr: 2 }, { nr: 3 }];
  const result = await sendChatWithRetry({
    candidates,
    attempt: async candidate => {
      seen.push(candidate.nr);
      if (candidate.nr === 1) throw Object.assign(new Error('429'), { status: 429 });
      if (candidate.nr === 2) throw Object.assign(new Error('503'), { status: 503 });
      return { text: 'pong' };
    },
    onRoute: () => {},
  });
  assert.deepStrictEqual(seen, [1, 2, 3]);
  assert.strictEqual(result.candidate.nr, 3);
  assert.strictEqual(result.history.length, 2);
});

test('sendChatWithRetry bricht bei 401 sofort ab', async () => {
  let calls = 0;
  await assert.rejects(sendChatWithRetry({
    candidates: [{ nr: 1 }, { nr: 2 }],
    attempt: async () => { calls += 1; throw Object.assign(new Error('401'), { status: 401 }); },
  }), /401/);
  assert.strictEqual(calls, 1);
});

test('isRetryable erkennt 429/5xx/Netzwerk', () => {
  assert.strictEqual(isRetryable({ status: 429 }), true);
  assert.strictEqual(isRetryable({ status: 503 }), true);
  assert.strictEqual(isRetryable({ status: 401 }), false);
  assert.strictEqual(isRetryable(new Error('ECONNRESET')), true);
});
