'use strict';
// Regressionstest fuer die Client-Normalisierung: der Worker verpackt Antworten,
// der Client muss dieselbe API wie TaskQueue liefern (task statt {task}).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { QueueClient } = require('../taskqueue/client');

test('QueueClient liefert Task-Objekte (kein {task}-Wrapper)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-client-'));
  const client = new QueueClient(path.join(dir, 'tasks.sqlite'));
  try {
    const created = await client.enqueue({
      type: 'request', title: 'Test', schema_name: 's1', payload: { x: 1 },
      source_role: 'boss', target_role: 'dev', request_id: 'client-1',
    });
    assert.strictEqual(created.duplicate, false);
    assert.ok(created.task.id);

    const claimed = await client.claimNextTask('dev');
    assert.ok(claimed && claimed.id, 'claim liefert den Task direkt');
    assert.strictEqual(claimed.state, 'claimed');
    assert.strictEqual(claimed.claimed_by, 'dev');

    const running = await client.updateState(claimed.id, 'running');
    assert.strictEqual(running.state, 'running');

    const done = await client.updateState(claimed.id, 'done', { result: { ok: true } });
    assert.strictEqual(done.state, 'done');

    const events = await client.eventsSince(0, 50);
    assert.ok(Array.isArray(events));
    assert.deepStrictEqual(events.map(e => e.toState), ['queued', 'claimed', 'running', 'done']);

    const stats = await client.countByState();
    assert.ok(Array.isArray(stats));
  } finally {
    client.close();
    await new Promise(r => setTimeout(r, 300));
  }
});
