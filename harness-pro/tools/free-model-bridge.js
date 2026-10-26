'use strict';
// free-model-bridge.js — lokaler OpenAI-kompatibler Brueckenkopf zu einem
// keylosen, freien Modell-Endpunkt (Pollinations). Damit hat das Gateway wieder
// echte Modellantworten, solange der eigentliche Anbieter 429 liefert.
//
// Kein eigener Key noetig. Jede Antwort kommt vom freien Endpunkt; der Stub
// (light-upstream) bleibt als letzte Fallback-Stufe im Pool.
//
// Start: node tools/free-model-bridge.js [--port 20201]
// Endpunkte: GET /v1/models, GET /health, POST /v1/chat/completions (stream true/false)

const http = require('http');
const https = require('https');

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = Number(argValue('--port', process.env.FREE_BRIDGE_PORT || 20201));
const UPSTREAM_URL = argValue('--upstream', process.env.FREE_BRIDGE_UPSTREAM || 'https://text.pollinations.ai/openai');
const UPSTREAM_MODEL = argValue('--model', process.env.FREE_BRIDGE_MODEL || 'openai-fast');
// Budget (402) oder Rate-Limit (429) beim freien Endpunkt: naechstes Modell probieren
const MODEL_FALLBACKS = String(process.env.FREE_BRIDGE_MODELS || 'openai-fast,openai,mistral').split(',').map(s => s.trim()).filter(Boolean);
const TIMEOUT_MS = Number(process.env.FREE_BRIDGE_TIMEOUT_MS || 120000);
// Gesamtbudget fuer einen Request inkl. Retries: danach schnell scheitern, damit
// nginx auf die naechste Stufe (Offline-Stub) faellt statt den Task zu blockieren.
const DEADLINE_MS = Number(process.env.FREE_BRIDGE_DEADLINE_MS || 8000);

const MODELS = [
  { id: 'gpt-6-astra', object: 'model', owned_by: 'free-bridge' },
  { id: 'claude-opus-5.5', object: 'model', owned_by: 'free-bridge' },
  { id: 'free-bridge', object: 'model', owned_by: 'free-bridge' },
];

// --- Rate-Limit-Erkennung + Mindestabstand zwischen Upstream-Calls -----------
function isRateLimited(err) {
  const text = String((err && (err.message + ' ' + (err.body || ''))) || '');
  return /rate.?limit|too many requests|retry after/i.test(text) || (err && err.status === 429);
}

function retryAfterOf(err) {
  const text = String((err && (err.message + ' ' + (err.body || ''))) || '');
  const m = /retry after\s+(\d+)/i.exec(text);
  return m ? Number(m[1]) * 1000 : 0;
}

// Mindestabstand zwischen zwei Upstream-Anfragen (freie Endpunkte limitieren
// pro Zeitfenster; ohne Takt wuerde jede zweite Anfrage abgelehnt).
const MIN_GAP_MS = Number(process.env.FREE_BRIDGE_MIN_GAP_MS || 2000);
let lastCall = 0;
let chain = Promise.resolve();
function throttled(fn) {
  const run = async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastCall = Date.now();
    }
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function postToUpstream(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(UPSTREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: TIMEOUT_MS,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error('upstream http ' + res.statusCode);
          err.status = res.statusCode;
          err.body = raw.slice(0, 300);
          err.retryAfterMs = retryAfterOf(err);
          return reject(err);
        }
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('upstream nicht lesbar: ' + e.message)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function mapModel(model) {
  // oeffentliche Namen des Gateways auf den freien Endpunkt mappen
  if (!model || model === 'gpt-6-astra' || model === 'claude-opus-5.5' || model === 'free-bridge') return UPSTREAM_MODEL;
  return model;
}

function normalize(answer, model) {
  const content = (answer && answer.choices && answer.choices[0] && answer.choices[0].message &&
    answer.choices[0].message.content) || '';
  return {
    id: (answer && answer.id) || ('bridge-' + Date.now()),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: (answer && answer.usage) || { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function streamFromAnswer(answer, res) {
  const data = normalize(answer, answer && answer.model);
  const content = data.choices[0].message.content;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const push = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  push({ id: data.id, object: 'chat.completion.chunk', created: data.created, model: data.model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  const size = 64;
  for (let i = 0; i < content.length; i += size) {
    push({ id: data.id, object: 'chat.completion.chunk', created: data.created, model: data.model,
      choices: [{ index: 0, delta: { content: content.slice(i, i + size) }, finish_reason: null }] });
  }
  push({ id: data.id, object: 'chat.completion.chunk', created: data.created, model: data.model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: data.usage });
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    return sendJson(res, 200, { ok: true, service: 'free-model-bridge', upstream: UPSTREAM_URL, port: PORT });
  }
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return sendJson(res, 200, { object: 'list', data: MODELS });
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) {
        return sendJson(res, 400, { error: { message: 'ungueltiges JSON' } });
      }
      const payload = {
        model: mapModel(body.model),
        messages: Array.isArray(body.messages) ? body.messages : [],
        stream: false,
      };
      if (typeof body.temperature === 'number') payload.temperature = body.temperature;
      if (typeof body.max_tokens === 'number') payload.max_tokens = body.max_tokens;
      try {
        let answer = null;
        let lastErr = null;
        const models = [UPSTREAM_MODEL].concat(MODEL_FALLBACKS.filter(m => m !== UPSTREAM_MODEL));
        const startedAt = Date.now();
        for (const candidateModel of models) {
          for (let attempt = 1; attempt <= 1; attempt += 1) {
            if (Date.now() - startedAt > DEADLINE_MS) {
              const budgetErr = new Error('budget erschoepft nach ' + DEADLINE_MS + 'ms (rate limit)');
              budgetErr.status = 429;
              throw budgetErr;
            }
            try {
              answer = await throttled(() => postToUpstream(Object.assign({}, payload, { model: candidateModel })));
              break;
            } catch (err) {
              lastErr = err;
              const retryable = isRateLimited(err) || err.status === 402 || err.status === 429 || err.status >= 500;
              if (!retryable) break;
              if (attempt < 3) {
                const waitMs = err.retryAfterMs || (1200 * attempt);
                await new Promise(r => setTimeout(r, waitMs));
              }
            }
          }
          if (answer) break;
        }
        if (!answer) throw lastErr || new Error('kein freies modell erreichbar');
        if (body.stream) return streamFromAnswer(answer, res);
        return sendJson(res, 200, normalize(answer, body.model));
      } catch (err) {
        // Fehler als Gateway-Fehler weitergeben -> nginx faehrt die naechste Stufe an.
        // Rate-Limit wird zu 429, damit die Kette weiterfaellt statt roh durchzureichen.
        const tooMany = isRateLimited(err);
        const status = tooMany ? 429 : ((err.status >= 500 || !err.status) ? 502 : (err.status === 402 ? 402 : 502));
        return sendJson(res, status, { error: { message: 'free-bridge: ' + err.message, type: 'upstream_error' } });
      }
    });
    return undefined;
  }
  return sendJson(res, 404, { error: { message: 'unbekannter pfad: ' + url.pathname } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[free-bridge] bereit auf 127.0.0.1:' + PORT + ' -> ' + UPSTREAM_URL);
});
