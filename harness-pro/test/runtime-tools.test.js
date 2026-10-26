'use strict';
// Tests der Tool-Integration in der Runtime (DoD 1-3).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { AgentRuntime } = require('../taskqueue/runtime');

function ws() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-runtime-ws-'));
}

async function queueWithTask(targetRole) {
  const queue = new TaskQueue(':memory:');
  const { task } = await queue.enqueue({
    type: 'request',
    title: 'tool-task',
    schema_name: 's1',
    payload: { q: 1 },
    source_role: 'system',
    target_role: targetRole || 'role_a',
    request_id: 'req-' + Math.random().toString(36).slice(2, 9),
  });
  return { queue, task };
}

test('execute_shell: Tool wird ausgefuehrt, Ergebnis kommt zurueck, Agent antwortet final (DoD 1)', async () => {
  const { queue, task } = await queueWithTask();
  const rounds = [];
  const runtime = new AgentRuntime({
    roleId: 'role_a',
    queue,
    workspace: ws(),
    pollMs: 5,
    chat: async ({ task: ctx }) => {
      rounds.push(ctx);
      if (rounds.length === 1) {
        return { result: { tool: 'execute_shell', args: { command: 'echo hallo-welt' } } };
      }
      assert.ok(ctx.previous_answer, 'previous_answer muss mitgegeben werden');
      assert.ok(ctx.tool_result, 'Agent muss das Tool-Ergebnis erhalten');
      assert.strictEqual(ctx.tool_result.ok, true);
      return { result: { final: 'fertig', stdout: ctx.tool_result.output.stdout.trim() } };
    },
  });

  const result = await runtime.tick();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(runtime.stats.toolCalls, 1);
  assert.strictEqual(rounds.length, 2);

  const done = await queue.getTask(task.id);
  assert.strictEqual(done.state, 'done');
  const doneResult = typeof done.result === 'string' ? JSON.parse(done.result) : done.result;
  assert.strictEqual(doneResult.result.final, 'fertig');
  assert.match(doneResult.result.stdout, /hallo-welt/);
  queue.close();
});

test('read_file ausserhalb des Workspace: Fehler kommt als tool_result zurueck (DoD 2)', async () => {
  const { queue, task } = await queueWithTask();
  let seen = null;
  const runtime = new AgentRuntime({
    roleId: 'role_a',
    queue,
    workspace: ws(),
    pollMs: 5,
    chat: async ({ task: ctx }) => {
      if (!ctx.tool_result) {
        return { result: { tool: 'read_file', args: { path: '../../etc/passwd' } } };
      }
      seen = ctx.tool_result;
      return { result: { final: 'ok', error: ctx.tool_result.error } };
    },
  });

  const result = await runtime.tick();
  assert.strictEqual(result.ok, true, 'Runtime darf nicht abbrechen, der Agent entscheidet');
  assert.ok(seen);
  assert.strictEqual(seen.ok, false);
  assert.match(seen.error, /ausserhalb des Workspace/);
  assert.strictEqual(runtime.stats.toolCalls, 1);

  const done = await queue.getTask(task.id);
  assert.strictEqual(done.state, 'done');
  queue.close();
});

test('Tool-Loop-Limit (5 Runden) wird durchgesetzt (DoD 3)', async () => {
  const { queue, task } = await queueWithTask();
  let calls = 0;
  const runtime = new AgentRuntime({
    roleId: 'role_a',
    queue,
    workspace: ws(),
    pollMs: 5,
    chat: async () => {
      calls += 1;
      return { result: { tool: 'execute_shell', args: { command: 'echo x' } } };
    },
  });

  const result = await runtime.tick();
  assert.strictEqual(result.ok, false);
  assert.match(result.error.message, /Tool-Loop-Limit erreicht/);
  assert.strictEqual(calls, 5, 'genau 5 Runden');
  assert.strictEqual(runtime.stats.toolCalls, 5);

  const failed = await queue.getTask(task.id);
  assert.strictEqual(failed.state, 'failed');
  const history = typeof failed.error_history === 'string' ? JSON.parse(failed.error_history) : failed.error_history;
  assert.match(history[0].error, /Tool-Loop-Limit/);
  queue.close();
});

test('ohne Workspace bleibt chatWithTools beim reinen Chat', async () => {
  const { queue } = await queueWithTask();
  const runtime = new AgentRuntime({
    roleId: 'role_a',
    queue,
    pollMs: 5,
    chat: async () => ({ result: { final: 'ohne tools' } }),
  });
  const result = await runtime.tick();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(runtime.stats.toolCalls, 0);
  queue.close();
});
