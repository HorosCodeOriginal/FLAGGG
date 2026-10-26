'use strict';
// Regression: mutate(fn) darf das mutierte Objekt schreiben, auch wenn fn
// einen booleschen Status zurueckgibt (trackUsage macht genau das).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDeskWriter } = require('../lib/desk-writer');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-desk-mutate-'));
  return path.join(dir, 'desk.json');
}

test('mutate schreibt das Objekt, nicht den Rueckgabewert von fn', async () => {
  const file = tmpFile();
  const writer = createDeskWriter({ file });
  fs.writeFileSync(file, JSON.stringify({ roles: [{ id: 'boss' }], sessionTokens: 0 }));

  await writer.mutate(desk => {
    desk.sessionTokens = 5;
    return true; // wie Orchestrator.trackUsage
  });

  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(written.sessionTokens, 5);
  assert.deepStrictEqual(written.roles, [{ id: 'boss' }]);
});

test('mutate akzeptiert ein zurueckgegebenes Objekt als Ersatz', async () => {
  const file = tmpFile();
  const writer = createDeskWriter({ file });
  fs.writeFileSync(file, JSON.stringify({ roles: [], sessionTokens: 1 }));

  await writer.mutate(() => ({ roles: [{ id: 'x' }], sessionTokens: 2 }));
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(written.roles, [{ id: 'x' }]);
  assert.strictEqual(written.sessionTokens, 2);
});
