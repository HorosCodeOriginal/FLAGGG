#!/usr/bin/env node
'use strict';
// run-team-test-live.js — 5-Agenten Team-Test gegen die ECHTE Kette
// (fr-gateway -> FlagshipRouter -> Groq). Nutzt createRoleChat als Transport.
// Aufruf: node scripts/run-team-test-live.js [--timeout 900000]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_FILE = path.resolve(ROOT, '..', 'fr-gateway', 'secrets', 'registry.json');
const TEAM_REPO = path.join(ROOT, 'workspaces', 'team_repo_live');
const ARTIFACTS = ['app.py', 'index.html', 'test_app.py', 'README.md'];

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const TIMEOUT_MS = Number(argValue('--timeout', '900000'));
const DB_FILE = path.join(os.tmpdir(), 'astra-team-live-' + Date.now() + '.sqlite');

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
if (process.env.ELECTRON_RUN_AS_NODE !== '1' && reexecUnderElectron()) process.exit(0);

function loadRegistry() {
  const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  return raw
    .filter((e) => e && e.state === 'running' && e.port && e.unique_key)
    .map((e) => ({
      nr: e.nr,
      port: e.port,
      unique_key: e.unique_key,
      model_family: e.model_family || 'astra',
    }));
}

function pythonCommand() {
  for (const cand of ['python', 'py', 'python3']) {
    const r = spawnSync(cand, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cand;
  }
  return null;
}

function removeIfExists(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (_) {}
}

function runPytest() {
  const py = pythonCommand();
  if (!py) return { ok: false, reason: 'kein Python' };
  const cmd = process.platform === 'win32'
    ? 'set PYTHONPATH=vendor&& ' + py + ' -m pytest -q test_app.py'
    : 'PYTHONPATH=vendor ' + py + ' -m pytest -q test_app.py';
  const out = spawnSync(cmd, { cwd: TEAM_REPO, shell: true, encoding: 'utf8', timeout: 120000 });
  return { ok: out.status === 0, stdout: out.stdout, stderr: out.stderr, status: out.status };
}

async function run() {
  const { TaskQueue } = require(path.join(ROOT, 'taskqueue', 'taskqueue'));
  const { Orchestrator } = require(path.join(ROOT, 'taskqueue', 'orchestrator'));
  const { createPolicy } = require(path.join(ROOT, 'taskqueue', 'policy'));
  const { enqueueTeamTask } = require(path.join(ROOT, 'scripts', 'fire-team-task'));
  const { createRoleChat } = require(path.join(ROOT, 'lib', 'role-chat'));
  const { buildDesk } = require(path.join(ROOT, 'scripts', 'seed-team-5.js'));

  const { desk } = buildDesk();
  const deskStore = { load: () => desk, save: () => {}, mutate: (fn) => { fn(desk); return desk; } };
  const registry = loadRegistry();
  console.log('[live] registry: ' + registry.length + ' laufende Gateways');
  console.log('[live] beispiel: port ' + registry[0].port + ' nr ' + registry[0].nr);

  removeIfExists(TEAM_REPO);
  removeIfExists(DB_FILE); removeIfExists(DB_FILE + '-wal'); removeIfExists(DB_FILE + '-shm');
  fs.mkdirSync(TEAM_REPO, { recursive: true });

  const policy = createPolicy(() => desk.roles);
  const queue = new TaskQueue(DB_FILE, { policy });
  const master = enqueueTeamTask({ dbFile: DB_FILE, requestId: 'team-live-' + Date.now() });
  console.log('[live] master: ' + master.id + ' | ' + master.title);

  const orchestrator = new Orchestrator({
    deskStore,
    registryStore: { load: () => registry },
    queue,
    policy,
    transport: createRoleChat({ timeoutMs: 120000 }),
    pollMs: 200,
    synthMs: 3000,
    maxConcurrent: 3,
    logger: { log: (msg) => console.log('[orch] ' + msg), error: (msg) => console.error('[live][runtime] ' + msg) },
  });

  console.log('[live] orchestrator start (maxConcurrent=3, synthMs=3000)');
  orchestrator.startAll();
  setTimeout(() => { try { console.log('[live] status: ' + JSON.stringify(orchestrator.status())); } catch (_) {} }, 8000);

  const deadline = Date.now() + TIMEOUT_MS;
  let lastState = '';
  while (Date.now() < deadline) {
    const t = queue.getTask(master.id);
    if (t && t.state !== lastState) {
      lastState = t.state;
      console.log('[live] master state: ' + t.state + ' (nach ' + Math.round((Date.now() - (deadline - TIMEOUT_MS)) / 1000) + 's)');
    }
    if (t && (t.state === 'done' || t.state === 'failed' || t.state === 'escalated')) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const final = queue.getTask(master.id) || {};
  const children = queue.listChildren(master.id);
  console.log('\n[live] ENDZUSTAND master=' + final.state);
  children.forEach((c) => console.log('  - "' + c.title + '" -> ' + c.state + ' (' + c.target_role + ')'));
  const events = queue.events(master.id).slice(-10);
  console.log('[live] letzte events: ' + events.map((e) => e.message || e.to_state).join(' | '));

  const filesOk = ARTIFACTS.every((f) => fs.existsSync(path.join(TEAM_REPO, f)));
  console.log('[live] Dateien: ' + (filesOk ? 'OK' : 'FEHLEN') + ' (' + ARTIFACTS.filter((f) => fs.existsSync(path.join(TEAM_REPO, f))).join(',') + ')');
  const pytest = filesOk ? runPytest() : { ok: false, reason: 'dateien fehlen' };
  console.log('[live] pytest: ' + (pytest.ok ? 'GRUEN' : 'ROT/kein') + (pytest.stderr ? ' | stderr: ' + String(pytest.stderr).split('\n').slice(-4).join(' / ') : ''));

  try { orchestrator.stopAll(); } catch (_) {}
  try { queue.close(); } catch (_) {}
  process.exit(final.state === 'done' && filesOk && pytest.ok ? 0 : 1);
}

run().catch((e) => { console.error('[live] fatal: ' + (e && e.stack || e)); process.exit(2); });
