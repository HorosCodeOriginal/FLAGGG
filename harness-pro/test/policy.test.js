'use strict';
// Tests der Graph-Berechtigungen (claim/enqueue) und der Runtime-Durchsetzung.

const test = require('node:test');
const assert = require('node:assert');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { createPolicy } = require('../taskqueue/policy');
const { AgentRuntime } = require('../taskqueue/runtime');

// bossA und bossB sind beide Vorgesetzte von dev; qa ist Peer von dev;
// outsider steht in keiner Beziehung.
function roles() {
  return [
    { id: 'bossA', name: 'A', relationships: { superiors: [], subordinates: ['dev'], peers: [] } },
    { id: 'bossB', name: 'B', relationships: { superiors: [], subordinates: ['dev'], peers: [] } },
    { id: 'dev', name: 'Dev', relationships: { superiors: ['bossA', 'bossB'], subordinates: [], peers: ['qa'] } },
    { id: 'qa', name: 'QA', relationships: { superiors: [], subordinates: [], peers: ['dev'] } },
    { id: 'outsider', name: 'X', relationships: { superiors: [], subordinates: [], peers: [] } },
  ];
}

function enqueue(queue, source, target, title) {
  return queue.enqueue({
    type: 'request',
    title: title || 'task',
    schema_name: 's1',
    request_id: 'req-' + Math.random().toString(36).slice(2, 10),
    description: '',
    source_role: source,
    target_role: target,
    payload: {},
  });
}

test('Policy: canSend/canReceive folgen dem Graph', () => {
  const policy = createPolicy(roles());
  assert.strictEqual(policy.canSend('system', 'dev'), true);
  assert.strictEqual(policy.canSend('bossA', 'dev'), true, 'Vorgesetzter darf an Untergebenen senden');
  assert.strictEqual(policy.canSend('dev', 'qa'), true, 'Peer darf an Peer senden');
  assert.strictEqual(policy.canSend('dev', 'bossA'), false, 'an Vorgesetzten nicht senden');
  assert.strictEqual(policy.canSend('outsider', 'dev'), false);
  assert.strictEqual(policy.canReceive('dev', 'bossA'), true);
  assert.strictEqual(policy.canReceive('dev', 'bossB'), true);
  assert.strictEqual(policy.canReceive('dev', 'qa'), true);
  assert.strictEqual(policy.canReceive('dev', 'outsider'), false);
  assert.strictEqual(policy.canReceive('dev', 'system'), true);
});

test('Ein Agent empfaengt Tasks von zwei Vorgesetzten (DoD 1)', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  await enqueue(queue, 'bossA', 'dev', 'von A');
  await enqueue(queue, 'bossB', 'dev', 'von B');

  const first = await queue.claimNextTask('dev');
  const second = await queue.claimNextTask('dev');
  assert.ok(first && second, 'dev muss beide Tasks bekommen');
  assert.deepStrictEqual([first.source_role, second.source_role].sort(), ['bossA', 'bossB']);
  queue.close();
});

test('Peer sendet an Peer, Peer nimmt an (DoD 2)', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  const created = await enqueue(queue, 'dev', 'qa', 'peer-task');
  assert.strictEqual(created.task.state, 'queued');
  const claimed = await queue.claimNextTask('qa');
  assert.ok(claimed, 'QA muss den Peer-Task claimen koennen');
  assert.strictEqual(claimed.source_role, 'dev');
  assert.strictEqual(claimed.target_role, 'qa');
  queue.close();
});

test('Unbeteiligter kann nicht senden: Task endet failed/UNAUTHORIZED (DoD 3)', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  const created = await enqueue(queue, 'outsider', 'dev', 'unerlaubt');
  assert.strictEqual(created.task.state, 'failed');
  const history = Array.isArray(created.task.error_history) ? created.task.error_history : JSON.parse(created.task.error_history || '[]');
  assert.strictEqual(history[0].code, 'UNAUTHORIZED');
  assert.strictEqual(await queue.claimNextTask('dev'), null, 'dev darf den Task nicht claimen');
  queue.close();
});

test('Claim lehnt unerlaubte Quelle ab (queued -> failed/UNAUTHORIZED)', async () => {
  const queue = new TaskQueue(':memory:'); // noch ohne Policy: Task kommt durch
  const created = await enqueue(queue, 'outsider', 'dev', 'durchgerutscht');
  assert.strictEqual(created.task.state, 'queued');
  queue.policy = createPolicy(roles());

  const claimed = await queue.claimNextTask('dev');
  assert.strictEqual(claimed, null);
  const task = await queue.getTask(created.task.id);
  assert.strictEqual(task.state, 'failed');
  const history = Array.isArray(task.error_history) ? task.error_history : JSON.parse(task.error_history);
  assert.strictEqual(history[0].code, 'UNAUTHORIZED');
  queue.close();
});

test('System-Tasks laufen ohne Beziehung', async () => {
  const queue = new TaskQueue(':memory:', { policy: createPolicy(roles()) });
  const created = await enqueue(queue, 'system', 'dev', 'system-task');
  assert.strictEqual(created.task.state, 'queued');
  const claimed = await queue.claimNextTask('dev');
  assert.ok(claimed);
  queue.close();
});

test('Runtime setzt die Policy beim Claim durch', async () => {
  const queue = new TaskQueue(':memory:');
  const created = await enqueue(queue, 'outsider', 'dev', 'runtime-deny');
  const runtime = new AgentRuntime({
    roleId: 'dev',
    queue,
    chat: async () => ({ content: 'x', usage: {} }),
    policy: { canReceive: () => false },
    pollMs: 5,
  });
  const result = await runtime.tick();
  assert.ok(result && result.ok === false);
  const task = await queue.getTask(created.task.id);
  assert.strictEqual(task.state, 'failed');
  const history = Array.isArray(task.error_history) ? task.error_history : JSON.parse(task.error_history);
  assert.strictEqual(history[0].code, 'UNAUTHORIZED');
  queue.close();
});
