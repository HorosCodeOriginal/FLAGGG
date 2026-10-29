#!/usr/bin/env node
'use strict';
// team-e2e.js — End-to-End-Verifikation des Dreier-Teams (MiniVault).
// Startet Backend (harness-pro/teamwork/server.js) + statisches Frontend
// (astra-harness/teamwork) und fährt mit Playwright den kompletten UI-Durchlauf:
// Vault anlegen → Liste → öffnen → Entry hinzufügen → sichtbar.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'teamwork', 'server.js');
const FRONTEND = path.join(ROOT, '..', 'astra-harness', 'teamwork');
const API_PORT = 9871;
const WEB_PORT = 9872;

function waitHttp(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      http.get(url, res => { res.resume(); resolve(res.statusCode); })
        .on('error', err => {
          if (Date.now() - start > timeoutMs) return reject(err);
          setTimeout(poll, 250);
        });
    })();
  });
}

function staticServer() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  return http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(FRONTEND, p);
    if (!f.startsWith(FRONTEND) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

(async () => {
  if (!fs.existsSync(BACKEND)) throw new Error('Backend fehlt: ' + BACKEND);
  if (!fs.existsSync(path.join(FRONTEND, 'index.html'))) throw new Error('Frontend fehlt: ' + FRONTEND);

  // Sauberes Test-Setup: Store leeren (Team-Absprache: Integration startet leer).
  fs.writeFileSync(path.join(ROOT, 'teamwork', 'data.json'), JSON.stringify({ vaults: [] }));

  // Backend
  const api = spawn(process.execPath, [BACKEND], { env: { ...process.env, PORT: String(API_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  if (await waitHttp('http://127.0.0.1:' + API_PORT + '/healthz', 8000) !== 200) throw new Error('Backend healthz nicht ok');

  // Frontend statisch
  const web = staticServer();
  await new Promise(r => web.listen(WEB_PORT, '127.0.0.1', r));
  if (await waitHttp('http://127.0.0.1:' + WEB_PORT + '/', 3000) !== 200) throw new Error('Frontend nicht erreichbar');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + WEB_PORT + '/', { waitUntil: 'networkidle' });

  // 1) Vault anlegen
  const name = 'TeamVault-' + Date.now();
  await page.fill('#new-vault-name', name);
  await page.click('#create-vault-form button[type="submit"]');
  await page.waitForSelector('.vault-card', { timeout: 5000 });
  let body = await page.locator('body').innerText();
  if (!body.includes(name)) throw new Error('Neuer Vault nicht in der Liste sichtbar');
  // 2) Vault öffnen (erste Karte)
  await page.locator('.vault-card').first().locator('button:has-text("Öffnen")').click();
  await page.waitForSelector('#entries-list', { timeout: 5000 });
  // 3) Entry hinzufügen
  await page.fill('#entry-title', 'TeamLogin');
  await page.fill('#entry-username', 'team');
  await page.fill('#entry-secret', 's3cret');
  await page.click('#add-entry-form button[type="submit"]');
  await page.waitForTimeout(800);
  if (await page.locator('#error-banner').isVisible().catch(() => false)) {
    const bt = await page.locator('#error-text').innerText();
    throw new Error('API-Fehler im UI: ' + bt);
  }
  const rows = await page.locator('.entry-row').count();
  if (!rows) {
    const b = await page.locator('body').innerText();
    throw new Error('Keine .entry-row gerendert. Body-Ende: ' + b.slice(-400));
  }
  body = await page.locator('body').innerText();
  if (!body.includes('TeamLogin')) throw new Error('Entry nicht sichtbar');
  if (body.includes('s3cret')) throw new Error('Secret war unmaskiert im DOM (Security-Regression)');
  // 4) Toggle: Secret zeigen/verbergen
  const toggle = page.locator('.entry-row .btn-secret').first();
  await toggle.click();
  body = await page.locator('body').innerText();
  if (!body.includes('s3cret')) {
    const probe = await page.evaluate(() => {
      const b = document.querySelector('.entry-row .btn-secret');
      const s = document.querySelector('.entry-row .secret-value');
      return { btn: b && b.textContent, val: s && s.textContent, shownCount: document.querySelectorAll('.entry-row').length };
    });
    throw new Error('Toggle zeigte das Secret nicht. Probe: ' + JSON.stringify(probe));
  }
  await toggle.click();
  body = await page.locator('body').innerText();
  if (body.includes('s3cret')) throw new Error('Toggle verbarg das Secret nicht');

  await browser.close();
  await new Promise(r => web.close(r));
  api.kill();

  console.log(JSON.stringify({ result: 'PASS', vault: name, consoleErrors: errors }, null, 2));
  process.exit(errors.length ? 1 : 0);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
