'use strict';
// Tests des ToolRunner: Workspace-Grenze, Dateien, Shell.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ToolRunner } = require('../lib/tool-runner');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-ws-'));
}

test('write_file und read_file arbeiten im Workspace', async () => {
  const runner = new ToolRunner(workspace());
  const written = await runner.run('write_file', { path: 'src/a.txt', content: 'hallo' });
  assert.strictEqual(written.path, path.join('src', 'a.txt'));
  assert.strictEqual(written.bytes, 5);
  const content = await runner.run('read_file', { path: 'src/a.txt' });
  assert.strictEqual(content, 'hallo');
});

test('Pfad-Traversal wird blockiert', async () => {
  const runner = new ToolRunner(workspace());
  await assert.rejects(runner.run('read_file', { path: '../aussen.txt' }), /ausserhalb des Workspace/);
  await assert.rejects(runner.run('write_file', { path: '../../evil.txt', content: 'x' }), /ausserhalb des Workspace/);
  await assert.rejects(runner.run('read_file', { path: path.join(os.tmpdir(), 'irgendwo.txt') }), /ausserhalb des Workspace/);
});

test('execute_shell laeuft im Workspace', async () => {
  const runner = new ToolRunner(workspace());
  await runner.run('write_file', { path: 'marker.txt', content: 'x' });
  const out = await runner.run('execute_shell', {
    command: process.platform === 'win32' ? 'dir /b' : 'ls',
  });
  assert.match(out.stdout, /marker\.txt/);
  assert.strictEqual(out.exitCode, 0);
});

test('unbekanntes Tool wirft', async () => {
  const runner = new ToolRunner(workspace());
  await assert.rejects(runner.execute('rm_rf', {}), /unbekanntes Tool/);
});
