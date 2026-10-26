#!/usr/bin/env node
'use strict';
// run-team-test.js — E2E 5-Agenten Todo-Team (deterministischer Transport).
// Aufruf: node scripts/run-team-test.js [--timeout 600000] [--keep] [--db <pfad>] [--write-desk]

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

const TIMEOUT_MS = Number(argValue('--timeout', '600000'));
const KEEP = args.includes('--keep');
const WRITE_DESK = args.includes('--write-desk');
const DB_FILE = path.resolve(
  argValue('--db', path.join(os.tmpdir(), 'astra-team-test-' + Date.now() + '.sqlite')),
);

const TEAM_REPO = path.join(ROOT, 'workspaces', 'team_repo');
const ARTIFACTS = ['app.py', 'index.html', 'test_app.py', 'README.md'];

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

function removeIfExists(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
}

function loadDesk() {
  const { buildDesk } = require(path.join(ROOT, 'scripts', 'seed-team-5.js'));
  if (WRITE_DESK) {
    require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-team-5.js')], {
      stdio: 'inherit',
      cwd: ROOT,
    });
  }
  const { desk, migrated } = buildDesk();
  if (migrated) console.log('[team-test] desk migriert');
  return desk;
}

function registryStub() {
  return [
    { nr: 1, port: 20129, unique_key: 'vkd-astra-0001-aaaa', model_family: 'astra' },
    { nr: 2, port: 20130, unique_key: 'vkd-astra-0002-bbbb', model_family: 'astra' },
    { nr: 3, port: 20131, unique_key: 'vkd-astra-0003-cccc', model_family: 'astra' },
    { nr: 24, port: 20152, unique_key: 'vkd-opus-0024-dddd', model_family: 'opus' },
    { nr: 25, port: 20153, unique_key: 'vkd-opus-0025-eeee', model_family: 'opus' },
  ];
}

function runPytest(teamRepo) {
  const { pythonCommand } = require(path.join(ROOT, 'lib', 'team-5-scenario'));
  const py = pythonCommand();
  if (!py) return { ok: false, reason: 'kein Python' };
  const cmd = process.platform === 'win32'
    ? 'set PYTHONPATH=vendor&& ' + py + ' -m pytest -q test_app.py'
    : 'PYTHONPATH=vendor ' + py + ' -m pytest -q test_app.py';
  const out = spawnSync(cmd, {
    cwd: teamRepo,
    shell: true,
    encoding: 'utf8',
    timeout: 120000,
  });
  return { ok: out.status === 0, stdout: out.stdout, stderr: out.stderr, status: out.status };
}

