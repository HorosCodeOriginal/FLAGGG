#!/usr/bin/env node
'use strict';
// fire-test-task.js — legt den Live-Test-Task in die SQLite-Queue.
// Aufruf:  node scripts/fire-test-task.js
// Optionen: --db <pfad>  --target <roleId>
//
// better-sqlite3 ist gegen die Electron-ABI gebaut: unter dem System-Node wirft
// das Oeffnen der DB ERR_DLOPEN_FAILED. Dann startet sich das Skript selbst mit
// ELECTRON_RUN_AS_NODE neu (gleiche Argumente).

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function defaultDb() {
  const appData = process.env.APPDATA || process.env.XDG_CONFIG_HOME || '';
  return process.env.ASTRA_QUEUE_DB || path.join(appData, 'harness-pro-desktop', 'astra-tasks.sqlite');
}

function isAbiError(err) {
  const msg = String((err && err.message) || '');
  return String(err && err.code) === 'ERR_DLOPEN_FAILED' ||
    /NODE_MODULE_VERSION|different Node\.js version/.test(msg);
}

function reexecUnderElectron() {
  const binary = path.join(ROOT, 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron');
  if (!fs.existsSync(binary)) return false;
  const out = spawnSync(binary, [__filename].concat(args), {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
  });
  return out.status === 0;
}

function run() {
  const { TaskQueue } = require(path.join(ROOT, 'taskqueue', 'taskqueue'));
  const dbFile = path.resolve(argValue('--db', defaultDb()));
  const target = argValue('--target', 'boss_astra');
  const instruction = 'Schreibe ein Python-Skript hallo.py, das "Hallo" ausgibt, und führe es aus.';
  const requestId = 'live-' + Date.now();

  const queue = new TaskQueue(dbFile);
  try {
    const { task } = queue.enqueue({
      type: 'request',
      title: 'Hallo-Welt generieren',
      schema_name: 'live_test',
      payload: { instruction },
      source_role: 'system',
      target_role: target,
      timeout_ms: 60000,
      request_id: requestId,
    });
    console.log('[fire] queue: ' + dbFile);
    console.log('[fire] task-id: ' + task.id);
    console.log('[fire] request-id: ' + requestId);
    console.log('[fire] target: ' + target);
  } finally {
    queue.close();
  }
}

try {
  run();
} catch (err) {
  if (isAbiError(err)) {
    console.log('[fire] better-sqlite3 passt nicht zum System-Node -> starte mit Electron-Node neu');
    if (reexecUnderElectron()) process.exit(0);
  }
  console.error('[fire] fehler: ' + ((err && err.message) || err));
  process.exit(1);
}
