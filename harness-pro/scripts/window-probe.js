#!/usr/bin/env node
'use strict';
// window-probe.js — diagnostiziert, was mit dem Electron-Fenster passiert.
const { _electron } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

(async () => {
  const app = await _electron.launch({ executablePath: BIN, args: ['main.js'], cwd: ROOT, env, timeout: 30000 });
  console.log('App gestartet, Prozesse:', app.process().pid);
  const win = await app.firstWindow({ timeout: 15000 });
  console.log('Fenster: title=', await win.title());
  win.on('close', () => console.log('Fenster geschlossen (close-Event)'));
  win.on('pageerror', e => console.log('pageerror:', e.message));
  win.on('console', m => { if (m.type() === 'error') console.log('console.error:', m.text()); });
  await win.waitForTimeout(6000);
  const alive = await win.evaluate(() => 1).catch(() => null);
  console.log('Fenster nach 6s noch erreichbar:', alive !== null);
  await app.close();
  process.exit(0);
})().catch(err => { console.error('PROBE FAIL:', err.message); process.exit(1); });
