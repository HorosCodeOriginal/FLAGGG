#!/usr/bin/env node
'use strict';
// electron-ui-smoke.js — Klick-Smoke gegen die echte Electron-App (mit window.api)
// Startet die App via Playwright._electron, klickt die Kern-UI durch und
// sammelt Console-Fehler. Ausführung: node scripts/electron-ui-smoke.js
const { _electron } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = [];
let clicks = 0;

async function click(page, sel, label) {
  const el = page.locator(sel).first();
  if (!(await el.count())) throw new Error('missing ' + sel + ' (' + label + ')');
  await el.click();
  clicks++;
  await sleep(40);
}

(async () => {
  const app = await _electron.launch({ executablePath: BIN, args: ['main.js'], cwd: ROOT, env, timeout: 30000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const consoleErrors = [];
  win.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await sleep(800); // App-Boot + data.js

  const t = () => win.evaluate(() => document.getElementById('app').innerText);

  // 1) alle Views durchschalten
  for (const v of ['chat', 'orchestration', 'overview', 'market']) {
    await click(win, '[data-act="nav"][data-view="' + v + '"]', 'nav ' + v);
    const txt = await t();
    if (txt.length < 40) throw new Error('view ' + v + ' rendered empty');
    if (!(await win.locator('[data-act="nav"][data-view="' + v + '"].on').count())) throw new Error('nav ' + v + ' not active');
  }
  // 2) chat: panes + layouts + composer vorhanden
  await click(win, '[data-act="nav"][data-view="chat"]', 'nav chat');
  for (const p of ['tasks', 'memory', 'knowledge', 'agents', 'settings', 'chat']) {
    await click(win, '[data-act="cpane"][data-pane="' + p + '"]', 'pane ' + p);
    if (!(await win.locator('[data-pane="' + p + '"].on').count())) throw new Error('pane ' + p + ' not active');
  }
  for (const l of ['thread', 'phases', 'code', 'studio']) {
    await click(win, '[data-act="layout"][data-layout="' + l + '"]', 'layout ' + l);
    if (!(await win.locator('[data-layout="' + l + '"].on').count())) throw new Error('layout ' + l + ' not active');
  }
  if (!(await win.locator('#composer').count())) throw new Error('composer missing');
  // 3) Bell-Popover
  await click(win, '[data-act="bell"]', 'bell open');
  if (!(await win.locator('#bellpop').count())) throw new Error('bellpop missing');
  await click(win, '[data-act="bell"]', 'bell close');
  if (await win.locator('#bellpop').count()) throw new Error('bellpop stayed open');
  // 4) Market: Kategorie + Install/Uninstall
  await click(win, '[data-act="nav"][data-view="market"]', 'nav market');
  await click(win, '[data-act="cat"][data-cat="Tools"]', 'cat Tools');
  if (!(await win.locator('#marketGrid article, #marketGrid .empty').count())) throw new Error('market grid empty');
  await click(win, '[data-act="install"]', 'install');
  await sleep(120);
  await click(win, '[data-act="uninstall"]', 'uninstall');
  await sleep(120);
  // 5) Orchestration: Node + Collapse
  await click(win, '[data-act="nav"][data-view="orchestration"]', 'nav orchestration');
  const nodeCount = await win.locator('[data-act="node"]').count();
  if (!nodeCount) throw new Error('no orchestration nodes rendered');
  await click(win, '[data-act="node"]', 'first node');
  const nodeOn = await win.locator('[data-act="node"].on').count();
  if (!nodeOn) throw new Error('node selection missing');
  await click(win, '[data-act="collapse"]', 'collapse');
  await sleep(60);
  await click(win, '[data-act="collapse"]', 'expand');
  // 6) Overview-Sektionen
  await click(win, '[data-act="nav"][data-view="overview"]', 'nav overview');
  const ov = await t();
  // desk.json (echte Daten) bringt keine sessions/timeline mit — geprüft wird,
  // dass die Overview trotzdem gültige Karten rendert und nicht leer bleibt.
  const cards = await win.locator('.card').count();
  if (cards < 1) throw new Error('overview rendered without cards');
  if (ov.length < 40) throw new Error('overview rendered sparse');

  await app.close();

  console.log(JSON.stringify({
    result: failures.length ? 'FAIL' : 'PASS',
    clicks,
    consoleErrors,
    failures,
  }, null, 2));
  process.exit(failures.length ? 1 : 0);
})().catch(err => {
  console.error('FAIL:', err.message);
  console.error(JSON.stringify({ clicks, failures }, null, 2));
  process.exit(1);
});
