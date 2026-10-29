'use strict';
// Skill-E2E: install -> tool call -> uninstall -> Registry + Disk leer;
// zweiter ToolRunner laedt nur noch installierte Skills.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { ToolRunner } = require('../lib/tool-runner');
const { skillDir } = require('../lib/skill-sandbox');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-skill-e2e-'));
}

function makeResponse(text) {
  const payload = Buffer.from(String(text), 'utf8');
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    async text() {
      return payload.toString('utf8');
    },
    async arrayBuffer() {
      return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    },
  };
}

function echoBundle() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'skills', 'echo-bundle.json'),
    'utf8',
  );
}

test('Skill-E2E: install -> echo_upper -> uninstall -> Registry und Disk leer', async () => {
  const ws = workspace();
  const body = echoBundle();
  const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const fetch = async () => makeResponse(body);
  const runner = new ToolRunner(ws, { fetch, loadSkills: false });

  const installed = await runner.execute('install_skill', {
    url: 'https://example.com/echo-bundle.json',
    sha256: digest,
  });
  assert.strictEqual(installed.ok, true);
  assert.strictEqual(installed.id, 'echo-helpers');
  assert.ok(fs.existsSync(path.join(skillDir(ws, 'echo-helpers'), 'skill.json')));
  assert.ok(fs.existsSync(path.join(skillDir(ws, 'echo-helpers'), 'index.js')));

  // Fresh runner muss Skill von Disk laden
  const reloaded = new ToolRunner(ws, { fetch, loadSkills: true });
  assert.strictEqual(reloaded.list_skills().length, 1);
  const out = await reloaded.execute('echo_upper', { text: 'e2e' });
  assert.strictEqual(out.text, 'E2E');
  assert.strictEqual(fs.readFileSync(path.join(ws, 'echo-out.txt'), 'utf8'), 'E2E');

  await reloaded.execute('uninstall_skill', { id: 'echo-helpers' });
  assert.strictEqual(reloaded.list_skills().length, 0);
  assert.ok(!fs.existsSync(skillDir(ws, 'echo-helpers')));
  await assert.rejects(reloaded.execute('echo_upper', { text: 'x' }), /unbekanntes Tool/);

  // Dritter Runner sieht nichts mehr
  const after = new ToolRunner(ws, { fetch, loadSkills: true });
  assert.strictEqual(after.list_skills().length, 0);
  await assert.rejects(after.execute('echo_upper', { text: 'y' }), /unbekanntes Tool/);
});

test('Skill-E2E: install ohne sha256 funktioniert; falsche id wird abgelehnt', async () => {
  const ws = workspace();
  const body = echoBundle();
  const fetch = async () => makeResponse(body);
  const runner = new ToolRunner(ws, { fetch, loadSkills: false });

  const ok = await runner.execute('install_skill', { url: 'https://example.com/echo-bundle.json' });
  assert.strictEqual(ok.id, 'echo-helpers');

  await assert.rejects(
    runner.execute('install_skill', {
      url: 'https://example.com/echo-bundle.json',
      id: 'other-id',
    }),
    /id-Argument/,
  );
});
