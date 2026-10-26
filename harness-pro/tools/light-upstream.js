'use strict';
// light-upstream.js — leichter, lokaler OpenAI-kompatibler Upstream als
// Notfall-Pfad, wenn der echte Anbieter mit 429 (FreeUsageLimit) antwortet.
//
// WICHTIG: Das ist KEIN Modell. Es antwortet deterministisch und kennzeichnet
// jede Antwort als Offline-Stub. Zweck: Gateway, Failover-Kette, Queue, Runtime
// und UI bleiben test- und bedienbar, ohne echte Modellkosten.
//
// Rollenbewusst: fuer boss_astra delegiert der Stub, fuer sub_opus schreibt und
// startet er ein Skript. So laesst sich die Delegationskette auch ohne echtes
// Modell live durchspielen.
//
// Start: node tools/light-upstream.js [--port 20200]
// Endpunkte: GET /v1/models, GET /health, POST /v1/chat/completions

const http = require('http');

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = Number(argValue('--port', process.env.LIGHT_UPSTREAM_PORT || 20200));
const MODEL = 'light-offline-1';

const MODELS = [
  { id: 'gpt-6-astra', object: 'model', owned_by: 'light-upstream' },
  { id: 'claude-opus-5.5', object: 'model', owned_by: 'light-upstream' },
  { id: MODEL, object: 'model', owned_by: 'light-upstream' },
];

function promptText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.map(m => String((m && m.content) || '')).join('\n');
}

function roleOf(messages) {
  const match = /Du bist Agent "([^"]+)"/.exec(promptText({ messages }));
  return match ? match[1] : '';
}

function hasToolResult(messages) {
  return /Letztes Tool-Ergebnis:/.test(promptText({ messages }));
}

function toolNameInResult(messages) {
  const text = promptText({ messages });
  const idx = text.indexOf('Letztes Tool-Ergebnis:');
  if (idx < 0) return '';
  const tail = text.slice(idx);
  const match = /"tool"\s*:\s*"([a-z_]+)"/.exec(tail);
  return match ? match[1] : '';
}

function hasChildResults(messages) {
  return /Kind-Ergebnisse:/.test(promptText({ messages }));
}

function jsonAnswer(obj) {
  return JSON.stringify(obj);
}

function offlineNote() {
  return 'Lokaler Licht-Upstream: kein echtes Modell, Anbieter-Kontingent (429) erschoepft.';
}

function answerFor(body) {
  const messages = body.messages;
  const role = roleOf(messages);
  const text = promptText({ messages });
  const lastUser = (messages || [])
    .filter(m => m && m.role === 'user')
    .map(m => String(m.content || ''))
    .pop() || '';

  if (role === 'boss_astra') {
    if (hasChildResults(messages)) {
      return jsonAnswer({
        final: 'Delegiert und abgeschlossen (Offline-Stub)',
        offline: true,
        note: offlineNote(),
        summary: 'Kind-Task wurde vom Sub-Agenten ausgefuehrt; Ergebnis siehe Kind-Task.',
      });
    }
    return jsonAnswer({
      ok: true,
      offline: true,
      note: offlineNote(),
      final: 'Boss-Stub: Aufgabe direkt beantwortet (keine Delegation im Schnelltest).',
    });
  }

  if (role === 'sub_opus') {
    if (!hasToolResult(messages)) {
      return jsonAnswer({ tool: 'write_file', args: { path: 'hallo.py', content: 'print("Hallo")\n' } });
    }
    if (toolNameInResult(messages) === 'write_file') {
      return jsonAnswer({ tool: 'execute_shell', args: { command: 'python hallo.py' } });
    }
    return jsonAnswer({
      ok: true,
      offline: true,
      note: offlineNote(),
      script: 'hallo.py',
      output: 'Hallo',
    });
  }

  // normaler UI-Chat
  const stripped = lastUser.replace(/\s+/g, ' ').trim();
  return '⚠️ Offline-Antwort (lokaler Licht-Upstream, kein echtes Modell):\n' +
    'Das Kontingent beim Anbieter ist erschöpft (429). Diese Antwort beweist, dass Gateway, ' +
    'Failover-Kette, Queue und UI funktionieren.\n\n' +
    'Deine Nachricht war: "' + stripped.slice(0, 200) + '"\n\n' +
    'Sobald ein echter Key/Endpoint wieder Kapazität hat, antwortet das echte Modell.';
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

function completion(body) {
  const content = answerFor(body);
  return {
    id: 'light-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function streamChunks(body, res) {
  const data = completion(body);
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
    return sendJson(res, 200, { ok: true, service: 'light-upstream', offline: true, port: PORT });
  }
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return sendJson(res, 200, { object: 'list', data: MODELS });
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) {
        return sendJson(res, 400, { error: { message: 'ungueltiges JSON' } });
      }
      if (body.stream) return streamChunks(body, res);
      return sendJson(res, 200, completion(body));
    });
    return undefined;
  }
  return sendJson(res, 404, { error: { message: 'unbekannter pfad: ' + url.pathname } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[light-upstream] bereit auf 127.0.0.1:' + PORT + ' (offline-stub, kein echtes modell)');
});
