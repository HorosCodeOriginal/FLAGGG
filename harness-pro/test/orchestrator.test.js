'use strict';
// Tests des Orchestrators: Boot, Rollen-Anlage mit Key-Zuweisung, Port-Routing,
// Live-Events in den Canvas.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Orchestrator, createRole } = require('../taskqueue/orchestrator');
const { TaskQueue } = require('../taskqueue/taskqueue');
const { TaskBroadcaster } = require('../lib/task-broadcast');
const TaskEvents = require('../js/task-events');

const REGISTRY = [
  { nr: 1, port: 20129, unique_key: 'vkd-astra-0001-aaaa', model_family: 'astra' },
  { nr: 2, port: 20130, unique_key: 'vkd-astra-0002-bbbb', model_family: 'astra' },
  { nr: 23, port: 20151, unique_key: 'vkd-opus-0023-cccc', model_family: 'opus' },
];

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-orch-'));
  return path.join(dir, 'tasks.sqlite');
}

function makeDeskStore(initial) {
  let desk = initial;
  return {
    load: () => desk,
    save: d => { desk = d; },
    get: () => desk,
  };
}

function makeOrchestrator(opts) {
  const o = opts || {};
  const deskStore = o.deskStore || makeDeskStore({ roles: [], keys: [], sessionTokens: 0 });
  const calls = [];
  const orchestrator = new Orchestrator({
    deskStore,
    registryStore: { load: () => REGISTRY },
    queue: o.queue,
    pollMs: 100000,
    logger: { log() {}, error() {} },
    transport: async args => {
      calls.push(args);
      return { result: { ok: true }, usage: { total_tokens: 7 } };
    },
  });
  return { orchestrator, deskStore, calls };
}

function sample(overrides) {
  return Object.assign({
    type: 'request',
    title: 'Test',
    schema_name: 's1',
    payload: { q: 1 },
    source_role: 'system',
    target_role: 'dev',
    request_id: 'req-' + Math.random().toString(36).slice(2, 8),
  }, overrides || {});
}

test('startAll startet Runtimes fuer alle aktiven Rollen', () => {
  const deskStore = makeDeskStore({
    roles: [
      { id: 'role_a', name: 'A', model: 'astra', keyId: 'key_astra_1', status: 'active' },
      { id: 'role_b', name: 'B', model: 'opus', keyId: 'key_opus_23', status: 'active' },
      { id: 'role_c', name: 'C', model: 'astra', status: 'paused' },
    ],
    keys: [], sessionTokens: 0,
  });
  const { orchestrator } = makeOrchestrator({ deskStore, queue: { claimNextTask: async () => null } });

  const out = orchestrator.startAll();
  assert.strictEqual(out.started, 2);
  assert.strictEqual(out.total, 2);
  assert.strictEqual(orchestrator.runtimes.size, 2);
  assert.strictEqual(orchestrator.runtimes.get('role_b').entry.port, 20151);
  orchestrator.stopAll();
  assert.strictEqual(orchestrator.runtimes.size, 0);
});

test('createRole schreibt die Rolle und weist einen freien Key zu', () => {
  const desk = { roles: [], keys: [], sessionTokens: 0 };
  const first = createRole(desk, REGISTRY, { name: 'Lead Developer', model: 'astra' });
  assert.strictEqual(first.role.id, 'role_lead_developer');
  assert.strictEqual(first.key.nr, 1);
  assert.strictEqual(first.key.port, 20129);
  assert.match(first.key.masked, /vkd-.+•••/);
  assert.strictEqual(desk.roles.length, 1);
  assert.strictEqual(desk.keys.length, 1);

  const second = createRole(desk, REGISTRY, { name: 'QA', model: 'astra' });
  assert.strictEqual(second.key.nr, 2, 'naechster freier key');

  const third = createRole(desk, REGISTRY, { name: 'Opus Bot', model: 'opus' });
  assert.strictEqual(third.key.nr, 23, 'opus bekommt einen opus-key');
});

test('resolveRole verhindert doppelte Zuweisung von Keys', () => {
  const desk = { roles: [], keys: [], sessionTokens: 0 };
  const a = createRole(desk, REGISTRY, { name: 'A', model: 'astra' });
  const b = createRole(desk, REGISTRY, { name: 'B', model: 'astra' });
  const deskStore = makeDeskStore(desk);
  const { orchestrator } = makeOrchestrator({ deskStore, queue: { claimNextTask: async () => null } });

  const r1 = orchestrator.resolveRole({ id: a.role.id, model: 'astra', keyId: a.role.keyId });
  const r2 = orchestrator.resolveRole({ id: b.role.id, model: 'astra', keyId: b.role.keyId });
  assert.strictEqual(r1.entry.port, 20129);
  assert.strictEqual(r2.entry.port, 20130);

  // fremde keyId wird nicht akzeptiert, fallback meidet belegte keys
  const r3 = orchestrator.resolveRole({ id: 'role_c', model: 'astra', keyId: a.role.keyId });
  assert.strictEqual(r3.entry.port, 20151, 'fallback auf unbenutzten opus-key statt doppelbelegung');
});

