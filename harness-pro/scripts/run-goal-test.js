#!/usr/bin/env node
'use strict';
// run-goal-test.js — End-to-End-Nachweis des Self-Healing-Loops.
//
// Ablauf (echte Queue, echte Runtime, echter ToolRunner, deterministische
// Agenten-Antworten aus lib/self-heal-script.js):
//   1. Desk (boss_astra -> sub_opus) und temp. SQLite-Queue aufsetzen
//   2. Master-Goal via scripts/seed-goal.js in die Queue werfen
//   3. Orchestrator + AgentRuntimes starten
//   4. Boss delegiert "Scraper schreiben" an den Sub
//   5. Sub schreibt scraper.py (requests + bs4) und scheitert beim Ausfuehren
//      am fehlenden Modul -> Runtime persistiert stderr in error_history
//   6. Boss empfaengt child_results + self_heal-Prompt, delegiert Fix-Task
//   7. Sub installiert requests/beautifulsoup4 per pip und scrapt HN
//   8. Boss markiert den Master-Task done; hn_titles.json wird geprueft
//
// Aufruf: node scripts/run-goal-test.js [--timeout 300000] [--keep] [--db <pfad>]
// better-sqlite3 ist gegen die Electron-ABI gebaut -> Reexec unter Electron-Node.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const TIMEOUT_MS = Number(argValue('--timeout', '300000'));
const KEEP = args.includes('--keep');
const DB_FILE = path.resolve(argValue('--db', path.join(os.tmpdir(), 'astra-goal-test-' + Date.now() + '.sqlite')));

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

function removeIfExists(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) { /* egal */ }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function makeDesk() {
  return {
    schemaVersion: 3,
    sessionTokens: 0,
    failover: { enabled: false },
    spaces: [],
    keys: [
      { id: 'key_astra_1', provider: 'astra', status: 'assigned', assignedToRole: 'boss_astra', nr: 1, port: 20129, masked: '••••••••••' },
      { id: 'key_opus_24', provider: 'opus', status: 'assigned', assignedToRole: 'sub_opus', nr: 24, port: 20152, masked: '••••••••••' },
    ],
    roles: [
      {
        id: 'boss_astra',
        name: 'Boss Astra',
        model: 'astra',
        keyId: 'key_astra_1',
        workspace: path.join(ROOT, 'workspaces', 'boss_astra'),
        relationships: { superiors: [], subordinates: ['sub_opus'], peers: [] },
        tokenBudget: { maxPerTask: 8000, maxPerHour: 50000 },
        status: 'active',
        permissions: { read: [], write: [] },
        usage: { tokens: 0, updatedAt: null },
        profile: { mandate: 'Self-Healing-Boss: analysiert stderr und delegiert Fix-Tasks', skills: ['delegation', 'root-cause'] },
      },
      {
        id: 'sub_opus',
        name: 'Sub Opus',
        model: 'opus',
        keyId: 'key_opus_24',
        workspace: path.join(ROOT, 'workspaces', 'sub_opus'),
        relationships: { superiors: ['boss_astra'], subordinates: [], peers: [] },
        tokenBudget: { maxPerTask: 8000, maxPerHour: 50000 },
        status: 'active',
        permissions: { read: [], write: [] },
        usage: { tokens: 0, updatedAt: null },
        profile: { mandate: 'Self-Healing-Sub: schreibt Python, installiert fehlende Pakete', skills: ['tooling', 'python'] },
      },
    ],
  };
}

