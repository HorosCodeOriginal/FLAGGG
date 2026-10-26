// pong-test: schickt je App eine echte Chat-Anfrage ueber genau den Pfad,
// den die App verwendet (Key-Auswahl + Modell + Streaming).
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const REGISTRY = path.join(ROOT, 'fr-gateway', 'secrets', 'registry.json');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

function readKeyFile(p) {
  try { const v = fs.readFileSync(p, 'utf8').trim(); return v || null; } catch (e) { return null; }
}

// entspricht gatewayEnv()/claudeInfo() der Apps
function entryFor(app) {
  const reg = loadRegistry();
  if (app.keyFile) {
    const ck = readKeyFile(path.join(ROOT, app.dir, app.keyFile));
    if (ck) {
      const e = reg.find(x => x && (x.unique_key === ck || x.raw_key === ck));
      if (e) return e;
    }
  }
  if (app.pin) {
    const pin = JSON.parse(fs.readFileSync(path.join(ROOT, app.dir, app.pin), 'utf8'));
    const e = reg.find(x => x && x.key_hash === pin.key_hash && x.model_family === pin.family && x.unique_key);
    if (e) return e;
  }
  return reg.find(x => app.family.test(x.model_family || '')) || null;
}

function chat(app, entry) {
  return new Promise(resolve => {
    const body = JSON.stringify({
      model: app.model,
      messages: [{ role: 'user', content: 'Antworte nur mit dem Wort: pong' }],
      stream: true,
      max_tokens: 16,
      stream_options: { include_usage: true },
    });
    const started = Date.now();
    let text = '';
    let status = 0;
    let errBody = '';

    const req = http.request({
      host: '127.0.0.1', port: entry.port, path: '/v1/chat/completions', method: 'POST',
      headers: {
        Authorization: 'Bearer ' + entry.unique_key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    }, res => {
      status = res.statusCode;
      let buf = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => {
        if (status !== 200) { errBody += chunk; return; }
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const d = j.choices && j.choices[0] && j.choices[0].delta;
            const t = (d && (d.content || d.reasoning_content)) || '';
            if (t) text += t;
          } catch (e) { /* partial */ }
        }
      });
      res.on('end', () => {
        if (status !== 200) {
          const clean = errBody.replace(/\\u0022/g, '"').replace(/\s+/g, ' ');
          return resolve({ app: app.name, status, error: clean.slice(0, 180), ms: Date.now() - started });
        }
        resolve({ app: app.name, status, text: text.trim().slice(0, 80), ms: Date.now() - started });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ app: app.name, status: 0, error: 'Timeout', ms: Date.now() - started }); });
    req.on('error', e => resolve({ app: app.name, status: 0, error: e.message, ms: Date.now() - started }));
    req.write(body);
    req.end();
  });
}

const APPS = [
  { name: 'astra-harness', dir: 'astra-harness', family: /astra/i, model: 'gpt-6-astra', keyFile: 'data/astra-key.txt' },
  { name: 'claude-harness', dir: 'claude-harness', family: /claude|opus/i, model: 'claude-opus-5.5', keyFile: 'data/claude-key.txt' },
  { name: 'harness-pro (desktop)', dir: 'harness-pro', family: /astra/i, model: 'gpt-6-astra', keyFile: 'data/astra-key.txt' },
  { name: 'fr-harness (desktop)', dir: 'fr-harness', family: /astra/i, model: 'gpt-6-astra', pin: 'astra.json' },
];

(async () => {
  for (const app of APPS) {
    const e = entryFor(app);
    if (!e) { console.log(`${app.name.padEnd(22)} KEIN KEY gefunden`); continue; }
    const r = await chat(app, e);
    const info = `nr ${e.nr} :${e.port} ${e.model_family}`;
    if (r.status === 200) {
      console.log(`${app.name.padEnd(22)} OK    ${info}  -> "${r.text}"  (${r.ms} ms)`);
    } else {
      console.log(`${app.name.padEnd(22)} FEHLER ${info}  HTTP ${r.status}  ${r.error}  (${r.ms} ms)`);
    }
  }
})();
