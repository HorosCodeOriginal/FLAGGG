#!/usr/bin/env node
'use strict';
// run-live-test.js — Live-Test mit zwei Agenten (Boss Astra, Sub Opus).
// Ablauf:
//   1. seed-live-test.js ausführen (desk.json + Workspaces)
//   2. fire-test-task.js ausführen (Task in die SQLite-Queue)
//   3. Orchestrator + AgentRuntimes starten
//   4. FSM-Verlauf pollen und finalen Status ausgeben
//   5. Prüfen, ob hallo.py im Workspace von sub_opus existiert
//
// Erwarteter FSM-Verlauf des Parent-Tasks:
//   queued -> claimed -> running -> waiting_on_child -> queued -> claimed -> running -> done
//
// better-sqlite3 ist gegen die Electron-ABI gebaut: das Skript startet sich
// deshalb selbst mit ELECTRON_RUN_AS_NODE neu.

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const DEFAULT_DB = path.join(process.env.APPDATA || '', 'harness-pro-desktop', 'astra-tasks.sqlite');
const DB_FILE = path.resolve(argValue('--db', DEFAULT_DB));
const DESK_FILE = path.join(ROOT, 'data', 'desk.json');
const SYNTH_MS = Number(argValue('--synth-ms', '10000'));
const TIMEOUT_MS = Number(argValue('--timeout', '120000'));
const POLL_MS = Number(argValue('--poll-ms', '2000'));

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
    cwd: ROOT,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
  });
  return out.status === 0;
}

function parseTaskId(output) {
  const match = String(output || '').match(/task-id:\s*([^\s]+)/);
  return match ? match[1] : null;
}

function removePreviousHallo(workspacePath) {
  const hallo = path.join(workspacePath, 'hallo.py');
  if (fs.existsSync(hallo)) {
    fs.unlinkSync(hallo);
  }
}

