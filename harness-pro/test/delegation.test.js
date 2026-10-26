'use strict';
// Tests der Delegation: Boss -> Untergebener -> Kind-Task -> Fortsetzung beim Boss.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { AgentRuntime } = require('../taskqueue/runtime');
const { createPolicy } = require('../taskqueue/policy');

function roles() {
  return [
    { id: 'boss', relationships: { superiors: [], subordinates: ['sub'], peers: [] } },
    { id: 'sub', relationships: { superiors: ['boss'], subordinates: [], peers: [] } },
    { id: 'outsider', relationships: { superiors: [], subordinates: [], peers: [] } },
  ];
}

function ws(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-' + prefix + '-'));
}

async function enqueueSystem(queue, targetRole, title, payload) {
  const { task } = await queue.enqueue({
    type: 'request',
    title,
    schema_name: 's1',
    payload: payload || { instruction: 'Schreibe hallo.py und fuehre es aus' },
    source_role: 'system',
    target_role: targetRole,
    request_id: 'deleg-req-' + Math.random().toString(36).slice(2, 9),
  });
  return task;
}

test('Boss delegiert an Sub: Kind-Task entsteht, Parent pausiert, Kind-Ergebnis kommt zurueck', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  const bossWs = ws('boss');
  const subWs = ws('sub');
  const parent = await enqueueSystem(queue, 'boss', 'Python-Hallo');

  let bossRounds = 0;
  const boss = new AgentRuntime({
    roleId: 'boss',
    queue,
    workspace: bossWs,
    pollMs: 5,
    policy: createPolicy(roles()),
    chat: async ({ task: ctx }) => {
      bossRounds += 1;
      if (bossRounds === 1) {
        return { result: { tool: 'delegate', args: { role: 'sub', title: 'Python-Hallo (delegiert)', payload: { instruction: 'Schreibe hallo.py und fuehre es aus' } } } };
      }
      assert.ok(Array.isArray(ctx.child_results), 'Boss muss die Kind-Ergebnisse sehen');
      assert.strictEqual(ctx.child_results.length, 1);
      assert.strictEqual(ctx.child_results[0].state, 'done');
      return { result: { final: 'Kind fertig', childState: ctx.child_results[0].state } };
    },
  });

  const first = await boss.tick();
  assert.strictEqual(first.ok, true);
  assert.ok(first.delegated, 'Runtime muss die Delegation melden');
  assert.strictEqual(boss.stats.delegated, 1);

  const parentState = await queue.getTask(parent.id);
  assert.strictEqual(parentState.state, 'waiting_on_child');

  const children = await queue.listChildren(parent.id);
  assert.strictEqual(children.length, 1);
  assert.strictEqual(children[0].source_role, 'boss');
  assert.strictEqual(children[0].target_role, 'sub');

  // Sub-Agent arbeitet den Kind-Task ab (write_file + shell)
  let subRounds = 0;
  const sub = new AgentRuntime({
    roleId: 'sub',
    queue,
    workspace: subWs,
    pollMs: 5,
    policy: createPolicy(roles()),
    chat: async ({ task: ctx }) => {
      subRounds += 1;
      if (subRounds === 1) {
        return { result: { tool: 'write_file', args: { path: 'hallo.py', content: "print('Hallo')\n" } } };
      }
      if (subRounds === 2) {
        return { result: { tool: 'execute_shell', args: { command: process.platform === 'win32' ? 'type hallo.py' : 'cat hallo.py' } } };
      }
      assert.ok(ctx.tool_result && ctx.tool_result.ok, 'Shell-Ergebnis muss ankommen');
      return { result: { ok: true, output: ctx.tool_result.output.stdout.trim() } };
    },
  });

  const subResult = await sub.tick();
  assert.strictEqual(subResult.ok, true);
  assert.ok(fs.existsSync(path.join(subWs, 'hallo.py')), 'Datei muss im Sub-Workspace liegen');

  // Parent wurde durch das fertige Kind wieder eingereiht
  const requeued = await queue.getTask(parent.id);
  assert.strictEqual(requeued.state, 'queued');

  // Boss setzt den Task mit den Kind-Ergebnissen fort
  const second = await boss.tick();
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.task.state, 'done');
  const finalResult = typeof second.task.result === 'string' ? JSON.parse(second.task.result) : second.task.result;
  assert.strictEqual(finalResult.result.final, 'Kind fertig');
  assert.strictEqual(finalResult.result.childState, 'done');
  assert.strictEqual(bossRounds, 2);
  queue.close();
});

test('Delegation an Unbeteiligten wird abgelehnt, Agent kann trotzdem antworten', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  const parent = await enqueueSystem(queue, 'boss', 'Unklare Aufgabe');

  let rounds = 0;
  const boss = new AgentRuntime({
    roleId: 'boss',
    queue,
    workspace: ws('boss2'),
    pollMs: 5,
    policy: createPolicy(roles()),
    chat: async ({ task: ctx }) => {
      rounds += 1;
      if (rounds === 1) {
        return { result: { tool: 'delegate', args: { role: 'outsider', title: 'verboten' } } };
      }
      assert.ok(ctx.tool_result && ctx.tool_result.ok === false);
      assert.match(ctx.tool_result.error, /UNAUTHORIZED/);
      return { result: { final: 'selbst erledigt' } };
    },
  });

  const result = await boss.tick();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.task.state, 'done');
  const children = await queue.listChildren(parent.id);
  assert.strictEqual(children.length, 0, 'kein Kind-Task bei unerlaubter Delegation');
  assert.strictEqual(rounds, 2);
  queue.close();
});
