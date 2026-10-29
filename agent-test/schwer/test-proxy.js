'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createProxy } = require('./proxy.js');

const PROXY_PORT = 8099;
const TARGET_PORT = 9000;
const API_KEY = 'test-secret';

let targetServer;
let proxyApp;

function httpRequest(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}

before(async () => {
  // (1) Zielserver auf Port 9000 aufsetzen
  targetServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url: req.url }));
  });
  await listen(targetServer, TARGET_PORT);

  // (2) Proxy starten
  proxyApp = createProxy({
    port: PROXY_PORT,
    target: `http://127.0.0.1:${TARGET_PORT}`,
    apiKey: API_KEY,
  });
  await proxyApp.listen();
});

after(async () => {
  await proxyApp.close();
  await closeServer(targetServer);
});

test('(3) 401 ohne API-Key', async () => {
  const res = await httpRequest(PROXY_PORT, '/no-auth');
  assert.equal(res.status, 401);
});

test('(4) 200 mit korrektem API-Key', async () => {
  const res = await httpRequest(PROXY_PORT, '/hello', { headers: { 'x-api-key': API_KEY } });
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.url, '/hello');
});

test('(5) 429 nach mehr als 10 Requests in 10s (Sliding Window)', async () => {
  const responses = [];
  for (let i = 0; i < 11; i++) {
    responses.push(await httpRequest(PROXY_PORT, `/burst/${i}`, { headers: { 'x-api-key': API_KEY } }));
  }
  // Der 11. Request im Burst muss mit 429 abgelehnt werden.
  assert.equal(responses[10].status, 429);
  // Retry-After-Header muss vorhanden sein (positive Sekundenzahl).
  assert.match(String(responses[10].headers['retry-after']), /^[1-9]\d*$/);
  // Die ersten Anfragen des Bursts duerfen noch durchgehen (Budget reicht).
  assert.equal(responses[0].status, 200);
});

test('(6) 502, wenn das Ziel nicht erreichbar ist', async () => {
  // Garantiert geschlossenen Port besorgen: Server binden, Port merken, wieder schliessen.
  const tmp = http.createServer();
  await listen(tmp, 0);
  const closedPort = tmp.address().port;
  await closeServer(tmp);

  const badProxy = createProxy({
    port: 8100,
    target: `http://127.0.0.1:${closedPort}`,
    apiKey: API_KEY,
  });
  await badProxy.listen();
  try {
    const res = await httpRequest(8100, '/down', { headers: { 'x-api-key': API_KEY } });
    assert.equal(res.status, 502);
  } finally {
    await badProxy.close();
  }
});