test('createRole verknuepft parentId (Legacy) als superiors-Kante', () => {
  const desk = { roles: [], keys: [], sessionTokens: 0 };
  const boss = createRole(desk, REGISTRY, { name: 'Boss', model: 'astra' });
  const dev = createRole(desk, REGISTRY, { name: 'Dev', model: 'astra', parentId: boss.role.id });
  assert.deepStrictEqual(dev.role.relationships.superiors, [boss.role.id]);
  assert.deepStrictEqual(desk.roles[0].relationships.subordinates, [dev.role.id]);
  assert.throws(() => createRole(desk, REGISTRY, { name: 'X', parentId: 'gibt-es-nicht' }), /unbekannte Rolle/);
});

test('createRole erlaubt mehrere Vorgesetzte und Peers', () => {
  const desk = { roles: [], keys: [], sessionTokens: 0 };
  const a = createRole(desk, REGISTRY, { name: 'A', model: 'astra' });
  const b = createRole(desk, REGISTRY, { name: 'B', model: 'astra' });
  const c = createRole(desk, REGISTRY, { name: 'C', model: 'astra', superiors: [a.role.id, b.role.id], peers: [] });
  const d = createRole(desk, REGISTRY, { name: 'D', model: 'astra', peers: [c.role.id] });

  assert.deepStrictEqual(c.role.relationships.superiors.sort(), [a.role.id, b.role.id].sort());
  assert.deepStrictEqual(desk.roles.find(r => r.id === a.role.id).relationships.subordinates, [c.role.id]);
  assert.deepStrictEqual(desk.roles.find(r => r.id === b.role.id).relationships.subordinates, [c.role.id]);
  assert.ok(d.role.relationships.peers.includes(c.role.id));
  assert.ok(desk.roles.find(r => r.id === c.role.id).relationships.peers.includes(d.role.id));
});

test('Task an eine Rolle wird an deren Port geroutet und verarbeitet', async () => {
  const queue = new TaskQueue(tmpDb());
  const deskStore = makeDeskStore({
    roles: [{ id: 'dev', name: 'Dev', model: 'astra', keyId: 'key_astra_1', status: 'active' }],
    keys: [], sessionTokens: 0,
  });
  const { orchestrator, calls } = makeOrchestrator({ deskStore, queue });

  // vor dem Start einreihen: der Orchestrator-Boot zieht den Task sofort
  const { task } = queue.enqueue(sample({ request_id: 'orch-1', target_role: 'dev' }));
  orchestrator.startAll();

  for (let i = 0; i < 40 && queue.getTask(task.id).state !== 'done'; i += 1) {
    await new Promise(r => setTimeout(r, 25));
  }

  assert.strictEqual(queue.getTask(task.id).state, 'done');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].entry.port, 20129, 'richtiger port der rolle');
  assert.strictEqual(calls[0].roleId, 'dev');
  assert.strictEqual(deskStore.get().roles[0].usage.tokens, 7, 'usage wird gebucht');
  assert.strictEqual(deskStore.get().sessionTokens, 7);
  orchestrator.stopAll();
  queue.close();
});

test('Live-Event erreicht den Canvas (running und failed markieren den Knoten)', async () => {
  const queue = new TaskQueue(tmpDb());
  const deskStore = makeDeskStore({
    roles: [{ id: 'dev', name: 'Dev', model: 'astra', keyId: 'key_astra_1', status: 'active' }],
    keys: [], sessionTokens: 0,
  });
  const { orchestrator } = makeOrchestrator({ deskStore, queue });

  const { task } = queue.enqueue(sample({ request_id: 'orch-2', target_role: 'dev' }));
  orchestrator.startAll();
  for (let i = 0; i < 40 && queue.getTask(task.id).state !== 'done'; i += 1) {
    await new Promise(r => setTimeout(r, 25));
  }

  const state = {};
  const sent = [];
  const bc = new TaskBroadcaster({ queue, send: (ch, p) => sent.push(p), intervalMs: 100000 });
  await bc.tick();
  sent.forEach(evt => TaskEvents.applyTaskEvent(state, evt));

  assert.ok(sent.some(e => e.toState === 'running'));
  assert.ok(sent.some(e => e.toState === 'done'));
  assert.strictEqual(TaskEvents.nodeStatus(state, 'dev'), 'done');
  assert.ok(state.taskTimeline.length <= TaskEvents.MAX_TIMELINE);

  // Fehlerfall: Knoten wird rot
  const failedTask = queue.enqueue(sample({ request_id: 'orch-3', target_role: 'dev' })).task;
  queue.claimNextTask('dev');
  queue.updateState(failedTask.id, 'running');
  queue.updateState(failedTask.id, 'failed', { error: 'kaputt' });
  const sent2 = [];
  const bc2 = new TaskBroadcaster({ queue, send: (ch, p) => sent2.push(p), intervalMs: 100000, startAfterId: bc.lastId });
  await bc2.tick();
  sent2.forEach(evt => TaskEvents.applyTaskEvent(state, evt));
  assert.strictEqual(TaskEvents.nodeStatus(state, 'dev'), 'failed');
  assert.strictEqual(TaskEvents.nodeClass(state, 'dev'), ' failed');

  orchestrator.stopAll();
  queue.close();
});
