'use strict';
// Test der Runtime-Semaphore (DoD 3): nie mehr als maxConcurrent gleichzeitig.

const test = require('node:test');
const assert = require('node:assert');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { AgentRuntime } = require('../taskqueue/runtime');

async function queueWithTasks(count) {
  const queue = new TaskQueue(':memory:');
  for (let i = 0; i < count; i += 1) {
    await queue.enqueue({
      type: 'request',
      title: 'task-' + i,
      schema_name: 's1',
      payload: { i },
      source_role: 'system',
      target_role: 'slow',
      request_id: 'req-' + i + '-' + Math.random().toString(36).slice(2, 8),
    });
  }
  return queue;
}

function slowChat(state) {
  return async () => {
    state.active += 1;
    state.max = Math.max(state.max, state.active);
    await new Promise(resolve => setTimeout(resolve, 40));
    state.active -= 1;
    state.calls += 1;
    return { result: { ok: true } };
  };
}

test('maxConcurrent = 1 serialisiert die Ausfuehrung (DoD 3)', async () => {
  const queue = await queueWithTasks(3);
  const state = { active: 0, max: 0, calls: 0 };
  const runtime = new AgentRuntime({ roleId: 'slow', queue, chat: slowChat(state), maxConcurrent: 1 });

  await Promise.all([runtime.tick(), runtime.tick(), runtime.tick()]);
  // Nach den ersten drei Ticks koennen noch Tasks in der Queue sein
  const rest = [];
  while (state.calls < 3) rest.push(await runtime.tick());
  assert.strictEqual(state.max, 1, 'nie mehr als 1 parallele Ausfuehrung');
  assert.strictEqual(state.calls, 3);
  queue.close();
});

test('maxConcurrent = 2 laesst zwei Tasks parallel laufen', async () => {
  const queue = await queueWithTasks(4);
  const state = { active: 0, max: 0, calls: 0 };
  const runtime = new AgentRuntime({ roleId: 'slow', queue, chat: slowChat(state), maxConcurrent: 2 });

  const running = [runtime.tick(), runtime.tick(), runtime.tick(), runtime.tick()];
  await Promise.all(running);
  assert.strictEqual(state.max, 2, 'genau 2 parallel');
  assert.ok(state.calls >= 2);
  queue.close();
});
