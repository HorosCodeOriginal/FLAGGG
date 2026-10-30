// language: JavaScript (Node.js 20+), file: primary-router.js, target: Windows/Linux
// primary-router: Direkter Router fuer fr-gateway (Host-Port 20128).
// Leitet an den lokalen Inception-Pool (http://127.0.0.1:20199/v1) weiter und
// mappt alle angefragten Modell-IDs auf das einzige verfuegbare Modell
// (mercury-3), damit gpt-6-astra / claude-opus-5.5 / beliebige IDs funktionieren.
// OpenAI-kompatibel: POST /v1/chat/completions, GET /v1/models, GET /healthz.
'use strict';

const http = require('http');

const PORT = parseInt(process.env.ROUTER_PORT || '20128', 10);
const POOL = process.env.POOL_URL || 'http://127.0.0.1:20199/v1';
const TARGET_MODEL = process.env.TARGET_MODEL || 'mercury-3';
const ALIASES = ['gpt-6-astra', 'claude-opus-5.5', 'astra', 'astra-gpt-6'];
const TIMEOUT_MS = 120000;

function upstreamRequest(method, pathname, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(POOL + pathname);
    const req = http.request(u, {
      method,
      headers: Object.assign({}, headers, {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }),
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', () => resolve({ status: 502, headers: {}, body: JSON.stringify({ error: { message: 'router upstream unreachable', type: 'network_error' } }) }));
    if (body) req.write(body);
    req.end();
  });
}

// Modell-IDs in der Liste ausweiten: Alias-Namen einfuegen, damit Clients
// (z.B. Cursor / DSH) ihre Modellwahl aus der Liste treffen koennen.
function augmentModels(bodyText) {
  try {
    const j = JSON.parse(bodyText);
    if (j && Array.isArray(j.data)) {
      const existing = new Set(j.data.map(m => m.id));
      for (const alias of ALIASES) {
        if (!existing.has(alias)) {
          j.data.unshift({ id: alias, name: alias, created: 1743465660, input_modalities: ['text'], output_modalities: ['text'], context_length: 1000000, max_output_length: 131072 });
          existing.add(alias);
        }
      }
      return JSON.stringify(j);
    }
  } catch {}
  return bodyText;
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  let pathname = req.url || '/';
  if (pathname.includes('?')) pathname = pathname.split('?')[0];

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'primary-router', pool: POOL, target_model: TARGET_MODEL }));
    return;
  }

  if (pathname === '/v1/models' && method === 'GET') {
    const out = await upstreamRequest('GET', '/models', {}, null);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(out.status === 200 ? augmentModels(out.body) : out.body);
    return;
  }

  if (pathname === '/v1/chat/completions' && method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = raw;
      try {
        const j = JSON.parse(raw);
        if (j && typeof j === 'object') j.model = TARGET_MODEL; // Modell-ID mappen
        body = JSON.stringify(j);
      } catch {}
      const out = await upstreamRequest('POST', '/chat/completions', {}, body);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(out.body);
    });
    return;
  }

  // alles andere: an den Pool durchreichen
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const out = await upstreamRequest(method, pathname.replace(/^\/v1/, '') || '/', {}, Buffer.concat(chunks).toString('utf8') || null);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(out.body);
  });
});

server.listen(PORT, () => {
  console.log('[router] primary-router laeuft auf http://127.0.0.1:' + PORT);
  console.log('[router] Pool: ' + POOL + ' | Zielmodell: ' + TARGET_MODEL);
});
server.on('error', (e) => { console.error('[router] Serverfehler: ' + e.message); process.exit(1); });