function run() {
  const { TaskQueue, TaskValidationError } = require(path.join(ROOT, 'taskqueue', 'taskqueue'));
  const { Orchestrator, FAMILY_MODEL } = require(path.join(ROOT, 'taskqueue', 'orchestrator'));
  const { createPolicy } = require(path.join(ROOT, 'taskqueue', 'policy'));

  const deskStore = {
    load: () => JSON.parse(fs.readFileSync(DESK_FILE, 'utf8')),
    save: desk => fs.writeFileSync(DESK_FILE, JSON.stringify(desk, null, 2) + '\n', 'utf8'),
  };
  const registryStore = {
    load: () => [
      { nr: 1, port: 20129, unique_key: 'vkd-astra-0001-aaaa', model_family: 'astra' },
      { nr: 24, port: 20152, unique_key: 'vkd-opus-0024-dddd', model_family: 'opus' },
    ],
  };
  const queue = new TaskQueue(DB_FILE);
  const desk = deskStore.load();
  const policy = createPolicy(() => (deskStore.load() || {}).roles || []);
  const subWorkspace = path.resolve(ROOT, 'workspaces', 'sub_opus');

  console.log('[run-live] db: ' + DB_FILE);
  console.log('[run-live] desk: ' + DESK_FILE);
  console.log('[run-live] synthMs: ' + SYNTH_MS);
  console.log('[run-live] rollen: ' + desk.roles.map(r => r.id).join(', '));
  console.log('');

  removePreviousHallo(subWorkspace);

  const pipeRounds = new Map();
  const chat = async ({ roleId, task }) => {
    const ctx = task || {};

    if (roleId === 'boss_astra') {
      const children = Array.isArray(ctx.child_results) ? ctx.child_results : [];
      if (children.length) {
        return {
          result: {
            ok: true,
            message: 'Delegation an sub_opus abgeschlossen.',
            child_results: children,
          },
          usage: { total_tokens: 4 },
        };
      }
      return {
        result: {
          tool: 'delegate',
          args: {
            role: 'sub_opus',
            title: 'Hallo-Welt generieren',
            payload: { instruction: 'Erstelle hallo.py mit print("Hallo") und führe sie aus.' },
          },
        },
        usage: { total_tokens: 3 },
      };
    }

    if (roleId === 'sub_opus') {
      const rounds = pipeRounds.get(roleId) || 0;
      pipeRounds.set(roleId, rounds + 1);

      if (rounds === 0) {
        return {
          result: {
            tool: 'write_file',
            args: { path: 'hallo.py', content: 'print("Hallo")\n' },
          },
          usage: { total_tokens: 2 },
        };
      }
      if (rounds === 1) {
        return {
          result: {
            tool: 'execute_shell',
            args: { command: 'python hallo.py' },
          },
          usage: { total_tokens: 2 },
        };
      }
      return {
        result: {
          ok: true,
          message: 'Hallo-Welt in hallo.py erstellt und ausgeführt.',
          output: 'Hallo',
        },
        usage: { total_tokens: 9 },
      };
    }

    throw new Error('unbekannte Rolle: ' + roleId);
  };

  const orchestrator = new Orchestrator({
    deskStore,
    registryStore,
    queue,
    transport: chat,
    pollMs: 100,
    synthMs: SYNTH_MS,
    maxConcurrent: 1,
    logger: { log: () => {}, error: () => {} },
  });

  console.log('[run-live] orchestrierung startet');
  orchestrator.startAll();

  const fire = spawn(process.execPath, [path.join(__dirname, 'fire-test-task.js'), '--db', DB_FILE], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let fires = '';
  fire.stdout.on('data', data => { fires += String(data); });
  fire.stderr.on('data', data => { fires += String(data); });

  const start = Date.now();
  let parentId = null;
  let lastState = '';

  function printState(task) {
    const current = task && task.state ? task.state : 'unbekannt';
    if (current !== lastState) {
      console.log('[run-live] state: ' + current);
      lastState = current;
    }
  }

  function finish(task) {
    const exists = fs.existsSync(path.join(subWorkspace, 'hallo.py'));
    console.log('[run-live] finaler status: ' + task.state);
    console.log('[run-live] hallo.py: ' + (exists ? 'VORHANDEN' : 'FEHLT') + ' (' + path.join(subWorkspace, 'hallo.py') + ')');
    if (exists) {
      console.log('[run-live] hallo.py inhalt:');
      console.log(fs.readFileSync(path.join(subWorkspace, 'hallo.py'), 'utf8').trim());
    }
    if (task.state === 'done' && exists) {
      console.log('DONE: Task completed successfully');
    } else {
      console.log('FAILED: live-test nicht erfolgreich');
    }
    try { orchestrator.stopAll(); } catch (e) { /* egal */ }
    try { queue.close(); } catch (e) { /* egal */ }
    process.exit(task.state === 'done' && exists ? 0 : 1);
  }

  fire.on('close', code => {
    if (code !== 0) {
      console.error(fires.trim());
      console.error('[run-live] fire-test-task fehlgeschlagen: ' + code);
      try { orchestrator.stopAll(); } catch (e) { /* egal */ }
      try { queue.close(); } catch (e) { /* egal */ }
      process.exit(1);
    }
    console.log(fires.trim());
    parentId = parseTaskId(fires);
    if (!parentId) {
      console.error('[run-live] task-id aus fire-ausgabe nicht lesbar');
      try { orchestrator.stopAll(); } catch (e) { /* egal */ }
      try { queue.close(); } catch (e) { /* egal */ }
      process.exit(1);
    }
    printState({ state: 'queued' });
  });

  const timer = setInterval(() => {
    if (!parentId) {
      if (Date.now() - start >= 5000) {
        clearInterval(timer);
        console.error('[run-live] fire-test-task hat keine task-id geliefert');
        try { orchestrator.stopAll(); } catch (e) { /* egal */ }
        try { queue.close(); } catch (e) { /* egal */ }
        process.exit(1);
      }
      return;
    }

    let task;
    try {
      task = queue.getTask(parentId);
    } catch (err) {
      console.error('[run-live] poll-fehler: ' + err.message);
      return;
    }
    if (!task) {
      console.error('[run-live] parent-task nicht gefunden: ' + parentId);
      clearInterval(timer);
      try { orchestrator.stopAll(); } catch (e) { /* egal */ }
      try { queue.close(); } catch (e) { /* egal */ }
      process.exit(1);
    }

    printState(task);

    if (task.terminal) {
      clearInterval(timer);
      finish(task);
    } else if (Date.now() - start >= TIMEOUT_MS) {
      clearInterval(timer);
      console.error('[run-live] TIMEOUT nach ' + TIMEOUT_MS + 'ms');
      finish(task);
    }
  }, POLL_MS);
}

try {
  run();
} catch (err) {
  if (isAbiError(err)) {
    console.log('[run-live] better-sqlite3 ABI-Konflikt -> starte mit Electron-Node neu');
    if (reexecUnderElectron()) process.exit(0);
  }
  console.error('[run-live] fehler: ' + ((err && err.message) || err));
  process.exit(1);
}
