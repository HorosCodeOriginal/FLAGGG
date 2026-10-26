'use strict';
// Race-/CAS-Tests: updateState, Child-before-wait, parallele Synthese.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskQueue, TaskValidationError } = require('../taskqueue/taskqueue');
const { AgentRuntime } = require('../taskqueue/runtime');
const { createPolicy } = require('../taskqueue/policy');
const { synthesize } = require('../taskqueue/synthesizer');

function roles() {
  return [
    { id: 'boss', relationships: { superiors: [], subordinates: ['sub'], peers: [] } },
    { id: 'sub', relationships: { superiors: ['boss'], subordinates: [], peers: [] } },
  ];
}

test('updateState CAS: veralteter Snapshot scheitert (TOCTOU)', () => {
  const q = new TaskQueue(':memory:');
  const { task } = q.enqueue({
    type: 'request',
    title: 't',
    schema_name: 's',
    payload: {},
    source_role: 'system',
    target_role: 'dev',
    request_id: 'cas-1',
  });
  q.claimNextTask('dev');
  q.updateState(task.id, 'running');

  const stale = q.getTask(task.id);
  assert.strictEqual(stale.state, 'running');
  // Parallel-Writer: State unter dem Snapshot wegziehen
  q.db.prepare(
    "UPDATE tasks SET state = 'done', result = ?, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify({ ok: true }), new Date().toISOString(), task.id);

  const realGet = q.getTask.bind(q);
  q.getTask = (id) => {
    q.getTask = realGet;
    return stale; // absichtlich veraltet
  };
  assert.throws(
    () => q.updateState(task.id, 'failed', { error: 'zu spaet' }),
    (err) => err instanceof TaskValidationError && /state-Konflikt|CAS/.test(err.message),
  );
  assert.strictEqual(q.getTask(task.id).state, 'done');
  q.close();
});

test('delegate: Parent waiting_on_child bevor Kind claimbar — kein Stuck wenn Kind sofort fertig', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-del-'));
  const { task: parent } = queue.enqueue({
    type: 'request',
    title: 'Boss-Job',
    schema_name: 's',
    payload: {},
    source_role: 'system',
    target_role: 'boss',
    request_id: 'race-del-1',
  });

  const boss = new AgentRuntime({
    roleId: 'boss',
    queue,
    workspace: ws,
    pollMs: 5,
    policy: createPolicy(roles()),
    chat: async () => ({
      result: {
        tool: 'delegate',
        args: { role: 'sub', title: 'schnell', payload: { x: 1 } },
      },
    }),
  });

  const first = await boss.tick();
  assert.ok(first.delegated);
  const afterDeleg = queue.getTask(parent.id);
  assert.ok(
    afterDeleg.state === 'waiting_on_child' || afterDeleg.state === 'queued',
    'Parent muss waiting oder (Kind schon fertig) queued sein, war: ' + afterDeleg.state,
  );

  const children = queue.listChildren(parent.id);
  assert.strictEqual(children.length, 1);

  // Kind sofort erledigen bevor/obwohl Parent wartet
  const child = children[0];
  queue.claimNextTask('sub');
  queue.updateState(child.id, 'running');
  queue.updateState(child.id, 'done', { result: { ok: true } });
  queue.checkChildrenStatus(parent.id);

  const woke = queue.getTask(parent.id);
  assert.strictEqual(woke.state, 'queued', 'Parent darf nicht in waiting_on_child stecken bleiben');
  queue.close();
});

test('parallele synthesize: nur ein Report, CAS markSynthesized', async () => {
  const queue = new TaskQueue(':memory:');
  const { task: c1 } = queue.enqueue({
    type: 'request',
    title: 'A',
    schema_name: 's',
    payload: {},
    source_role: 'system',
    target_role: 'dev1',
    request_id: 'synth-race-a',
    parent_id: 'boss',
  });
  queue.claimNextTask('dev1');
  queue.updateState(c1.id, 'running');
  queue.updateState(c1.id, 'done', { result: { a: 1 } });

  const results = await Promise.all([
    synthesize(queue, 'boss'),
    synthesize(queue, 'boss'),
  ]);
  const reports = results.filter(Boolean);
  assert.strictEqual(reports.length, 1, 'genau ein Synthese-Report');
  assert.strictEqual(await synthesize(queue, 'boss'), null);
  queue.close();
});
