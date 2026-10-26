#!/usr/bin/env node
'use strict';
// fire-team-task.js — Master-Task fuer 5-Agenten Todo-Team in die Queue.
// Aufruf: node scripts/fire-team-task.js [--db <pfad>]

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const TEAM_GOAL = {
  title: 'Baue eine Todo-Listen Web-App',
  payload: {
    goal:
      'Baue eine funktionierende Todo-App. Backend (Flask/FastAPI) mit REST-API. ' +
      'Frontend (HTML/JS) mit Fetch-API. Tests mit Pytest. README mit Setup-Anleitung. ' +
      'Alle Dateien im Ordner team_repo.',
    max_loops: 15,
  },
  target_role: 'boss_architect',
};

function defaultDb() {
  const appData = process.env.APPDATA || process.env.XDG_CONFIG_HOME || '';
  return process.env.ASTRA_QUEUE_DB || path.join(appData, 'harness-pro-desktop', 'astra-tasks.sqlite');
}

function buildTeamTask(overrides) {
  const opts = overrides || {};
  return {
    type: 'request',
    title: opts.title || TEAM_GOAL.title,
    schema_name: 'team_master_goal',
    payload: Object.assign({}, TEAM_GOAL.payload, opts.payload || {}),
    source_role: 'system',
    target_role: opts.target_role || TEAM_GOAL.target_role,
    request_id: opts.request_id || 'team-todo-' + Date.now(),
    timeout_ms: 600000,
    priority: 1,
  };
}

function enqueueTeamTask(options) {
  const opts = options || {};
  const { TaskQueue } = require(path.join(ROOT, 'taskqueue', 'taskqueue'));
  const queue = new TaskQueue(opts.dbFile ? path.resolve(opts.dbFile) : defaultDb());
  try {
    return queue.enqueue(buildTeamTask({
      target_role: opts.targetRole,
      request_id: opts.requestId,
    })).task;
  } finally {
    queue.close();
  }
}

function isAbiError(err) {
  const msg = String((err && err.message) || '');
  return (
    String(err && err.code) === 'ERR_DLOPEN_FAILED' ||
    /NODE_MODULE_VERSION|different Node\.js version/.test(msg)
  );
}

function reexecUnderElectron() {
  const binary = path.join(
    ROOT,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron',
  );
  if (!fs.existsSync(binary)) return false;
  const out = spawnSync(binary, [__filename].concat(args), {
    stdio: 'inherit',
    cwd: ROOT,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
  });
  return out.status === 0;
}

function run() {
  const dbFile = path.resolve(argValue('--db', defaultDb()));
  const task = enqueueTeamTask({ dbFile, requestId: argValue('--request-id', undefined) });
  console.log('[fire-team-task] queue: ' + dbFile);
  console.log('[fire-team-task] task-id: ' + task.id);
  console.log('[fire-team-task] target: ' + task.target_role);
  console.log('[fire-team-task] title: ' + task.title);
  return task;
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    if (isAbiError(err)) {
      console.log('[fire-team-task] ABI-Konflikt -> Electron-Node');
      if (reexecUnderElectron()) process.exit(0);
    }
    console.error('[fire-team-task] fehler: ' + ((err && err.message) || err));
    process.exit(1);
  }
}

module.exports = { TEAM_GOAL, buildTeamTask, enqueueTeamTask, defaultDb };
