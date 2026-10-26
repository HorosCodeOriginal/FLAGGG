'use strict';
// Tests des Synthesizer-Triggers im Orchestrator (DoD 1-4).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { Orchestrator } = require('../taskqueue/orchestrator');

function deskWith(subordinates) {
  return {
    schemaVersion: 3,
    keys: [],
    sessionTokens: 0,
    roles: [
      {
        id: 'boss',
        name: 'Boss',
        model: 'astra',
        status: 'active',
        keyId: 'key_astra_1',
        workspace: '',
        relationships: { superiors: [], subordinates: subordinates || ['dev'], peers: [] },
      },
      {
        id: 'dev',
        name: 'Dev',
        model: 'astra',
        status: 'active',
        keyId: 'key_astra_2',
        workspace: '',
        relationships: { superiors: ['boss'], subordinates: [], peers: [] },
      },
    ],
  };
}

function makeOrchestrator(queue, desk, extra) {
  const deskStore = { load: () => desk, save: () => {} };
  return new Orchestrator(Object.assign({
    deskStore,
    registryStore: { load: () => [{ nr: 1, port: 20129, unique_key: 'k1' }, { nr: 2, port: 20130, unique_key: 'k2' }] },
    queue,
    transport: async () => ({ result: { ok: true }, usage: null }),
    pollMs: 5,
    synthMs: 20,
    logger: { log() {}, error() {} },
  }, extra || {}));
}

async function doneChild(queue, roleId, parentRoleId, title, result) {
  const { task } = await queue.enqueue({
    type: 'request',
    title,
    schema_name: 's1',
    payload: { q: 1 },
    source_role: 'system',
    target_role: roleId,
    request_id: 'c-' + Math.random().toString(36).slice(2, 9),
    parent_id: parentRoleId,
  });
  await queue.claimNextTask(roleId);
  await queue.updateState(task.id, 'running', { message: 'test' });
  await queue.updateState(task.id, 'done', { result });
  return task.id;
}

test('startAll startet den Synthesizer-Timer (DoD 1)', () => {
  const queue = new TaskQueue(':memory:');
  const orchestrator = makeOrchestrator(queue, deskWith());
  assert.strictEqual(orchestrator.synthTimer, null);
  orchestrator.startAll();
  assert.ok(orchestrator.synthTimer, 'Timer muss nach startAll laufen');
  orchestrator.startSynthesizer(); // idempotent
  assert.ok(orchestrator.synthTimer);
  orchestrator.stopAll();
  queue.close();
});

test('Synthesizer laeuft periodisch und erzeugt Report-Tasks (DoD 2)', async () => {
  const queue = new TaskQueue(':memory:');
  await doneChild(queue, 'dev', 'boss', 'Job A', { ok: 1 });
  await doneChild(queue, 'dev', 'boss', 'Job B', { ok: 2 });

  const orchestrator = makeOrchestrator(queue, deskWith());
  orchestrator.startAll();

  // auf den Timer warten (synthMs = 20ms)
  let reports = [];
  for (let i = 0; i < 40 && reports.length === 0; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 25));
    reports = queue.listTasks({ type: 'report' });
  }

  assert.strictEqual(reports.length, 1, 'genau ein Report');
  assert.strictEqual(reports[0].target_role, 'boss');
  const payload = typeof reports[0].payload === 'string' ? JSON.parse(reports[0].payload) : reports[0].payload;
  assert.strictEqual(payload.total, 2);
  assert.strictEqual(payload.done, 2);

  orchestrator.stopAll();
  queue.close();
});

test('stopAll beendet den Timer sauber (DoD 3)', async () => {
  const queue = new TaskQueue(':memory:');
  let calls = 0;
  const deskStore = { load: () => deskWith(), save: () => {} };
  const orchestrator = new Orchestrator({
    deskStore,
    registryStore: { load: () => [{ nr: 1, port: 20129, unique_key: 'k1' }, { nr: 2, port: 20130, unique_key: 'k2' }] },
    queue: { claimNextTask: async () => null, synthesize: async () => { calls += 1; return null; } },
    transport: async () => ({ result: {}, usage: null }),
    pollMs: 5,
    synthMs: 20,
    logger: { log() {}, error() {} },
  });

  orchestrator.startAll();
  await new Promise(resolve => setTimeout(resolve, 60));
  const before = calls;
  orchestrator.stopAll();
  assert.strictEqual(orchestrator.synthTimer, null, 'Timer muss gestoppt sein');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.strictEqual(calls, before, 'nach stopAll keine weiteren Synthesen');
  queue.close();
});

test('Runtime bekommt den workspace der Rolle (DoD 4)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-orch-ws-'));
  const workspace = path.join(dir, 'role-ws');
  const desk = deskWith();
  desk.roles[1].workspace = workspace;

  const queue = new TaskQueue(':memory:');
  const orchestrator = makeOrchestrator(queue, desk);
  orchestrator.startAll();

  assert.ok(fs.existsSync(workspace), 'workspace-Verzeichnis muss angelegt werden');
  const runtime = orchestrator.runtimes.get('dev').runtime;
  assert.strictEqual(runtime.workspace, workspace);
  assert.ok(runtime.toolRunner, 'Runtime muss einen ToolRunner haben');

  orchestrator.stopAll();
  queue.close();
});
