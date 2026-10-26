#!/usr/bin/env node
'use strict';
// seed-goal.js — legt den Master-Goal-Task (Self-Healing-Scraper) in die SQLite-Queue.
// Aufruf:  node scripts/seed-goal.js
// Optionen: --db <pfad>  --target <roleId>  --request-id <id>
//
// better-sqlite3 ist gegen die Electron-ABI gebaut: unter dem System-Node wirft
// das Oeffnen der DB ERR_DLOPEN_FAILED. Dann startet sich das Skript selbst mit
// ELECTRON_RUN_AS_NODE neu (gleiche Argumente).
//
// Wird das Modul per require() geladen (E2E-Test), passiert nichts ausser dem
// Export der Helfer; insbesondere kein require('better-sqlite3') auf Top-Level.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const GOAL = {
  title: 'Baue einen funktionierenden Python-Web-Scraper',
  payload: {
    goal: 'Schreibe scraper.py, das die Titel der Hacker News Startseite (https://news.ycombinator.com) extrahiert und in hn_titles.json speichert. Führe es aus. Wenn es Fehler gibt (z.B. fehlendes Modul), behebe sie autonom.',
    max_loops: 10,
  },
  target_role: 'boss_astra',
};

function defaultDb() {
  const appData = process.env.APPDATA || process.env.XDG_CONFIG_HOME || '';
  return process.env.ASTRA_QUEUE_DB || path.join(appData, 'harness-pro-desktop', 'astra-tasks.sqlite');
}

function buildGoalTask(overrides) {
  const opts = overrides || {};
  return {
    type: 'request',
    title: opts.title || GOAL.title,
    schema_name: 'master_goal',
    payload: Object.assign({}, GOAL.payload, opts.payload || {}),
    source_role: 'system',
    target_role: opts.target_role || GOAL.target_role,
    request_id: opts.request_id || 'master-goal-' + Date.now(),
    // lange Self-Healing-Laeufe duerfen nicht vom Watchdog gekillt werden
    timeout_ms: 300000,
    priority: 1,
  };
}

function enqueueGoal(options) {
  const opts = options || {};
  // Lazy require: better-sqlite3 laedt nur unter der Electron-ABI bzw. in der Funktion.
  const { TaskQueue } = require(path.join(ROOT, 'taskqueue', 'taskqueue'));
  const queue = new TaskQueue(opts.dbFile ? path.resolve(opts.dbFile) : defaultDb());
  try {
    const { task } = queue.enqueue(buildGoalTask({
      target_role: opts.targetRole,
      request_id: opts.requestId,
    }));
    return task;
  } finally {
    queue.close();
  }
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
  const dbFile = path.resolve(argValue('--db', defaultDb()));
  const targetRole = argValue('--target', GOAL.target_role);
  const requestId = argValue('--request-id', undefined);
  const task = enqueueGoal({ dbFile, targetRole, requestId });

  console.log('[seed-goal] queue: ' + dbFile);
  console.log('[seed-goal] task-id: ' + task.id);
  console.log('[seed-goal] request-id: ' + task.request_id);
  console.log('[seed-goal] target: ' + task.target_role);
  console.log('[seed-goal] title: ' + task.title);
  return task;
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    if (isAbiError(err)) {
      console.log('[seed-goal] better-sqlite3 passt nicht zum System-Node -> starte mit Electron-Node neu');
      if (reexecUnderElectron()) process.exit(0);
    }
    console.error('[seed-goal] fehler: ' + ((err && err.message) || err));
    process.exit(1);
  }
}

module.exports = { GOAL, buildGoalTask, enqueueGoal, defaultDb };
