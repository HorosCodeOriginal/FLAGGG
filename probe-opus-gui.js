// probe-opus-gui.js — liest die laufende OPUS-Harness-GUI (Web-Modus) aus:
// sichtbarer Text + Modell-Auswahl (Opus/Astra/Inception?).
'use strict';
const { chromium } = require('C:\\Users\\Administrator\\Downloads\\FLAGGG\\harness-pro\\node_modules\\playwright');

const URL = process.argv[2] || 'http://127.0.0.1:56307/?token=<TOKEN>';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);

  const data = await page.evaluate(() => {
    const bodyText = (document.body.innerText || '');
    const btns = [...document.querySelectorAll('button')].map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean);
    const sel = [...document.querySelectorAll('select')].map(s => [...s.options].map(o => o.text.trim()));
    return { bodyText: bodyText.slice(0, 12000), btns: btns.slice(0, 200), sel };
  });

  const lower = (data.bodyText + ' ' + data.btns.join(' ') + ' ' + JSON.stringify(data.sel)).toLowerCase();
  console.log('=== HITS ===');
  for (const term of ['opus', 'astra', 'inception', 'mercury', 'claude', 'gpt-6', 'modell', 'model']) {
    const count = (lower.match(new RegExp(term, 'g')) || []).length;
    console.log(term + ' -> ' + count);
  }
  console.log('=== TEXT-Auszug (Opus/Astra/Inception-Kontext) ===');
  const lines = data.bodyText.split('\n');
  lines.forEach((l, i) => {
    const ll = l.toLowerCase();
    if (/opus|astra|inception|mercury|claude|gpt-6/.test(ll)) console.log(i + ': ' + l.slice(0, 160));
  });
  console.log('=== BUTTONS (erste 40) ===');
  console.log(data.btns.slice(0, 40).join(' | '));
  await browser.close();
})().catch(err => { console.error('PROBE FAIL:', err.message); process.exit(1); });
