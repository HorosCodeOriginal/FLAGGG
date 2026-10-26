'use strict';
// Tests für den DeskWriter: Serialisierung, Atomarität, keine verlorenen Updates.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDeskWriter } = require('../lib/desk-writer');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-desk-'));
  return path.join(dir, 'desk.json');
}

test('parallele mutate-Aufrufe gehen nicht verloren', async () => {
  const file = tmpFile();
  const writer = createDeskWriter({ file });
  fs.writeFileSync(file, JSON.stringify({ sessionTokens: 0, roles: [] }));

  await Promise.all(Array.from({ length: 25 }, () => writer.mutate(desk => {
    desk.sessionTokens = (Number(desk.sessionTokens) || 0) + 1;
  })));

  const final = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(final.sessionTokens, 25, 'jede Mutation muss zaehlen');
});

test('save schreibt atomar (keine .tmp-Reste)', async () => {
  const file = tmpFile();
  const writer = createDeskWriter({ file });
  await writer.save({ schemaVersion: 2, roles: [{ id: 'a' }] });

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(data.schemaVersion, 2);
  const leftovers = fs.readdirSync(path.dirname(file)).filter(n => n.indexOf('.tmp.') >= 0);
  assert.deepStrictEqual(leftovers, []);
});

test('mutate sieht immer den zuletzt geschriebenen Stand', async () => {
  const file = tmpFile();
  const writer = createDeskWriter({ file });
  await writer.save({ values: [] });

  await Promise.all([1, 2, 3, 4].map(n => writer.mutate(desk => {
    desk.values = (desk.values || []).concat(n);
  })));

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(data.values.slice().sort(), [1, 2, 3, 4]);
});

test('load liefert {} bei kaputter Datei', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ kaputt');
  const writer = createDeskWriter({ file, logger: { error() {} } });
  assert.deepStrictEqual(writer.load(), {});
});
