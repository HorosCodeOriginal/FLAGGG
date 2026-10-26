'use strict';
// Tests für den Queue-Supervisor: Neustart mit Backoff, Kandidatenrotation, 'down'.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { QueueClient, nodeCandidates } = require('../taskqueue/client');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = { write: () => true };
  child.kill = () => {};
  return child;
}

function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('Worker-Crash startet den Worker neu und endet nach maxRestarts in down', async () => {
  const statuses = [];
  let spawns = 0;
  const client = new QueueClient(':memory:', {
    candidates: [{ label: 'a', cmd: 'a', env: {} }, { label: 'b', cmd: 'b', env: {} }],
    backoffMs: [5, 5, 5],
    maxRestarts: 2,
    logger: { error() {} },
    spawnFn: () => {
      spawns += 1;
      const child = fakeChild();
      setImmediate(() => child.emit('exit', 1));
      return child;
    },
  });
  client.onStatus(status => statuses.push(status.state));

  client.start();
  await waitFor(() => client.state === 'down', 2000);

  assert.strictEqual(spawns, 3, 'start + 2 Neustarts');
  assert.deepStrictEqual(statuses, ['starting', 'restarting', 'starting', 'restarting', 'starting', 'down']);
  assert.strictEqual(client.restarts, 3);
});

test('nach zwei Fehlversuchen rotiert der Kandidat', async () => {
  const used = [];
  const client = new QueueClient(':memory:', {
    candidates: [{ label: 'a', cmd: 'a', env: {} }, { label: 'b', cmd: 'b', env: {} }],
    backoffMs: [5],
    maxRestarts: 4,
    logger: { error() {} },
    spawnFn: (cmd) => {
      used.push(cmd);
      const child = fakeChild();
      setImmediate(() => child.emit('exit', 1));
      return child;
    },
  });
  client.start();
  // auf den dritten Spawn warten (restarts wird schon beim exit inkrementiert,
  // der naechste Spawn laeuft erst nach dem Backoff)
  await waitFor(() => used.length >= 3, 3000);
  assert.deepStrictEqual(used.slice(0, 3), ['a', 'a', 'b']);
  client.close();
});

test('down lehnt neue Aufrufe sofort ab', async () => {
  const client = new QueueClient(':memory:', {
    candidates: [{ label: 'a', cmd: 'a', env: {} }],
    backoffMs: [5],
    maxRestarts: 1,
    logger: { error() {} },
    spawnFn: () => {
      const child = fakeChild();
      setImmediate(() => child.emit('exit', 1));
      return child;
    },
  });
  client.start();
  await waitFor(() => client.state === 'down', 2000);
  await assert.rejects(client.countByState(), /down/);
});

test('nodeCandidates nutzt process.execPath mit ELECTRON_RUN_AS_NODE', () => {
  const list = nodeCandidates({});
  assert.strictEqual(list[0].cmd, process.execPath);
  assert.strictEqual(list[0].env.ELECTRON_RUN_AS_NODE, '1');
  assert.ok(list.some(c => c.label === 'node'));
  assert.strictEqual(list[0].label, 'electron');
});

test('ASTRA_NODE_BIN ueberschreibt die Kandidatenliste', () => {
  const list = nodeCandidates({ ASTRA_NODE_BIN: 'C:/custom/node.exe' });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].cmd, 'C:/custom/node.exe');
});