function run() {
  const { TaskQueue } = require(path.join(ROOT, 'taskqueue', 'taskqueue'));
  const { Orchestrator } = require(path.join(ROOT, 'taskqueue', 'orchestrator'));
  const { createPolicy } = require(path.join(ROOT, 'taskqueue', 'policy'));
  const { enqueueTeamTask } = require(path.join(ROOT, 'scripts', 'fire-team-task'));
  const { team5Transport } = require(path.join(ROOT, 'lib', 'team-5-scenario'));

  const desk = loadDesk();
  const deskStore = {
    load: () => desk,
    save: () => {},
    mutate: (fn) => {
      fn(desk);
      return desk;
    },
  };

  fs.mkdirSync(TEAM_REPO, { recursive: true });
  removeIfExists(DB_FILE);
  removeIfExists(DB_FILE + '-wal');
  removeIfExists(DB_FILE + '-shm');
  ARTIFACTS.forEach((f) => removeIfExists(path.join(TEAM_REPO, f)));
  removeIfExists(path.join(TEAM_REPO, 'vendor'));

  const policy = createPolicy(() => desk.roles);
  const queue = new TaskQueue(DB_FILE, { policy });

  console.log('[team-test] db: ' + DB_FILE);
  console.log('[team-test] workspace: ' + TEAM_REPO);
  console.log('[team-test] rollen: ' + desk.roles.length);

  const master = enqueueTeamTask({
    dbFile: DB_FILE,
    requestId: 'team-master-' + Date.now(),
  });
  console.log('[team-test] master: ' + master.id + ' | ' + master.title);

  const orchestrator = new Orchestrator({
    deskStore,
    registryStore: { load: registryStub },
    queue,
    policy,
    transport: team5Transport({ onEvent: (msg) => console.log(msg) }),
    pollMs: 100,
    synthMs: 5000,
    maxConcurrent: 3,
    logger: { log: () => {}, error: (msg) => console.error('[team-test][runtime] ' + msg) },
  });

  let finished = false;

  function dumpTasks() {
    const children = queue.listChildren(master.id);
    console.log('[team-test] kinder (' + children.length + '):');
    children.forEach((c) => {
      console.log('  - "' + c.title + '" -> ' + c.state + ' (' + c.target_role + ')');
    });
    const events = queue.events(master.id).slice(-8);
    console.log('[team-test] letzte master-events: ' + events.map((e) => e.message || e.to_state).join(' | '));
  }

  function verify(task) {
    dumpTasks();
    const children = queue.listChildren(master.id);
    const delegatedRoles = new Set(children.map((c) => c.target_role));
    const expectedRoles = ['dev_backend', 'dev_frontend', 'qa_tester', 'doc_writer'];
    const filesOk = ARTIFACTS.every((f) => fs.existsSync(path.join(TEAM_REPO, f)));
    const pytest = filesOk ? runPytest(TEAM_REPO) : { ok: false, reason: 'dateien fehlen' };
    const qaFail = children.some((c) => c.title === 'QA Pytest' && c.state === 'failed');
    const fixDone = children.some((c) => c.title === 'Backend-Fix QA' && c.state === 'done');

    const checks = [
      ['master done', task.state === 'done'],
      ['delegation an dev_backend', delegatedRoles.has('dev_backend')],
      ['delegation an dev_frontend', delegatedRoles.has('dev_frontend')],
      ['delegation an qa_tester', delegatedRoles.has('qa_tester')],
      ['delegation an doc_writer', delegatedRoles.has('doc_writer')],
      ['alle 4 spezialisten angesprochen', expectedRoles.every((r) => delegatedRoles.has(r))],
      ['QA-Fail + Backend-Fix (Self-Heal)', qaFail && fixDone],
      ['app.py index.html test_app.py README.md', filesOk],
      ['pytest gruen', pytest.ok],
    ];

    checks.forEach(([name, ok]) => console.log('[team-test] ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name));
    if (!pytest.ok && pytest.stderr) {
      console.log('[team-test] pytest stderr: ' + String(pytest.stderr).split('\n').slice(-5).join(' / '));
    }
    const allOk = checks.every(([, ok]) => ok);
    console.log(allOk ? 'DONE: 5-Agenten Team-Test erfolgreich' : 'FAILED: Team-Test nicht bestanden');
    return allOk;
  }

  function shutdown(code) {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    if (code !== 0) dumpTasks();
    try {
      orchestrator.stopAll();
    } catch (_) { /* ignore */ }
    try {
      queue.close();
    } catch (_) { /* ignore */ }
    if (!KEEP) {
      removeIfExists(DB_FILE);
      removeIfExists(DB_FILE + '-wal');
      removeIfExists(DB_FILE + '-shm');
    }
    setTimeout(() => process.exit(code), 50);
  }

  const start = Date.now();
  let lastState = '';
  const timer = setInterval(() => {
    let task;
    try {
      task = queue.getTask(master.id);
    } catch (err) {
      console.error('[team-test] poll: ' + err.message);
      return;
    }
    if (!task) return shutdown(1);
    if (task.state !== lastState) {
      console.log('[team-test] master state: ' + task.state);
      lastState = task.state;
    }
    if (task.state === 'done') return shutdown(verify(task) ? 0 : 1);
    if (task.state === 'failed' || task.state === 'escalated') {
      console.error('[team-test] master failed: ' + JSON.stringify(task.error_history || []).slice(0, 400));
      return shutdown(1);
    }
    if (Date.now() - start > TIMEOUT_MS) {
      console.error('[team-test] TIMEOUT ' + TIMEOUT_MS + 'ms');
      return shutdown(1);
    }
  }, 300);

  console.log('[team-test] orchestrator start (maxConcurrent=3, synthMs=5000)');
  orchestrator.startAll();
}

try {
  run();
} catch (err) {
  if (isAbiError(err)) {
    console.log('[team-test] ABI-Konflikt -> Electron-Node');
    if (reexecUnderElectron()) process.exit(0);
  }
  console.error('[team-test] fehler: ' + ((err && err.message) || err));
  process.exit(1);
}
