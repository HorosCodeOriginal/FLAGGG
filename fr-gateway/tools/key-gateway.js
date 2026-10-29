#!/usr/bin/env node
'use strict';
// key-gateway.js — lokaler Key-Gateway (Port 20129, Registry-Eintrag nr=1).
// Ersetzt den Docker-Container fr-key-bb627c9a4a8c, solange der Docker-Daemon
// nicht läuft. OpenAI-kompatibel (/v1), Failover-Kette wie in upstreams.json:
// free-bridge (20201) → local-light (20200). Damit antwortet die Desktop-App.
const http = require('http');

const PORT = Number(process.env.PORT) || 20129;
const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:20201';
const LIGHT = process.env.LIGHT_URL || 'http://127.0.0.1:20200';
const MODEL = process.env.MODEL_ID || 'gpt-6-astra';

function upstreamJson(url, path, body, method) {
  return new Promise((resolve, reject) => {
    const u = new URL(url + path);
    const req = http.request(u, { method: method || 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null }); }
        catch (e) { reject(new Error('kein JSON vom Upstream: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function chatCompletion(model, messages) {
  const payload = { model, messages, max_tokens: 1200 };
  const candidates = [
    { url: BRIDGE, tag: 'bridge' },
    { url: LIGHT, tag: 'light' },
  ];
  let lastErr = null;
  for (const c of candidates) {
    try {
      const r = await upstreamJson(c.url, '/v1/chat/completions', payload);
      if (r.status >= 200 && r.status < 300 && r.json && r.json.choices) {
        return { status: r.status, body: r.json, via: c.tag };
      }
      lastErr = new Error(c.tag + ' → HTTP ' + r.status);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('alle Upstreams fehlgeschlagen');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }); return res.end(); }

  if (url.pathname === '/v1/models' && req.method === 'GET') {
    // Garantiert: gpt-6-astra (Familie astra) ist immer gelistet, damit die
    // Desktop-App das Modell als verfügbar erkennt. Aufstream-Modelle ergänzen.
    const seen = new Set([MODEL]);
    const out = [{ id: MODEL, object: 'model', owned_by: 'astra' }];
    try {
      const r = await upstreamJson(LIGHT, '/v1/models', undefined, 'GET');
      const list = (r.json && r.json.data) || [];
      for (const m of list) {
        if (m && m.id && !seen.has(m.id)) { seen.add(m.id); out.push({ id: m.id, object: 'model' }); }
      }
    } catch (e) { /* nur Basisliste */ }
    send(200, { object: 'list', data: out });
    return;
  }

  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (e) { return send(400, { error: { message: 'ungültiges JSON' } }); }
      const model = body.model || MODEL;
      const messages = Array.isArray(body.messages) ? body.messages : [];
      try {
        const r = await chatCompletion(model, messages);
        console.log('[key-gateway] ' + req.method + ' ' + url.pathname + ' → ' + r.status + ' via ' + r.via);
        send(r.status, r.body);
      } catch (e) {
        console.error('[key-gateway] fehler: ' + e.message);
        send(502, { error: { message: 'Keine Antwort vom Modell: ' + e.message } });
      }
    });
    return;
  }

  send(404, { error: { message: 'not found' } });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[key-gateway] läuft auf :' + PORT + ' (bridge=' + BRIDGE + ', light=' + LIGHT + ')');
});
