'use strict';
// Tests des Self-Healing-Loops:
//  - stderr eines fehlgeschlagenen Tool-Aufrufs landet in der error_history
//  - fehlgeschlagenes Kind stellt den Parent wieder in die Queue
//  - Boss-Kontext enthaelt child_results + self_heal-Prompt-Injection
//  - max_loops verhindert Endlosschleifen
//  - Fast-Fail: Agent-Timeout wird als TIMEOUT persistiert

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { AgentRuntime, selfHealContext } = require('../taskqueue/runtime');
const { createPolicy } = require('../taskqueue/policy');
const { requestOnce, buildUserContent } = require('../lib/role-chat');

function roles() {
  return [
    { id: 'boss', relationships: { superiors: [], subordinates: ['sub'], peers: [] } },
    { id: 'sub', relationships: { superiors: ['boss'], subordinates: [], peers: [] } },
  ];
}

function ws(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-selfheal-' + prefix + '-'));
}

function task(overrides) {
  return Object.assign({
    type: 'request',
    title: 'Self-Healing-Test',
    schema_name: 's1',
    payload: { goal: 'test', max_loops: 5 },
    source_role: 'system',
    target_role: 'boss',
    request_id: 'sh-' + Math.random().toString(36).slice(2, 9),
  }, overrides || {});
}

function failCommand() {
  return process.platform === 'win32'
    ? 'echo boom-stderr 1>&2 & exit /b 3'
    : 'echo boom-stderr 1>&2; exit 3';
}

test('Tool-stderr landet in error_history, Kind failed, Parent wieder queued, Boss sieht self_heal', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  const parent = queue.enqueue(task()).task;
  const boss = new AgentRuntime({
    roleId: 'boss',
    queue,
    workspace: ws('boss'),
    pollMs: 5,
    policy: createPolicy(roles()),
    logger: { error() {} },
    chat: async ({ task: ctx }) => {
      if (!ctx.child_results) {
        return { result: { tool: 'delegate', args: { role: 'sub', title: 'Scraper schreiben', payload: { task: 'write' } } } };
      }
      const failed = ctx.child_results.filter(c => c.state === 'failed');
      assert.strictEqual(failed.length, 1, 'fehlgeschlagenes Kind muss im Kontext sein');
      assert.ok(ctx.self_heal, 'self_heal-Kontext fehlt');
      assert.match(ctx.self_heal.instruction, /Ein vorheriger Task ist fehlgeschlagen/);
      assert.match(ctx.self_heal.stderr, /boom-stderr/);
      assert.ok(Array.isArray(failed[0].error_history), 'error_history des Kindes muss geladen sein');
      const prompt = buildUserContent({ roleId: 'boss', task: ctx });
      assert.match(prompt, /Delegiere einen Fix-Task an den Agenten/);
      assert.ok(prompt.includes('boom-stderr'), 'stderr muss im Boss-Prompt stehen');
      return { result: { final: 'Fehler analysiert' } };
    },
  });

  const first = await boss.tick();
  assert.strictEqual(first.ok, true);
  assert.ok(first.delegated);

  let subRound = 0;
  const sub = new AgentRuntime({
    roleId: 'sub',
    queue,
    workspace: ws('sub'),
    pollMs: 5,
    policy: createPolicy(roles()),
    logger: { error() {} },
    chat: async ({ task: ctx }) => {
      subRound += 1;
      if (subRound === 1) {
        return { result: { tool: 'execute_shell', args: { command: failCommand() } } };
      }
      assert.ok(ctx.tool_result, 'Tool-Ergebnis muss ankommen');
      assert.strictEqual(ctx.tool_result.ok, false);
      assert.match(String(ctx.tool_result.stderr), /boom-stderr/);
      return { result: { ok: false, error: 'fehlendes Modul' } };
    },
  });

  const subResult = await sub.tick();
  assert.strictEqual(subResult.ok, false, 'Sub-Task muss failed sein');
  const child = queue.listChildren(parent.id)[0];
  assert.strictEqual(child.state, 'failed');
  assert.strictEqual(child.error_history[0].code, 'AGENT_FAILED');
  assert.match(child.error_history[0].stderr, /boom-stderr/);
  assert.match(child.error_history[0].error, /AGENT_FAILED/);

  const requeued = queue.getTask(parent.id);
  assert.strictEqual(requeued.state, 'queued', 'Parent muss fuer den Fix wieder claimbar sein');
  const eventMessages = queue.events(parent.id).map(e => String(e.message || ''));
  assert.ok(eventMessages.some(m => /self-heal/.test(m)), 'Event-Log muss self-heal vermerken');

  const second = await boss.tick();
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.task.state, 'done');
  queue.close();
});

