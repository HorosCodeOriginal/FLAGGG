// statischer Selbstcheck für das MiniVault-Frontend
// Lauf: node selfcheck.mjs  → Exit 0 bei Erfolg, sonst 1.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const failures = [];
const log = (ok, msg) => {
  console.log((ok ? '[OK]   ' : '[FEHLER] ') + msg);
  if (!ok) failures.push(msg);
};

// --- 1) index.html existiert und referenziert app.css / app.js ---
const htmlPath = join(dir, 'index.html');
log(existsSync(htmlPath), 'index.html existiert');
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  log(/\bhref="app\.css"/.test(html), 'index.html referenziert app.css');
  log(/\bsrc="app\.js"/.test(html), 'index.html referenziert app.js');
}

// --- 2) app.js definiert die vier API-Funktionen ---
const jsPath = join(dir, 'app.js');
log(existsSync(jsPath), 'app.js existiert');
if (existsSync(jsPath)) {
  const js = readFileSync(jsPath, 'utf8');
  const required = ['listVaults', 'createVault', 'openVault', 'addEntry'];
  for (const fn of required) {
    const re = new RegExp('(?:async\\s+)?function\\s+' + fn + '\\s*\\(');
    log(re.test(js), 'app.js definiert Funktion ' + fn + '()');
  }
  log(/fetch\s*\(/.test(js), 'app.js verwendet fetch');
  log(/'Content-Type'\s*:\s*'application\/json'/.test(js), 'app.js sendet JSON-Header');
}

// --- 3) Basis-URL korrekt ---
const expectedBase = 'http://127.0.0.1:9871';
const js = existsSync(jsPath) ? readFileSync(jsPath, 'utf8') : '';
const baseRe = /API_BASE_URL\s*=\s*['"]http:\/\/127\.0\.0\.1:9871['"]/;
log(baseRe.test(js), 'app.js nutzt Basis-URL ' + expectedBase);
log(!js.includes('localhost'), 'app.js verwendet kein "localhost" (nur 127.0.0.1)');

console.log('');
if (failures.length > 0) {
  console.log('SELFCHECK FEHLGESCHLAGEN: ' + failures.length + ' Punkt(e)');
  process.exit(1);
}
console.log('SELFCHECK ERFOLGREICH – alle Prüfungen bestanden.');
process.exit(0);
