'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');

const { InMemoryKV } = require('./index');

test('set/get roundtrip', () => {
  const kv = new InMemoryKV();
  kv.set('a', 1);
  kv.set('b', 'x');
  assert.equal(kv.get('a'), 1);
  assert.equal(kv.get('b'), 'x');
  assert.equal(kv.get('missing'), undefined);
  assert.equal(kv.size(), 2);
});

test('del löscht Eintrag und meldet, ob vorhanden', () => {
  const kv = new InMemoryKV();
  kv.set('a', 1);
  assert.equal(kv.del('a'), true);
  assert.equal(kv.get('a'), undefined);
  assert.equal(kv.del('a'), false);
  assert.equal(kv.size(), 0);
});

test('TTL-Ablauf: get -> undefined und Event expired gefeuert', async () => {
  const kv = new InMemoryKV();
  const expired = [];
  kv.on('expired', (key) => expired.push(key));

  kv.set('tmp', 42, 50);
  assert.equal(kv.get('tmp'), 42);

  await sleep(80);

  assert.equal(kv.get('tmp'), undefined);
  assert.deepEqual(expired, ['tmp']);
});

test('mehrere Keys', () => {
  const kv = new InMemoryKV();
  kv.set('a', 1);
  kv.set('b', 2);
  kv.set('c', 3);
  assert.equal(kv.size(), 3);
  assert.equal(kv.get('a'), 1);
  assert.equal(kv.get('b'), 2);
  assert.equal(kv.get('c'), 3);
});

test('size nach Ablauf', async () => {
  const kv = new InMemoryKV();
  kv.set('short', 1, 50);
  kv.set('long', 2, 1000);
  assert.equal(kv.size(), 2);

  await sleep(80);

  assert.equal(kv.get('short'), undefined);
  assert.equal(kv.get('long'), 2);
  assert.equal(kv.size(), 1);
});
