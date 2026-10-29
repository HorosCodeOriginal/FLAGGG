// integration.test.mjs — MiniVault Integrationstests (Agent C, Tests & Integration)
// Läuft mit: node --test integration.test.mjs
// Startet den echten Backend-Server (harness-pro/teamwork/server.js) mit PORT=9871,
// prüft die JSON-API gegen den laufenden Server und führt eine statische
// Frontend-Integrationsprüfung (astra-harness/teamwork) durch.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Pfade & Konstanten ----------
const SERVER_JS = 'C:\\Users\\Administrator\\Downloads\\FLAGGG\\harness-pro\\teamwork\\server.js';
const FRONTEND_DIR = 'C:\\Users\\Administrator\\Downloads\\FLAGGG\\astra-harness\\teamwork';
const PORT = 9871;
const BASE = `http://127.0.0.1:${PORT}`;
const HEALTH_TIMEOUT_MS = 5000;

// Blockierung: Backend-Server von Agent A fehlt → genaue Fehlermeldung, Exit 1.
if (!fs.existsSync(SERVER_JS)) {
  console.error(`[integration] BLOCKIERT: Backend-Server existiert nicht: ${SERVER_JS}`);
  console.error('[integration] Erwartet von Agent A (harness-pro/teamwork/server.js).');
  process.exit(1);
}

// ---------- Server-Lifecycle ----------
let proc = null;
let serverLogs = '';
let teamVaultId = null;

function startServer() {
  serverLogs = '';
  proc = spawn(process.execPath, [SERVER_JS], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { serverLogs += d; });
  proc.stderr.on('data', (d) => { serverLogs += d; });
}

async function waitForHealth(timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.status === 200) return;
      lastErr = new Error(`/healthz lieferte Status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Server nicht bereit innerhalb ${timeoutMs}ms (letzter Fehler: ${lastErr?.message})\n` +
    `Server-Logs:\n${serverLogs || '(keine Ausgabe)'}`
  );
}

function stopServer() {
  if (!proc || proc.exitCode !== null) return;
  try { proc.kill('SIGTERM'); } catch { /* bereits beendet */ }
}

before(async () => {
  startServer();
  try {
    await waitForHealth();
  } catch (err) {
    stopServer();
    throw err;
  }
});

after(() => {
  if (!proc || proc.exitCode !== null) return;
  stopServer();
  // Zuverlässig beenden: kurz warten, sonst hartes Kill.
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* bereits beendet */ }
      resolve();
    }, 1500);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
  });
});

// ---------- Helfer ----------
async function api(method, urlPath, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${urlPath}`, opts);
  let json = null;
  try { json = await res.json(); } catch { /* kein JSON */ }
  return { status: res.status, json };
}

// ---------- API-Integrationstests (gegen echten Server) ----------
test('GET /healthz → 200', async () => {
  const { status } = await api('GET', '/healthz');
  assert.equal(status, 200);
});

test('POST /api/vaults {name:"Team"} → 201, hat id', async () => {
  const { status, json } = await api('POST', '/api/vaults', { name: 'Team' });
  assert.equal(status, 201);
  assert.ok(json && typeof json.id === 'string' && json.id.length > 0, 'Antwort muss id enthalten');
  assert.equal(json.name, 'Team');
  teamVaultId = json.id;
});

test('GET /api/vaults → enthält "Team"', async () => {
  const { status, json } = await api('GET', '/api/vaults');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.vaults), 'Antwort enthält vaults-Array');
  const names = json.vaults.map((v) => v.name);
  assert.ok(names.includes('Team'), `"Team" fehlt in Vault-Liste: ${JSON.stringify(names)}`);
});

test('POST /api/vaults/{id}/entries {title:"Login",username:"u",secret:"s"} → 201', async () => {
  const { status, json } = await api('POST', `/api/vaults/${teamVaultId}/entries`, {
    title: 'Login', username: 'u', secret: 's',
  });
  assert.equal(status, 201);
  assert.equal(json.title, 'Login');
  assert.equal(json.username, 'u');
  assert.equal(json.secret, 's');
});

test('GET /api/vaults/{id} → Eintrag vorhanden, secret korrekt zurückgegeben', async () => {
  const { status, json } = await api('GET', `/api/vaults/${teamVaultId}`);
  assert.equal(status, 200);
  assert.equal(json.vault.id, teamVaultId);
  assert.equal(json.vault.name, 'Team');
  const entry = json.vault.entries.find((e) => e.title === 'Login');
  assert.ok(entry, 'Login-Eintrag muss im Vault vorhanden sein');
  assert.equal(entry.username, 'u');
  assert.equal(entry.secret, 's');
});

test('POST /api/vaults/{id}/entries {title:""} → 400', async () => {
  const { status } = await api('POST', `/api/vaults/${teamVaultId}/entries`, {
    title: '', username: 'u', secret: 's',
  });
  assert.equal(status, 400);
});

test('GET /api/vaults/nonexistent → 404', async () => {
  const { status, json } = await api('GET', '/api/vaults/nonexistent');
  assert.equal(status, 404);
  assert.ok(json && json.error, '404-Antwort muss error-Feld enthalten');
});

test('POST /api/vaults {name:""} → 400', async () => {
  const { status } = await api('POST', '/api/vaults', { name: '' });
  assert.equal(status, 400);
});

// ---------- Frontend-Integrationsprüfung (statisch) ----------
test('Frontend: index.html existiert und referenziert app.css & app.js', () => {
  const htmlPath = path.join(FRONTEND_DIR, 'index.html');
  assert.ok(fs.existsSync(htmlPath), `index.html fehlt: ${htmlPath}`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<link[^>]+href=["']app\.css["']/, 'index.html muss app.css referenzieren');
  assert.match(html, /<script[^>]+src=["']app\.js["']/, 'index.html muss app.js referenzieren');
});

test('Frontend: app.js definiert listVaults, createVault, openVault, addEntry', () => {
  const jsPath = path.join(FRONTEND_DIR, 'app.js');
  assert.ok(fs.existsSync(jsPath), `app.js fehlt: ${jsPath}`);
  const js = fs.readFileSync(jsPath, 'utf8');
  for (const fn of ['listVaults', 'createVault', 'openVault', 'addEntry']) {
    const re = new RegExp(`(?:async\\s+)?function\\s+${fn}\\s*\\(`);
    assert.match(js, re, `Funktion ${fn} muss definiert sein`);
  }
});

test('Frontend: Basis-URL http://127.0.0.1:9871 wird verwendet', () => {
  const jsPath = path.join(FRONTEND_DIR, 'app.js');
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(js.includes('http://127.0.0.1:9871'), 'app.js muss die Basis-URL http://127.0.0.1:9871 verwenden');
  const html = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
  assert.ok(html.includes('127.0.0.1:9871'), 'index.html muss die Backend-URL http://127.0.0.1:9871 nennen');
});
