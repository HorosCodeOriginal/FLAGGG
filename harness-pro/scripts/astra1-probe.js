#!/usr/bin/env node
'use strict';
// astra1-probe.js — startet die installierte ASTRA-1-Desktop und liest die
// GUI-Struktur aus (Buttons, Inputs, sichtbarer Text), um die Modellverwaltung
// zu finden. Kein Schreiben, nur Lesen.
const { _electron } = require('playwright');
const path = require('path');

const BIN = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\DeepSeek Harness - ASTRA 1\\DeepSeek Harness.exe';

(async () => {
  const app = await _electron.launch({ executablePath: BIN, args: [], timeout: 60000 });
  console.log('App-Prozess:', app.process().pid);
  const win = await app.firstWindow({ timeout: 60000 });
  console.log('title:', await win.title());
  console.log('url:', win.url());

  await win.waitForTimeout(4000);

  const info = await win.evaluate(() => {
    const btnLabels = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean);
    const inputPlaceholders = [...document.querySelectorAll('input, textarea, select')].map(i => (i.placeholder || i.id || i.name || '').trim()).filter(Boolean);
    const bodyText = (document.body.innerText || '').slice(0, 4000);
    return { btnLabels: btnLabels.slice(0, 150), inputPlaceholders: inputPlaceholders.slice(0, 60), bodyText };
  });

  console.log('--- BUTTONS ---');
  console.log(JSON.stringify(info.btnLabels, null, 1));
  console.log('--- INPUTS ---');
  console.log(JSON.stringify(info.inputPlaceholders, null, 1));
  console.log('--- TEXT (Auszug) ---');
  console.log(info.bodyText);
  await app.close();
  process.exit(0);
})().catch(err => { console.error('PROBE FAIL:', err.message); process.exit(1); });
