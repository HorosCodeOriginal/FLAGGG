#!/usr/bin/env node
'use strict';
// electron-run.js — startet Electron mit sauberer Umgebung.
// Problem: ELECTRON_RUN_AS_NODE=1 (global gesetzt) macht require('electron')
// in main.js zu undefined. Dieses Skript entfernt die Variable für den
// App-Prozess und startet die Electron-Binary direkt.
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const result = spawnSync(BIN, args, { cwd: ROOT, stdio: 'inherit', env });

if (result.error) {
  console.error('[electron-run] start fehlgeschlagen:', result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