function run() {
  const { TaskQueue } = require(path.join(ROOT, 'taskqueue', 'taskqueue'));
  const { Orchestrator } = require(path.join(ROOT, 'taskqueue', 'orchestrator'));
  const { createPolicy } = require(path.join(ROOT, 'taskqueue', 'policy'));
  const { enqueueGoal } = require(path.join(ROOT, 'scripts', 'seed-goal'));
  const { selfHealTransport } = require(path.join(ROOT, 'lib', 'self-heal-script'));

  const desk = makeDesk();
  const deskStore = { load: () => desk, save: () => {}, mutate: fn => { fn(desk); return desk; } };
  const registryStore = {
    load: () => [
      { nr: 1, port: 20129, unique_key: 'vkd-astra-0001-aaaa', model_family: 'astra' },
      { nr: 24, port: 20152, unique_key: 'vkd-opus-0024-dddd', model_family: 'opus' },
    ],
  };
  const bossWs = path.join(ROOT, 'workspaces', 'boss_astra');
  const subWs = path.join(ROOT, 'workspaces', 'sub_opus');
  fs.mkdirSync(bossWs, { recursive: true });
  fs.mkdirSync(subWs, { recursive: true });

  // Sauberer Ausgangszustand: alte Artefakte des letzten Laufs entfernen
  removeIfExists(DB_FILE);
  removeIfExists(DB_FILE + '-wal');
  removeIfExists(DB_FILE + '-shm');
  removeIfExists(path.join(subWs, 'scraper.py'));
  removeIfExists(path.join(subWs, 'hn_titles.json'));
  removeIfExists(path.join(subWs, 'vendor'));

  const policy = createPolicy(() => desk.roles);
  const queue = new TaskQueue(DB_FILE, { policy });

  console.log('[goal-test] db: ' + DB_FILE);
  console.log('[goal-test] workspaces: ' + bossWs + ' | ' + subWs);
  console.log('[goal-test] timeout: ' + TIMEOUT_MS + 'ms');

  const master = enqueueGoal({ dbFile: DB_FILE, targetRole: 'boss_astra', requestId: 'master-goal-e2e-' + Date.now() });
  console.log('[goal-test] master-task: ' + master.id + ' (' + master.title + ')');

  const orchestrator = new Orchestrator({
    deskStore,
    registryStore,
    queue,
    policy,
    transport: selfHealTransport({ onEvent: msg => console.log(msg) }),
    pollMs: 100,
    synthMs: 3600000,
    maxConcurrent: 2,
    logger: { log: () => {}, error: msg => console.error('[goal-test][runtime] ' + msg) },
  });

  let finished = false;
  function dumpChildren() {
    try {
      const children = queue.listChildren(master.id);
      console.log('[goal-test] DEBUG kinder: ' + children.length);
      children.forEach(c => {
        console.log('[goal-test] DEBUG   "' + c.title + '" -> ' + c.state +
          ' | history=' + JSON.stringify((c.error_history || []).slice(0, 2)).slice(0, 900));
      });
    } catch (e) {
      console.error('[goal-test] DEBUG fehler: ' + e.message);
    }
  }
  function shutdown(exitCode) {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    if (exitCode !== 0) dumpChildren();
    try { orchestrator.stopAll(); } catch (e) { /* egal */ }
    try { queue.close(); } catch (e) { /* egal */ }
    if (!KEEP) {
      removeIfExists(DB_FILE);
      removeIfExists(DB_FILE + '-wal');
      removeIfExists(DB_FILE + '-shm');
    }
    process.exitCode = exitCode;
    // Electron-as-Node braucht einen expliziten Exit, damit Timer nicht haengen
    setTimeout(() => process.exit(exitCode), 50);
  }

  function verify(task) {
    const children = queue.listChildren(master.id);
    console.log('[goal-test] kinder: ' + children.length);
    children.forEach(c => {
      const history = Array.isArray(c.error_history) ? c.error_history : [];
      const first = history[0] || {};
      console.log('[goal-test]   - "' + c.title + '" -> ' + c.state +
        (first.stderr ? ' | stderr: ' + String(first.stderr).split('\n').slice(-3).join(' / ').slice(0, 160) : ''));
    });

    const failedChild = children.find(c => c.state === 'failed' || c.state === 'escalated');
    const fixChild = children.find(c => /reparieren/i.test(String(c.title)) &&
      c.state === 'done');
    const failedStderr = failedChild && Array.isArray(failedChild.error_history)
      ? String((failedChild.error_history[0] || {}).stderr || '')
      : '';
    const titlesFile = path.join(subWs, 'hn_titles.json');
    const titles = readJson(titlesFile);
    const validTitles = Array.isArray(titles) ? titles.filter(t => typeof t === 'string' && t.trim()) : [];

    const checks = [
      ['master-task done', task.state === 'done'],
      ['mindestens 1 fehlgeschlagenes Kind mit ModuleNotFoundError', !!failedChild &&
        /ModuleNotFoundError/.test(failedStderr) && /No module named 'requests'/.test(failedStderr)],
      ['fix-task "Scraper reparieren" done (pip install)', !!fixChild],
      ['hn_titles.json existiert', fs.existsSync(titlesFile)],
      ['hn_titles.json enthaelt >= 10 Titel', validTitles.length >= 10],
    ];

    console.log('[goal-test] FSM master: ' + queue.events(master.id).map(e => e.from_state + '>' + e.to_state).join(' | '));
    if (validTitles.length) {
      console.log('[goal-test] hn_titles.json: ' + validTitles.length + ' titel, z.B. ' + JSON.stringify(validTitles.slice(0, 3)));
    }
    checks.forEach(([name, ok]) => console.log('[goal-test] ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name));

    const allOk = checks.every(([, ok]) => ok);
    console.log(allOk ? 'DONE: Self-Healing-Loop erfolgreich (hn_titles.json geschrieben)' : 'FAILED: Self-Healing-Loop nicht erfolgreich');
    return allOk;
  }

  const start = Date.now();
  let lastState = '';
  const timer = setInterval(() => {
    let task;
    try {
      task = queue.getTask(master.id);
    } catch (err) {
      console.error('[goal-test] poll-fehler: ' + err.message);
      return;
    }
    if (!task) {
      console.error('[goal-test] master-task nicht gefunden');
      return shutdown(1);
    }
    if (task.state !== lastState) {
      console.log('[goal-test] state: ' + task.state);
      lastState = task.state;
    }
    if (task.state === 'done') return shutdown(verify(task) ? 0 : 1);
    if (task.state === 'failed' || task.state === 'escalated') {
      console.error('[goal-test] master-task endete mit ' + task.state +
        ' | history: ' + JSON.stringify((task.error_history || []).slice(0, 2)).slice(0, 500));
      return shutdown(1);
    }
    if (Date.now() - start > TIMEOUT_MS) {
      console.error('[goal-test] TIMEOUT nach ' + TIMEOUT_MS + 'ms (state=' + task.state + ')');
      return shutdown(1);
    }
  }, 250);

  console.log('[goal-test] orchestrierung startet');
  orchestrator.startAll();
}

try {
  run();
} catch (err) {
  if (isAbiError(err)) {
    console.log('[goal-test] better-sqlite3 ABI-Konflikt -> starte mit Electron-Node neu');
    if (reexecUnderElectron()) process.exit(0);
  }
  console.error('[goal-test] fehler: ' + ((err && err.message) || err));
  process.exit(1);
}
