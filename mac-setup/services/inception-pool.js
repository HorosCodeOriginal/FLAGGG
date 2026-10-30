// language: JavaScript (Node.js 20+), file: inception-pool.js, target: Windows/Linux
// Inception-API-Pool: bündelt mehrere Inception-Keys hinter EINEM
// OpenAI-kompatiblen Endpunkt. Round-Robin, Failover auf 429/401/402,
// Usage-Zähler, /healthz. Keine externen Abhängigkeiten.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = parseInt(process.env.POOL_PORT || '20199', 10);
const UPSTREAM = process.env.POOL_UPSTREAM || 'https://api.inceptionlabs.ai/v1';
const CRED_FILE = process.env.POOL_CRED_FILE || path.join(os.homedir(), '.dsh', '.credentials.yaml');
const KEY_FILE = process.env.POOL_KEY_FILE || ''; // optional: JSON-Array zusätzlicher Keys
const USAGE_FILE = process.env.POOL_USAGE_FILE || path.join(os.homedir(), '.dsh', 'pool-usage.json');
const CHAT_HISTORY_FILE = process.env.POOL_CHAT_HISTORY_FILE || path.join(os.homedir(), '.dsh', 'pool-chat-history.json');
const SYSTEM_PROMPT_FILE = process.env.POOL_CHAT_SYSTEM_FILE || path.join(os.homedir(), '.dsh', 'pool-chat-system.txt');
const TIMEOUT_MS = 120000;

function loadSystemPrompt() {
  try {
    if (fs.existsSync(SYSTEM_PROMPT_FILE)) {
      const t = fs.readFileSync(SYSTEM_PROMPT_FILE, 'utf8').trim();
      if (t) return t;
    }
  } catch {}
  return '';
}
const SYSTEM_PROMPT = loadSystemPrompt();

// ---------- Key-Laden ----------
function loadKeys() {
  const keys = new Set();

  if (KEY_FILE && fs.existsSync(KEY_FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
      arr.filter(k => typeof k === 'string' && k.length > 8).forEach(k => keys.add(k.trim()));
    } catch { /* ignorieren */ }
  }

  if (fs.existsSync(CRED_FILE)) {
    const raw = fs.readFileSync(CRED_FILE, 'utf8');
    const re = /^  ([A-Z0-9_]+):\s*(\S+)/gm;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const name = m[1].toUpperCase();
      const val = m[2].trim();
      // alle Inception-bezogenen + alle weiteren sk_/sk-/atr_ Keys
      if (name.startsWith('INCEPTION') || /^(sk_|sk-|atr_)/.test(val)) {
        keys.add(val);
      }
    }
  }

  const list = [...keys];
  if (list.length === 0) {
    console.error('[pool] KEINE Keys gefunden. CRED_FILE=' + CRED_FILE);
    process.exit(2);
  }
  console.log('[pool] geladene Keys: ' + list.length);
  return list;
}

const KEYS = loadKeys();
let rr = 0;

function nextKey() {
  const k = KEYS[rr % KEYS.length];
  rr++;
  return k;
}

// ---------- Usage-Zähler ----------
function loadUsage() {
  try {
    if (fs.existsSync(USAGE_FILE)) return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {}
  return { requests: 0, prompt_tokens: 0, completion_tokens: 0, by_model: {} };
}
const usage = loadUsage();
let usageDirty = false;
function saveUsage() {
  if (!usageDirty) return;
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2)); usageDirty = false; } catch {}
}

// ---------- Chat-Completion mit Fortsetzungsschleife ----------
const CHAT_MAX_TOKENS = parseInt(process.env.POOL_CHAT_MAX_TOKENS || '4000', 10);
const CHAT_MAX_LOOPS = parseInt(process.env.POOL_CHAT_MAX_LOOPS || '40', 10);

async function chatCompletion(convMessages) {
  const out = await distribute('POST', '/chat/completions', { 'Content-Type': 'application/json' }, JSON.stringify({ model: chatState.model, messages: convMessages, max_tokens: CHAT_MAX_TOKENS }), null);
  let content = '';
  let finish = 'stop';
  let usageInfo = null;
  try {
    const j = JSON.parse(out.body);
    if (j.choices && j.choices[0] && j.choices[0].message) content = j.choices[0].message.content || '';
    if (j.choices && j.choices[0]) finish = j.choices[0].finish_reason || 'stop';
    if (j.usage) usageInfo = j.usage;
  } catch {}
  return { status: out.status, content, finish, usage: usageInfo, raw: out.body };
}

// ---------- Chat-History ----------
function loadChatHistory() {
  try {
    if (fs.existsSync(CHAT_HISTORY_FILE)) {
      const j = JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8'));
      if (Array.isArray(j.messages)) return j;
    }
  } catch {}
  return { messages: [], model: 'mercury-3' };
}
const chatState = loadChatHistory();
function saveChatState() {
  try { fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(chatState, null, 2)); } catch {}
}