test('checkChildrenStatus: fehlgeschlagenes Kind -> Parent queued, max_loops -> LOOP_LIMIT', () => {
  const q = new TaskQueue(':memory:');
  const parent = q.enqueue(task({ payload: { max_loops: 2 }, target_role: 'boss' })).task;
  q.claimNextTask('boss');
  q.updateState(parent.id, 'running');
  q.updateState(parent.id, 'waiting_on_child');

  const child = q.enqueue(task({ parent_id: parent.id, target_role: 'sub', request_id: 'kid-1' })).task;
  q.claimNextTask('sub');
  q.updateState(child.id, 'running');
  q.updateState(child.id, 'failed', { error: 'kaputt', code: 'TOOL_FAILED', stderr: 'ModuleNotFoundError: No module named requests' });

  const requeued = q.checkChildrenStatus(parent.id);
  assert.strictEqual(requeued.state, 'queued');

  // max_loops erreicht -> Parent endgueltig failed statt Endlosschleife
  q.claimNextTask('boss');
  q.updateState(parent.id, 'running');
  q.updateState(parent.id, 'waiting_on_child');
  const child2 = q.enqueue(task({ parent_id: parent.id, target_role: 'sub', request_id: 'kid-2' })).task;
  q.claimNextTask('sub');
  q.updateState(child2.id, 'running');
  q.updateState(child2.id, 'failed', { error: 'wieder kaputt', code: 'TOOL_FAILED', stderr: 'ModuleNotFoundError' });

  const limited = q.checkChildrenStatus(parent.id);
  assert.strictEqual(limited.state, 'failed');
  assert.strictEqual(limited.error_history[0].code, 'LOOP_LIMIT');
  q.close();
});

test('role-chat: Prompt-Injection mit stderr nur bei fehlgeschlagenen Kindern', () => {
  const failedTask = {
    title: 'Master-Goal',
    payload: { goal: 'Scraper bauen' },
    child_results: [{
      id: 'c1',
      title: 'Scraper schreiben',
      state: 'failed',
      error_history: [{
        at: new Date().toISOString(),
        error: 'AGENT_FAILED: fehlendes Modul',
        code: 'AGENT_FAILED',
        stderr: "Traceback (most recent call last):\nModuleNotFoundError: No module named 'requests'",
      }],
    }],
  };
  const prompt = buildUserContent({ roleId: 'boss_astra', task: failedTask });
  assert.match(prompt, /Ein vorheriger Task ist fehlgeschlagen\. Hier ist der stderr:/);
  assert.match(prompt, /No module named 'requests'/);
  assert.match(prompt, /Delegiere einen Fix-Task an den Agenten, um das Problem zu beheben/);

  const doneTask = {
    title: 'Master-Goal',
    payload: {},
    child_results: [{ id: 'c1', title: 'ok', state: 'done', result: { ok: true } }],
  };
  assert.doesNotMatch(buildUserContent({ roleId: 'boss_astra', task: doneTask }), /Ein vorheriger Task ist fehlgeschlagen/);
});

test('Self-Healing ist nicht sticky: nach erfolgreichem Fix keine Fix-Delegation mehr', () => {
  const failedChild = {
    id: 'c1',
    title: 'Scraper schreiben',
    state: 'failed',
    error_history: [{ error: 'AGENT_FAILED', code: 'AGENT_FAILED', stderr: 'ModuleNotFoundError: No module named requests' }],
  };
  const fixedChild = {
    id: 'c2',
    title: 'Scraper reparieren',
    state: 'done',
    result: { ok: true, file: 'hn_titles.json' },
  };

  // ungeloest: neuestes Kind failed -> Injection
  const unresolved = selfHealContext([failedChild]);
  assert.ok(unresolved);
  assert.match(unresolved.instruction, /Delegiere einen Fix-Task/);
  assert.match(unresolved.stderr, /No module named requests/);
  assert.match(
    buildUserContent({ roleId: 'boss_astra', task: { title: 'Master', payload: {}, child_results: [failedChild] } }),
    /Ein vorheriger Task ist fehlgeschlagen/,
  );

  // geloest: Fix-Kind ist das neueste Kind -> keine weitere Fix-Delegation
  assert.strictEqual(selfHealContext([failedChild, fixedChild]), null);
  const resolvedPrompt = buildUserContent({
    roleId: 'boss_astra',
    task: { title: 'Master', payload: {}, child_results: [failedChild, fixedChild] },
  });
  assert.doesNotMatch(resolvedPrompt, /Ein vorheriger Task ist fehlgeschlagen/);
  assert.doesNotMatch(resolvedPrompt, /Delegiere einen Fix-Task/);
});

test('role-chat: requestOnce bricht nach Timeout mit code TIMEOUT ab', async () => {
  const server = http.createServer(() => { /* antwortet absichtlich nie */ });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await assert.rejects(
      requestOnce({ port, key: 'k', body: { ping: 1 }, timeoutMs: 120 }),
      err => {
        assert.strictEqual(err.code, 'TIMEOUT');
        assert.match(err.message, /TIMEOUT: Agent antwortet nicht innerhalb von 120ms/);
        return true;
      },
    );
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('AgentRuntime: Timeout-Fehler landet als TIMEOUT in der Task-History', async () => {
  const queue = new TaskQueue(':memory:');
  queue.enqueue(task({ target_role: 'dev' }));
  const runtime = new AgentRuntime({
    queue,
    roleId: 'dev',
    chat: async () => {
      const err = new Error('TIMEOUT: Agent antwortet nicht innerhalb von 60000ms');
      err.code = 'TIMEOUT';
      throw err;
    },
    logger: { error() {} },
  });
  const out = await runtime.tick();
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.task.error_history[0].code, 'TIMEOUT');
  assert.match(out.task.error_history[0].error, /TIMEOUT/);
  queue.close();
});
