'use strict';

// MiniVault – eigenständiger HTTP-Server (nur Node-Standardmodule)
// Endpunkte: siehe Aufgabenbeschreibung (API-Vertrag des Teams).

const http = require('node:http');
const { URL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 9871);
const DATA_FILE = path.join(__dirname, 'data.json');
const FRONTEND_ORIGIN = 'http://127.0.0.1:9872';

// ---------- Persistenz ----------

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.vaults)) return parsed;
    throw new Error('unexpected data shape');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[miniVault] Warnung: konnte ${path.basename(DATA_FILE)} nicht laden (${err.message}) – starte leer.`);
    }
    return { vaults: [] };
  }
}

// Atomar speichern: in Temp-Datei schreiben, dann umbenennen.
function saveData() {
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

let data = loadData();

// ---------- Helfer ----------

function uuid() { return crypto.randomUUID(); }
function isoNow() { return new Date().toISOString(); }

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (raw.trim() === '') return resolve(null); // kein Body
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); } // ungültiges JSON
    });
    req.on('error', reject);
  });
}

// ---------- Routing / Handler ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  // CORS für das Frontend-Team
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    console.log(`[miniVault] OPTIONS ${p} → 204`);
    return;
  }

  let status = 500;
  try {
    if (p === '/healthz' && req.method === 'GET') {
      status = 200;
      sendJson(res, 200, { ok: true });
    } else if (p === '/api/vaults' && req.method === 'POST') {
      const body = await readJson(req);
      if (body === undefined) {
        status = 400; sendJson(res, 400, { error: 'ungültiges JSON' });
      } else if (!body || typeof body.name !== 'string' || body.name.trim() === '') {
        status = 400; sendJson(res, 400, { error: 'name ist erforderlich' });
      } else {
        const vault = { id: uuid(), name: body.name.trim(), createdAt: isoNow(), entries: [] };
        data.vaults.push(vault);
        saveData();
        status = 201;
        sendJson(res, 201, { id: vault.id, name: vault.name, createdAt: vault.createdAt });
      }
    } else if (p === '/api/vaults' && req.method === 'GET') {
      status = 200;
      sendJson(res, 200, {
        vaults: data.vaults.map((v) => ({ id: v.id, name: v.name, createdAt: v.createdAt })),
      });
    } else {
      const mEntry = p.match(/^\/api\/vaults\/([^/]+)\/entries$/);
      const mVault = p.match(/^\/api\/vaults\/([^/]+)$/);

      if (mEntry && req.method === 'POST') {
        const id = decodeURIComponent(mEntry[1]);
        const vault = data.vaults.find((v) => v.id === id);
        if (!vault) {
          status = 404; sendJson(res, 404, { error: 'vault nicht gefunden' });
        } else {
          const body = await readJson(req);
          if (body === undefined) {
            status = 400; sendJson(res, 400, { error: 'ungültiges JSON' });
          } else if (
            !body ||
            typeof body.title !== 'string' || body.title.trim() === '' ||
            typeof body.secret !== 'string' || body.secret.trim() === ''
          ) {
            status = 400; sendJson(res, 400, { error: 'title und secret sind erforderlich' });
          } else {
            const entry = {
              id: uuid(),
              title: body.title.trim(),
              username: (typeof body.username === 'string' && body.username.trim() !== '') ? body.username.trim() : '',
              secret: body.secret,
              createdAt: isoNow(),
            };
            vault.entries.push(entry);
            saveData();
            status = 201;
            sendJson(res, 201, entry);
          }
        }
      } else if (mVault && req.method === 'GET') {
        const id = decodeURIComponent(mVault[1]);
        const vault = data.vaults.find((v) => v.id === id);
        if (!vault) {
          status = 404; sendJson(res, 404, { error: 'vault nicht gefunden' });
        } else {
          status = 200;
          sendJson(res, 200, {
            vault: { id: vault.id, name: vault.name, createdAt: vault.createdAt, entries: vault.entries },
          });
        }
      } else {
        status = 404; sendJson(res, 404, { error: 'nicht gefunden' });
      }
    }
  } catch (err) {
    console.error(`[miniVault] Fehler bei ${req.method} ${p}:`, err);
    status = 500;
    sendJson(res, 500, { error: 'interner Fehler' });
  }

  console.log(`[miniVault] ${req.method} ${p} → ${status}`);
});

server.listen(PORT, () => {
  console.log(`[miniVault] Server läuft auf http://127.0.0.1:${PORT} (Daten: ${DATA_FILE})`);
});