const CHAT_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Inception-Pool Chat</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;background:#0f1115;color:#e6e6e6}
h1{font-size:1.2rem;color:#8ab4ff}#log{display:flex;flex-direction:column;gap:.6rem;margin:1rem 0}
.msg{padding:.7rem .9rem;border-radius:10px;white-space:pre-wrap;line-height:1.45}
.user{background:#1b2a4a;align-self:flex-end;max-width:85%}.bot{background:#20242c;align-self:flex-start;max-width:85%}
.meta{font-size:.7rem;color:#777;margin-top:.35rem}form{display:flex;gap:.5rem}
input{flex:1;background:#161a21;border:1px solid #2a2f3a;color:#e6e6e6;padding:.6rem .8rem;border-radius:8px}
button{background:#2b5cff;border:0;color:#fff;padding:.6rem 1rem;border-radius:8px;cursor:pointer}</style></head>
<body><h1>Inception-Pool Chat <button id="new" style="float:right;font-size:.7rem;padding:.25rem .6rem">neuer verlauf</button></h1><div id="meta" style="font-size:.75rem;color:#888;margin-bottom:.5rem">…</div><div id="log"></div>
<form id="f"><input id="i" placeholder="Nachricht…" autocomplete="off"><button>senden</button></form>
<script>
const logEl=document.getElementById('log'),i=document.getElementById('i'),f=document.getElementById('f'),meta=document.getElementById('meta'),nw=document.getElementById('new');
async function load(){const r=await fetch('/chat/history');const j=await r.json();
meta.textContent='Modell: '+j.model+' · Profil: '+(j.system_active?'aktiv':'keins');
for(const m of j.messages){add(m.role,m.content)}logEl.scrollTop=logEl.scrollHeight}
nw.addEventListener('click',async()=>{await fetch('/chat/clear',{method:'POST'});logEl.innerHTML='';load()})
function add(role,content){const d=document.createElement('div');d.className='msg '+(role==='user'?'user':'bot');
d.textContent=content;logEl.appendChild(d)}
f.addEventListener('submit',async e=>{e.preventDefault();const msg=i.value;if(!msg)return;
add('user',msg);i.value='';const r=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})});
const j=await r.json();add('assistant',j.reply||'(leer)');logEl.scrollTop=logEl.scrollHeight});load();
</script></body></html>`;

// ---------- Upstream-Helfer ----------
async function upstreamRequest(method, pathname, headers, body, key, timeoutMs) {
  const u = new URL(UPSTREAM + pathname);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const cleanHeaders = { ...headers };
    // Node-verwaltete/gefährliche Header nicht weiterreichen
    for (const h of ['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding']) {
      delete cleanHeaders[h];
    }
    const resp = await fetch(u.toString(), {
      method,
      headers: {
        ...cleanHeaders,
        'Authorization': 'Bearer ' + key,
        'Accept': 'application/json',
      },
      body: body || undefined,
      signal: ac.signal,
    });
    const text = await resp.text();
    return { status: resp.status, headers: resp.headers, body: text };
  } catch {
    return { status: 0, headers: {}, body: JSON.stringify({ error: { message: 'upstream unreachable', type: 'network_error' } }) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Anfragen-Verteilung ----------
async function distribute(method, pathname, headers, body, rawBody) {
  const attempts = KEYS.length;
  for (let i = 0; i < attempts; i++) {
    const key = nextKey();
    const res = await upstreamRequest(method, pathname, headers, body, key, TIMEOUT_MS);
    if (process.env.POOL_DEBUG === '1') {
      console.error('[pool][debug] key#' + i + ' status=' + res.status + ' body=' + res.body.slice(0, 160));
    }
    if (res.status === 200 || res.status === 201) {
      return { status: res.status, headers: res.headers, body: res.body, key };
    }
    // Failover nur bei Quota-/Auth-/Serverfehlern
    if (res.status === 429 || res.status === 402 || res.status === 401 || res.status === 403 || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 0) {
      continue;
    }
    return { status: res.status, headers: res.headers, body: res.body, key };
  }
  return { status: 503, headers: {}, body: JSON.stringify({ error: { message: 'alle Keys erschöpft (Quota/Fehler)', type: 'pool_exhausted' } }), key: null };
}

// ---------- Usage aus Antwort extrahieren ----------
function recordUsage(body, model) {
  try {
    const j = JSON.parse(body);
    if (j.usage && Number.isFinite(j.usage.prompt_tokens)) {
      usage.requests++;
      usage.prompt_tokens += j.usage.prompt_tokens;
      usage.completion_tokens += j.usage.completion_tokens || 0;
      const m = (model || j.model || 'unknown').toString();
      if (!usage.by_model[m]) usage.by_model[m] = { requests: 0, prompt_tokens: 0, completion_tokens: 0 };
      usage.by_model[m].requests++;
      usage.by_model[m].prompt_tokens += j.usage.prompt_tokens;
      usage.by_model[m].completion_tokens += j.usage.completion_tokens || 0;
      usageDirty = true;
      saveUsage();
    }
  } catch {}
}

// ---------- HTTP-Server ----------
const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  let pathname = req.url || '/';
  if (pathname.includes('?')) pathname = pathname.split('?')[0];

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', keys: KEYS.length, usage }));
    return;
  }
  if (pathname === '/chat' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(CHAT_HTML);
    return;
  }
  if (pathname === '/chat/clear' && method === 'POST') {
    chatState.messages = [];
    saveChatState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messages: 0 }));
    return;
  }
  if (pathname === '/chat/history' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...chatState, system_active: SYSTEM_PROMPT.length > 0 }));
    return;
  }
  if (pathname === '/chat' && method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      let msg = '';
      try { msg = (JSON.parse(Buffer.concat(chunks).toString('utf8')).message || '').toString(); } catch {}
      if (!msg.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'leere nachricht' })); return; }
      chatState.messages.push({ role: 'user', content: msg.trim() });
      if (chatState.messages.length > 40) chatState.messages = chatState.messages.slice(-40);
      const convMessages = SYSTEM_PROMPT
        ? [{ role: 'system', content: SYSTEM_PROMPT }, ...chatState.messages]
        : chatState.messages;
      // Fortsetzungsschleife: bricht die API wegen Länge ab, wird nahtlos weitergeschrieben
      let parts = [];
      let lastStatus = 200;
      let lastRaw = '';
      let usageInfo = { prompt_tokens: 0, completion_tokens: 0 };
      for (let loop = 0; loop < CHAT_MAX_LOOPS; loop++) {
        let work = convMessages;
        if (parts.length > 0) {
          work = [
            ...convMessages,
            { role: 'assistant', content: parts.join('\n') },
            { role: 'user', content: 'Fahre genau dort fort, wo die vorige Antwort abgeschnitten wurde.' },
          ];
        }
        const step = await chatCompletion(work);
        lastStatus = step.status;
        lastRaw = step.raw;
        if (step.usage) {
          usageInfo.prompt_tokens += step.usage.prompt_tokens || 0;
          usageInfo.completion_tokens += step.usage.completion_tokens || 0;
        }
        if (step.content) parts.push(step.content);
        if (lastStatus !== 200 || step.finish !== 'length') break;
      }
      let reply;
      if (lastStatus === 200) {
        reply = parts.join('\n\n') || '(leer)';
      } else {
        reply = 'Pool-Fehler ' + lastStatus + ': ' + lastRaw.slice(0, 200);
      }
      chatState.messages.push({ role: 'assistant', content: reply });
      saveChatState();
      console.log('[pool][chat] ' + lastStatus + ' | reply ' + reply.length + ' Zeichen in ' + parts.length + ' Teilen');
      res.writeHead(lastStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply, usage: usageInfo }));
    });
    return;
  }
  if (pathname === '/v1/models' && method === 'GET') {
    const key = nextKey();
    const up = await upstreamRequest('GET', '/models', {}, null, key, 15000);
    if (up.status === 200) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(up.body);
    } else {
      res.writeHead(up.status || 502, { 'Content-Type': 'application/json' });
      res.end(up.body);
    }
    return;
  }

  // alle anderen Pfade: Body sammeln und verteilen
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const reqHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'authorization') continue;
      reqHeaders[k] = v;
    }
    let model = null;
    try { if (rawBody) model = JSON.parse(rawBody).model || null; } catch {}

    // Upstream endet bereits auf /v1 -> eingehendes /v1-Präfix abziehen
    const upstreamPath = pathname.replace(/^\/v1/, '') || '/';
    const out = await distribute(method, upstreamPath, reqHeaders, rawBody || null, rawBody);
    recordUsage(out.body, model);
    console.log('[pool][req] ' + method + ' ' + pathname + ' -> ' + out.status + ' (key: ' + (out.key ? 'genutzt' : 'keiner') + ')');
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(out.body);
  });
});

server.listen(PORT, () => {
  console.log('[pool] Inception-Pool läuft auf http://127.0.0.1:' + PORT);
  console.log('[pool] Upstream: ' + UPSTREAM);
  console.log('[pool] Keys im Pool: ' + KEYS.length);
});
server.on('error', (e) => { console.error('[pool] Serverfehler: ' + e.message); process.exit(1); });
