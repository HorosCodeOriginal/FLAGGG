'use strict';
// install_skill / list_skills / uninstall_skill mit Fake-fetch.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { ToolRunner, isPrivateOrLocalHost } = require('../lib/tool-runner');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-install-'));
}

function makeResponse({ status = 200, headers = {}, text } = {}) {
  const payload = Buffer.from(text === undefined ? '' : String(text), 'utf8');
  const hdr = Object.assign({}, headers);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = Object.keys(hdr).find((k) => k.toLowerCase() === String(name).toLowerCase());
        return key === undefined ? null : hdr[key];
      },
    },
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

test('install_skill laedt Bundle, registriert Tool, list/uninstall', async () => {
  const ws = workspace();
  const body = echoBundle();
  const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  const fetch = async () => makeResponse({ text: body });
  const runner = new ToolRunner(ws, { fetch, loadSkills: false });

  const installed = await runner.execute('install_skill', {
    url: 'https://example.com/echo-bundle.json',
    sha256: digest,
  });
  assert.strictEqual(installed.ok, true);
  assert.strictEqual(installed.id, 'echo-helpers');
  assert.ok(installed.tools.indexOf('echo_upper') >= 0);

  const listed = await runner.execute('list_skills', {});
  assert.strictEqual(listed.length, 1);

  const out = await runner.execute('echo_upper', { text: 'flaggg' });
  assert.strictEqual(out.text, 'FLAGGG');
  assert.strictEqual(fs.readFileSync(path.join(ws, 'echo-out.txt'), 'utf8'), 'FLAGGG');

  await runner.execute('uninstall_skill', { id: 'echo-helpers' });
  assert.strictEqual((await runner.execute('list_skills', {})).length, 0);
  await assert.rejects(runner.execute('echo_upper', { text: 'x' }), /unbekanntes Tool/);
});

test('install_skill: sha256 mismatch wird abgelehnt', async () => {
  const ws = workspace();
  const body = echoBundle();
  const fetch = async () => makeResponse({ text: body });
  const runner = new ToolRunner(ws, { fetch, loadSkills: false });
  await assert.rejects(
    runner.execute('install_skill', {
      url: 'https://example.com/echo-bundle.json',
      sha256: '0'.repeat(64),
    }),
    /sha256 mismatch/,
  );
});

test('SSRF: private/localhost URLs werden blockiert', async () => {
  assert.strictEqual(isPrivateOrLocalHost('127.0.0.1'), true);
  assert.strictEqual(isPrivateOrLocalHost('169.254.169.254'), true);
  assert.strictEqual(isPrivateOrLocalHost('10.0.0.1'), true);
  assert.strictEqual(isPrivateOrLocalHost('192.168.1.1'), true);
  assert.strictEqual(isPrivateOrLocalHost('example.com'), false);

  const ws = workspace();
  const runner = new ToolRunner(ws, {
    fetch: async () => makeResponse({ text: 'nope' }),
    loadSkills: false,
  });
  await assert.rejects(
    runner.execute('web_fetch', { url: 'http://127.0.0.1/secret' }),
    /nicht erlaubt/,
  );
  await assert.rejects(
    runner.execute('download_file', { url: 'http://169.254.169.254/latest', path: 'x.bin' }),
    /nicht erlaubt/,
  );
  await assert.rejects(
    runner.execute('install_skill', { url: 'http://localhost/skill.json' }),
    /nicht erlaubt/,
  );
});

test('SSRF: Redirect auf private IP wird blockiert', async () => {
  const ws = workspace();
  let calls = 0;
  const fetch = async (url) => {
    calls += 1;
    if (calls === 1) {
      return makeResponse({
        status: 302,
        headers: { location: 'http://127.0.0.1/evil' },
        text: '',
      });
    }
    return makeResponse({ text: 'should-not-fetch' });
  };
  const runner = new ToolRunner(ws, { fetch, loadSkills: false });
  await assert.rejects(
    runner.execute('web_fetch', { url: 'https://example.com/redir' }),
    /nicht erlaubt/,
  );
  assert.strictEqual(calls, 1);
});
