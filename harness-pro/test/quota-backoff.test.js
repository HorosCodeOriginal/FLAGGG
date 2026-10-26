'use strict';
// Tests fuer 429-Backoff (DoD 1+2): Task geht zurueck in die Queue, attempts
// bleibt unveraendert, claimNextTask ignoriert retry_after in der Zukunft.

const test = require('node:test');
const assert = require('node:assert');

const { TaskQueue } = require('../taskqueue/taskqueue');

function makeQueue() {
  return new TaskQueue(':memory:');
}

async function queuedTask(queue, requestId) {
  const { task } = await queue.enqueue({
    type: 'request',
    title: 'quota-task',
    schema_name: 's1',
    payload: { q: 1 },
    source_role: 'system',
    target_role: 'role_a',
    request_id: requestId || 'req-' + Math.random().toString(36).slice(2, 9),
  });
  return task;
}

test('429 setzt den Task auf queued, retry_after +60s, attempts unveraendert (DoD 1)', async () => {
  const queue = makeQueue();
  const task = await queuedTask(queue);
  const claimed = await queue.claimNextTask('role_a');
  assert.strictEqual(claimed.state, 'claimed');
  await queue.updateState(task.id, 'running', { message: 'start' });
  const attemptsBefore = (await queue.getTask(task.id)).attempts;

  const back = await queue.updateState(task.id, 'failed', { error: 'HTTP 429 FreeUsageLimitError', code: '429' });
  assert.strictEqual(back.state, 'queued');
  assert.ok(back.retry_after, 'retry_after muss gesetzt sein');

  const delay = new Date(back.retry_after).getTime() - Date.now();
  assert.ok(delay > 55000 && delay <= 61000, 'retry_after liegt bei ~60s, war: ' + delay);
  assert.strictEqual(back.attempts, attemptsBefore, 'attempts darf nicht erhoeht werden');
  const history = typeof back.error_history === 'string' ? JSON.parse(back.error_history) : back.error_history;
  assert.strictEqual(history[0].code, '429');
  queue.close();
});

test('claimNextTask ignoriert retry_after in der Zukunft (DoD 2)', async () => {
  const queue = makeQueue();
  const task = await queuedTask(queue);
  await queue.claimNextTask('role_a');
  await queue.updateState(task.id, 'running', { message: 'start' });
  await queue.updateState(task.id, 'failed', { error: '429', code: '429' });

  assert.strictEqual(await queue.claimNextTask('role_a'), null, 'Task darf noch nicht claimbar sein');

  // Zeit kuenstlich ueberspringen: retry_after in die Vergangenheit setzen
  queue.db.prepare('UPDATE tasks SET retry_after = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), task.id);
  const claimed = await queue.claimNextTask('role_a');
  assert.ok(claimed, 'nach Ablauf muss der Task wieder claimbar sein');
  assert.strictEqual(claimed.id, task.id);
  queue.close();
});

test('Backoff verdoppelt sich (60s -> 120s) und ist nach 5 Retries erschoepft', async () => {
  const queue = makeQueue();
  const task = await queuedTask(queue);

  const delays = [];
  for (let i = 0; i < 5; i += 1) {
    const claimed = await queue.claimNextTask('role_a');
    assert.ok(claimed, 'Runde ' + i + ' muss claimbar sein');
    await queue.updateState(task.id, 'running', { message: 'start' });
    const back = await queue.updateState(task.id, 'failed', { error: '429', code: '429' });
    assert.strictEqual(back.state, 'queued');
    delays.push(Math.round((new Date(back.retry_after).getTime() - Date.now()) / 1000));
    queue.db.prepare('UPDATE tasks SET retry_after = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), task.id);
  }
  assert.deepStrictEqual(delays, [60, 120, 240, 480, 960]);

  // 6. Fehlschlag: Budget erschoepft -> echter failed-Zustand
  const claimed = await queue.claimNextTask('role_a');
  assert.ok(claimed);
  await queue.updateState(task.id, 'running', { message: 'start' });
  const final = await queue.updateState(task.id, 'failed', { error: '429', code: '429' });
  assert.strictEqual(final.state, 'failed');
  queue.close();
});

test('normale Fehler bleiben failed (kein Backoff)', async () => {
  const queue = makeQueue();
  const task = await queuedTask(queue);
  await queue.claimNextTask('role_a');
  await queue.updateState(task.id, 'running', { message: 'start' });
  const failed = await queue.updateState(task.id, 'failed', { error: 'boom', code: 'E_RUNTIME' });
  assert.strictEqual(failed.state, 'failed');
  assert.strictEqual(failed.retry_after, null);
  queue.close();
});
