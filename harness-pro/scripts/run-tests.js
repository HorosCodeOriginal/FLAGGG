'use strict';
// run-tests.js — startet die node:test-Suite unter Electron-as-Node.
// Grund: better-sqlite3 ist für die Electron-ABI gebaut (Node 20.18),
// das System-Node (24) kann das Binary nicht laden.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');

let electronPath;
try {
  electronPath = require('electron');
} catch (err) {
  console.error('electron nicht installiert:', err.message);
  process.exit(1);
}

const files = fs.readdirSync(testDir)
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => path.join('test', name));

const result = spawnSync(electronPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
});

if (result.error) {
  console.error('testlauf fehlgeschlagen:', result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
