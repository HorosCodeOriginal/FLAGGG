// main.js — Electron-Hülle für Astra Harness
// lädt die Web-App und stellt genau EINE API bereit: das eigene Gateway,
// mit dem Astra-Modell. Schlüssel: data/astra-key.txt oder aus der Registry.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const taskqueue = require('./taskqueue');
const { QueueClient } = require('./taskqueue/client');
const { sendChatWithRetry } = require('./lib/chat-retry');
const { TaskBroadcaster } = require('./lib/task-broadcast');
const { createRoleChat } = require('./lib/role-chat');
const { scriptedTransport } = require('./lib/scripted-chat');
const { liveStubTransport } = require('./lib/live-stub');
const { createDeskWriter } = require('./lib/desk-writer');

const ROOT = __dirname;
const REGISTRY = path.join(ROOT, '..', 'fr-gateway', 'secrets', 'registry.json');
const DESK_FILE = path.join(ROOT, 'data', 'desk.json');
const MARK = path.join(ROOT, 'assets', 'mark.jpg');
const ASTRA_MODEL = process.env.ASTRA_MODEL || 'gpt-6-astra';
const KEY_FILE = path.join(ROOT, 'data', 'astra-key.txt');
const TOKEN_LIMIT = 2000000;

// einziger Schreiber fuer desk.json (mutex + atomar)
const deskWriter = createDeskWriter({ file: DESK_FILE });

// Ein Key = genau ein Modell. Unter einem astra-Key wird ausschließlich das
// astra-Modell betrachtet; alle anderen vom Upstream gelisteten Modelle
// (opus, oc/*, lgw/*, ...) werden ignoriert.
const FAMILY_MODEL = ASTRA_MODEL;
function ownModels(ids) {
  return (Array.isArray(ids) ? ids : []).filter(id => id === FAMILY_MODEL);
}

// ---------------------------------------------------------------------------
// die eine Gateway-API: aus der Registry lesen (bevorzugt Familie astra)
// ---------------------------------------------------------------------------
function gatewayEnv() {
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
    if (!Array.isArray(data)) return null;
    // 1) Eintrag, der zum eigenen Key (astra-key.txt) gehört
    const ck = customKey();
    let e = null;
    if (ck) e = data.find(x => x && (x.unique_key === ck || x.raw_key === ck));
    // 2) sonst bevorzugt Familie astra
    if (!e) e = data.find(x => x && /astra/i.test(x.model_family || ''));
    // 3) Fallback: erster Eintrag
    if (!e) e = data.find(x => x && Number(x.nr) === 1) || data[0];
    if (!e || !e.port || !e.unique_key) return null;
    return e;
  } catch (err) {
    console.error('[astra] registry lesefehler:', err.message);
    return null;
  }
}

function maskKey(key) {
  if (!key) return '(kein token)';
  return key.slice(0, 6) + '•••' + key.slice(-4);
}

function customKey() {
  try {
    const v = fs.readFileSync(KEY_FILE, 'utf-8').trim();
    return v || null;
  } catch (err) {
    return null;
  }
}

function claudeInfo() {
  const e = gatewayEnv();
  if (!e) return { ok: false, error: 'registry/token nicht gefunden (fr-gateway läuft? start-fr-gateway.bat)', model: ASTRA_MODEL };
  const token = customKey() || e.unique_key;
  return {
    ok: true,
    nr: e.nr,
    port: e.port,
    family: e.model_family || 'astra',
    model: ASTRA_MODEL,
    container: e.container || '',
    token,
    masked: maskKey(token),
  };
}

function publicClaude(info) {
  if (!info || !info.ok) return info || { ok: false, error: 'kein token' };
  return { ok: true, nr: info.nr, port: info.port, family: info.family, model: info.model, masked: info.masked };
}

// ---------------------------------------------------------------------------
// Failover: weitere Harness-Instanzen (registry-einträge) und upstream-pool
// ---------------------------------------------------------------------------
function loadRegistry() {
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

function defaultFailover() {
  return {
    enabled: true,
    thresholdPct: 15,
    hysteresisPct: 10,
    sticky: true,
    preferFamily: 'astra',
    activeNr: null,
    instances: [],
  };
}

function publicInstances() {
  const primary = gatewayEnv();
  return loadRegistry()
    .filter(e => e && e.unique_key && e.port && (!primary || e.nr !== primary.nr))
    .map(e => ({
      nr: e.nr,
      port: e.port,
      family: e.model_family || 'unknown',
      masked: maskKey(e.unique_key),
      limit: e.limit_override || 2000000,
      enabled: false,
    }))
    .sort((a, b) => a.nr - b.nr);
}

// resolveRoute(): primär oder failover-ziel anhand der gespeicherten konfiguration
function resolveRoute() {
  const primary = gatewayEnv();
  if (!primary) return null;
  const desk = loadDesk();
  const fo = desk.failover || defaultFailover();
  const viaPrimary = { entry: primary, via: 'primary', activeNr: primary.nr };
  if (!fo.enabled || fo.activeNr == null) return viaPrimary;
  const target = loadRegistry().find(e => e && Number(e.nr) === Number(fo.activeNr) && e.unique_key && e.port);
  if (!target) return viaPrimary;
  if (fo.preferFamily === 'astra' && target.model_family !== 'astra') return viaPrimary;
  return { entry: target, via: 'failover', activeNr: target.nr };
}

function loadDesk() {
  try {
    const data = JSON.parse(fs.readFileSync(DESK_FILE, 'utf8'));
    return {
      spaces: Array.isArray(data.spaces) ? data.spaces : [],
      roles: Array.isArray(data.roles) ? data.roles : [],
      keys: Array.isArray(data.keys) ? data.keys : [],
      sessionTokens: Number(data.sessionTokens) || 0,
      failover: data.failover && typeof data.failover === 'object'
        ? Object.assign(defaultFailover(), data.failover)
        : defaultFailover(),
    };
  } catch (e) {
    return { spaces: [], roles: [], keys: [], sessionTokens: 0, failover: defaultFailover() };
  }
}

function saveDesk(data) {
  // alle Schreibzugriffe laufen serialisiert ueber den DeskWriter (tmp + rename)
  return deskWriter.save(data);
}

function mutateDesk(fn) {
  return deskWriter.mutate(fn);
}

function dockerUsage(container) {
  return new Promise(resolve => {
    if (!container) return resolve(null);
    const { execFile } = require('child_process');
    execFile('docker', ['exec', container, 'cat', '/var/lib/fr-gateway-counter/counter.json'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const n = Number(JSON.parse(String(stdout)).tokens);
        resolve(Number.isFinite(n) ? n : null);
      } catch (e) { resolve(null); }
    });
  });
}

// ---------------------------------------------------------------------------
// Gateway-Client (nur localhost, Bearer = Gateway-Token)
// ---------------------------------------------------------------------------
const streams = new Map(); // key -> AbortController

function gwRequest(info, method, apiPath, body, onData, onEnd, onError) {
  const req = http.request({
    host: '127.0.0.1',
    port: info.port,
    path: apiPath,
    method,
    headers: {
      Authorization: 'Bearer ' + info.token,
      'Content-Type': 'application/json',
    },
    timeout: 300000,
  }, res => {
    if (res.statusCode !== 200) {
      let errBody = '';
      res.on('data', c => { errBody += c; });
      res.on('end', () => {
        let msg = errBody.slice(0, 300);
        try { const j = JSON.parse(errBody); if (j.error) msg = j.error.message || JSON.stringify(j.error); } catch (e) {}
        onError({ status: res.statusCode, message: msg });
      });
      return;
    }
    let buf = '';
    res.setEncoding('utf-8');
    res.on('data', chunk => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try { onData(JSON.parse(payload)); } catch (e) { /* unvollständig */ }
      }
    });
    res.on('end', () => onEnd());
    res.on('error', err => onError({ status: 0, message: err.message }));
  });
  req.on('timeout', () => { req.destroy(new Error('timeout')); onError({ status: 0, message: 'Zeitüberschreitung des Streams' }); });
  req.on('error', err => { if (err.name !== 'AbortError') onError({ status: 0, message: err.message }); });
  if (body) req.write(JSON.stringify(body));
  req.end();
  return req;
}

// ---------------------------------------------------------------------------
// Team / Führungsrolle: zwei Modelle (Planer + Prüfer) sprechen miteinander
// ---------------------------------------------------------------------------
const teams = new Map();

function teamEnv(pattern) {
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
    if (!Array.isArray(data)) return null;
    return data.find(x => x && pattern.test(x.model_family || '')) || data.find(x => x && Number(x.nr) === 1) || data[0] || null;
  } catch (err) {
    return null;
  }
}

function gwOnce(info, model, sys, user) {
  return new Promise(resolve => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      stream: false,
      max_tokens: 2048,
    });
    const started = Date.now();
    const req = http.request({
      host: '127.0.0.1',
      port: info.port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + info.token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const j = JSON.parse(out);
            const t = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
            resolve({ text: t, usage: j.usage, ms: Date.now() - started });
          } catch (e) {
            resolve({ error: 'parse: ' + e.message });
          }
        } else {
          let m = out.slice(0, 160);
          try { const j = JSON.parse(out); if (j.error) m = j.error.message || JSON.stringify(j.error); } catch (e) {}
          resolve({ error: m });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Zeitüberschreitung' }); });
    req.on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fenster
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b1220',
    title: 'Astra Harness',
    icon: fs.existsSync(MARK) ? MARK : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.loadFile(path.join(ROOT, 'index.html'));
  win.once('ready-to-show', () => {
    // Wunsch: Die Astra Harness startet IMMER minimiert (nur Taskleiste).
    // showInactive() verhindert Fokus-Klau, minimize() legt sie in die Taskleiste.
    win.showInactive();
    win.minimize();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ---------------------------------------------------------------------------
// IPC — genau eine API: Gateway (Claude/Opus)
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('astro:info', () => publicClaude(claudeInfo()));

  // listEnvs: nur die eine Gateway-API, damit die App genau diese API kennt
  ipcMain.handle('astro:envs', () => {
    const info = claudeInfo();
    if (!info.ok) return [];
    return [{
      nr: info.nr,
      port: info.port,
      model_family: info.family,
      state: 'running',
      container: info.container,
      unique_key: info.masked,
      limit_override: null,
    }];
  });

  ipcMain.handle('chat:models', async () => {
    const info = claudeInfo();
    if (!info.ok) return [];
    return new Promise(resolve => {
      http.get({
        host: '127.0.0.1',
        port: info.port,
        path: '/v1/models',
        headers: { Authorization: 'Bearer ' + info.token },
        timeout: 8000,
      }, res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try {
            const ids = (JSON.parse(body).data || []).map(m => m.id);
            // nur das eigene Familien-Modell — keine fremden Modelle
            resolve(ownModels(ids));
          }
          catch (e) { resolve([]); }
        });
      }).on('error', () => resolve([]));
    });
  });

  // Kandidaten: aktuell geroutete Instanz zuerst, dann enabled failover-instancen nach Prioritaet
  function chatCandidates() {
    const route = resolveRoute();
    if (!route) return [];
    const list = [{ entry: route.entry, via: route.via }];
    const desk = loadDesk();
    const fo = desk.failover || defaultFailover();
    if (fo.enabled && Array.isArray(fo.instances)) {
      const reg = loadRegistry();
      fo.instances
        .filter(i => i && i.enabled)
        .sort((a, b) => (Number(a.priority) || 50) - (Number(b.priority) || 50))
        .forEach(i => {
          const e = reg.find(x => x && Number(x.nr) === Number(i.nr) && x.unique_key && x.port);
          if (e && !list.some(c => Number(c.entry.nr) === Number(e.nr))) {
            list.push({ entry: e, via: 'failover' });
          }
        });
    }
    return list;
  }

  // genau eine Anfrage gegen eine Instanz; retry-faehig nur solange kein Token geflossen ist
  function chatAttempt(candidate, body, send, ctrl) {
    const info = Object.assign({}, claudeInfo(), {
      ok: true,
      nr: candidate.entry.nr,
      port: candidate.entry.port,
      family: candidate.entry.model_family || 'astra',
      container: candidate.entry.container || '',
      token: candidate.entry.unique_key,
    });
    return new Promise((resolve, reject) => {
      let streamed = false;
      let lastModel = body.model;
      let lastUsage = null;
      const req = gwRequest(info, 'POST', '/v1/chat/completions', body,
        j => {
          if (j.model) lastModel = j.model;
          if (j.usage) lastUsage = j.usage;
          const delta = j.choices && j.choices[0] && j.choices[0].delta;
          const text = (delta && (delta.content || delta.reasoning_content)) || '';
          if (text) {
            streamed = true;
            send('chat:token', { nr: info.nr, delta: text });
          }
        },
        async () => {
          const added = lastUsage ? Number(lastUsage.total_tokens) ||
            ((Number(lastUsage.prompt_tokens) || 0) + (Number(lastUsage.completion_tokens) || 0)) : 0;
          if (added) {
            // load-modify-write unter dem Desk-Mutex
            mutateDesk(desk => {
              desk.sessionTokens = (Number(desk.sessionTokens) || 0) + added;
            });
          }
          const counter = await dockerUsage(info.container);
          send('chat:done', { nr: info.nr, model: lastModel, usage: lastUsage, counter: counter, via: candidate.via });
          resolve({ info, model: lastModel, usage: lastUsage });
        },
        err => {
          const e = new Error(err.message || 'unbekannter fehler');
          e.status = err.status || 0;
          if (streamed) e.retryable = false; // nach dem ersten Token kein Failover mehr
          reject(e);
        }
      );
      if (ctrl) ctrl.signal.addEventListener('abort', () => { try { req.destroy(); } catch (e2) {} });
    });
  }

  ipcMain.handle('chat:send', (event, payload) => {
    const candidates = chatCandidates();
    if (!candidates.length) return { error: 'registry/token nicht gefunden (fr-gateway läuft? start-fr-gateway.bat)' };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { error: 'kein fenster' };

    const body = {
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      stream: true,
    };
    const model = payload.model;
    if (model) body.model = model;
    const p = payload.params || {};
    if (typeof p.temperature === 'number') body.temperature = p.temperature;
    if (typeof p.top_p === 'number') body.top_p = p.top_p;
    if (typeof p.max_tokens === 'number') body.max_tokens = p.max_tokens;
    body.stream_options = { include_usage: true };

    const key = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const ctrl = new AbortController();
    streams.set(key, ctrl);
    const send = (ch, data) => { if (!win.isDestroyed()) win.webContents.send(ch, data); };

    sendChatWithRetry({
      candidates,
      maxAttempts: 3,
      maxRounds: 2,
      cooldownMs: 30000,
      onCooldown: info => send('chat:cooldown', { nr: candidates[0].entry.nr, waitMs: info.waitMs, round: info.round }),
      attempt: candidate => chatAttempt(candidate, body, send, ctrl),
    }).then(outcome => {
      // failover-treffer sticky machen, rueckkehr zum primary aufheben
      const viaFailover = outcome.candidate.via === 'failover';
      mutateDesk(desk => {
        desk.failover = Object.assign(defaultFailover(), desk.failover || {});
        desk.failover.activeNr = viaFailover ? outcome.candidate.entry.nr : null;
      });
    }).catch(err => {
      send('chat:error', {
        nr: candidates[0].entry.nr,
        status: err.status || 0,
        message: err.message,
      });
    }).finally(() => {
      streams.delete(key);
    });

    return { ok: true, key, attempts: candidates.length };
  });

  ipcMain.handle('usage:get', async () => {
    const route = resolveRoute();
    const desk = loadDesk();
    const counter = route ? await dockerUsage(route.entry.container) : null;
    const used = counter == null ? desk.sessionTokens : counter;
    return {
      ok: true,
      used: used,
      limit: TOKEN_LIMIT,
      source: counter == null ? 'session' : 'counter',
      via: route ? route.via : 'primary',
      activeNr: route ? route.activeNr : null,
    };
  });

  // failover: weitere instanzen + upstream-pool (config im desk.json)
  ipcMain.handle('failover:list', () => publicInstances());
  ipcMain.handle('failover:get', () => loadDesk().failover || defaultFailover());
  ipcMain.handle('failover:save', (_e, conf) => {
    const next = Object.assign(defaultFailover(), conf || {});
    next.instances = Array.isArray(next.instances) ? next.instances.map((item, i) => ({
      nr: Number(item.nr),
      enabled: !!item.enabled,
      priority: Number(item.priority) || (i + 1) * 10,
      maxTokens: Math.max(64, Number(item.maxTokens) || 1200),
      temperature: Math.min(1.5, Math.max(0, Number(item.temperature) || 0.4)),
    })) : [];
    mutateDesk(desk => { desk.failover = next; });
    return next;
  });
  // upstream-pool: kommt aus fr-gateway (panel /api/upstreams)
  ipcMain.handle('upstreams:list', async () => {
    try {
      const res = await fetch('http://127.0.0.1:8090/api/upstreams');
      if (!res.ok) throw new Error('panel http ' + res.status);
      return await res.json();
    } catch (e) {
      return { upstreams: [], error: e.message };
    }
  });

  // tasks: SQLite-Queue fuer die Rollen-Kommunikation
  function requireQueue() {
    if (!queue) throw new Error('task-queue nicht verfuegbar (sqlite)');
    return queue;
  }
  ipcMain.handle('tasks:enqueue', async (_e, task) => {
    try {
      const created = await requireQueue().enqueue(task);
      const denied = created && created.task && created.task.state === 'failed';
      return Object.assign({ ok: !denied, code: denied ? 'UNAUTHORIZED' : null }, created);
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || 'TASK_ERROR' };
    }
  });
  ipcMain.handle('tasks:claim', async (_e, roleId) => {
    try {
      return { ok: true, task: await requireQueue().claimNextTask(roleId) };
    } catch (err) {
      return { ok: false, error: err.message, task: null };
    }
  });
  ipcMain.handle('tasks:state', async (_e, payload) => {
    try {
      const p = payload || {};
      return { ok: true, task: await requireQueue().updateState(p.taskId, p.state, p) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || 'TASK_ERROR', task: null };
    }
  });
  ipcMain.handle('tasks:list', async (_e, filter) => {
    try {
      return { ok: true, tasks: await requireQueue().listTasks(filter) };
    } catch (err) {
      return { ok: false, error: err.message, tasks: [] };
    }
  });
  ipcMain.handle('tasks:events', async (_e, taskId) => {
    try {
      return { ok: true, events: await requireQueue().events(taskId) };
    } catch (err) {
      return { ok: false, error: err.message, events: [] };
    }
  });
  ipcMain.handle('tasks:stats', async () => {
    try {
      return { ok: true, counts: await requireQueue().countByState() };
    } catch (err) {
      return { ok: false, error: err.message, counts: [] };
    }
  });

  function pingModel(info, model) {
    return new Promise(resolve => {
      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        stream: false,
      });
      const started = Date.now();
      const req = http.request({
        host: '127.0.0.1',
        port: info.port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + info.token,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 12000,
      }, res => {
        let out = '';
        res.on('data', c => { out += c; });
        res.on('end', () => {
          const ms = Date.now() - started;
          if (res.statusCode === 200) {
            resolve({ model, ok: true, ms });
          } else {
            let msg = out.slice(0, 120);
            try { const j = JSON.parse(out); if (j.error) msg = j.error.message || JSON.stringify(j.error); } catch (e) {}
            resolve({ model, ok: false, ms, error: msg });
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); resolve({ model, ok: false, ms: 12000, error: 'Zeitüberschreitung' }); });
      req.on('error', err => resolve({ model, ok: false, ms: Date.now() - started, error: err.message }));
      req.write(body);
      req.end();
    });
  }

  async function pingAll(info, models) {
    const out = [];
    const concurrency = 3;
    let i = 0;
    async function worker() {
      while (i < models.length) {
        const model = models[i++];
        out.push(await pingModel(info, model));
      }
    }
    const workers = [];
    for (let w = 0; w < Math.min(concurrency, models.length); w++) workers.push(worker());
    await Promise.all(workers);
    return out;
  }

  ipcMain.handle('prefs:check', async () => {
    const info = claudeInfo();
    if (!info.ok) return { ok: false, error: info.error };
    const ids = await new Promise(resolve => {
      http.get({
        host: '127.0.0.1',
        port: info.port,
        path: '/v1/models',
        headers: { Authorization: 'Bearer ' + info.token },
        timeout: 15000,
      }, res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            let msg = body.slice(0, 200);
            try { const j = JSON.parse(body); if (j.error) msg = j.error.message || JSON.stringify(j.error); } catch (e) {}
            return resolve({ error: msg });
          }
          try { resolve({ ids: (JSON.parse(body).data || []).map(m => m.id) }); }
          catch (e) { resolve({ error: 'Antwort nicht lesbar: ' + e.message }); }
        });
      }).on('error', err => resolve({ error: err.message }));
    });
    if (ids.error) return { ok: false, error: ids.error };
    // Nur das eigene Familien-Modell prüfen. Weitere verfügbare Modelle zählen nicht.
    const own = ownModels(ids.ids);
    if (!own.length) {
      return { ok: false, error: 'Modell ' + FAMILY_MODEL + ' nicht verfügbar', expected: FAMILY_MODEL, models: [] };
    }
    const pings = await pingAll(info, own);
    const okCount = pings.filter(p => p.ok).length;
    return { ok: true, models: own, expected: FAMILY_MODEL, pings, okCount, total: pings.length };
  });

  ipcMain.handle('spaces:list', () => loadDesk().spaces);
  ipcMain.handle('spaces:save', (_e, item) => {
    let saved = [];
    mutateDesk(desk => {
      const spaces = desk.spaces.filter(s => s && s.id !== item.id);
      spaces.unshift(item);
      desk.spaces = spaces.slice(0, 40);
      saved = desk.spaces;
    });
    return saved;
  });

  // Rollen inkl. zugewiesenem Key/Port (fuer die Anzeige im UI)
  function rolesWithKeyInfo() {
    const desk = loadDesk();
    const reg = loadRegistry();
    const keys = Array.isArray(desk.keys) ? desk.keys : [];
    return (desk.roles || []).map(role => {
      const key = keys.find(k => k && k.assignedToRole === role.id);
      const entry = key ? reg.find(e => e && Number(e.nr) === Number(key.nr)) : null;
      return Object.assign({}, role, {
        keyInfo: key ? {
          id: key.id,
          masked: maskKey(entry ? entry.unique_key : ''),
          port: key.port || (entry && entry.port) || null,
        } : null,
      });
    });
  }

  ipcMain.handle('roles:list', () => rolesWithKeyInfo());
  ipcMain.handle('roles:save', (_e, item) => {
    let saved = [];
    mutateDesk(desk => {
      const roles = desk.roles.filter(r => r && r.id !== item.id);
      roles.unshift(item);
      desk.roles = roles.slice(0, 40);
      saved = desk.roles;
    }).then(() => { if (queue) queue.setPolicy(loadDesk().roles || []).catch(() => {}); });
    return saved;
  });
  ipcMain.handle('roles:create', (_e, input) => {
    try {
      let created = null;
      mutateDesk(desk => {
        created = taskqueue.createRole(desk, loadRegistry(), input || {});
      }).then(() => { if (queue) queue.setPolicy(loadDesk().roles || []).catch(() => {}); });
      // UI-Felder ergaenzen, damit die bestehende Rollen-Ansicht weiter funktioniert
      const uiRole = Object.assign({
        mandate: '', voice: '', bounds: '', skills: [], tasks: [], automations: [],
        workPath: '', workLocked: false, rolePath: '', rolePathLocked: false, alive: false, thread: [],
      }, created.role, {
        keyInfo: created.key ? { id: created.key.id, masked: created.key.masked, port: created.key.port } : null,
      });
      return { ok: true, role: uiRole, key: created.key };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('orchestrator:status', () => (orchestrator ? orchestrator.status() : []));

  ipcMain.handle('chat:stop', (_e, payload) => {
    const ctrl = streams.get(payload && payload.key);
    if (ctrl) { ctrl.abort(); streams.delete(payload.key); }
    return { ok: true };
  });

  ipcMain.handle('team:info', () => {
    const P = teamEnv(/astra/i);
    const R = teamEnv(/claude|opus/i);
    return {
      planner: P ? { ok: true, nr: P.nr, port: P.port, family: P.model_family || 'astra', model: 'gpt-6-astra', masked: maskKey(P.unique_key) } : { ok: false, error: 'Astra-Eintrag fehlt' },
      reviewer: R ? { ok: true, nr: R.nr, port: R.port, family: R.model_family || 'opus', model: 'claude-opus-5.5', masked: maskKey(R.unique_key) } : { ok: false, error: 'Opus-Eintrag fehlt' },
    };
  });

  ipcMain.handle('team:send', (event, payload) => {
    const task = String((payload && payload.task) || '').trim();
    if (!task) return { error: 'keine Aufgabe' };
    const rounds = Math.min(Math.max(Number((payload && payload.rounds) || 3), 1), 5);
    const P = teamEnv(/astra/i);
    const R = teamEnv(/claude|opus/i);
    if (!P) return { error: 'Astra-Gateway-Eintrag fehlt (Registry?)' };
    if (!R) return { error: 'Opus-Gateway-Eintrag fehlt (Registry?)' };
    const win = BrowserWindow.fromWebContents(event.sender);
    const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
    const key = 'team_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const ctrl = new AbortController();
    teams.set(key, ctrl);

    (async () => {
      try {
        let feedback = '';
        let final = null;
        for (let r = 1; r <= rounds; r++) {
          if (ctrl.signal.aborted) return;
          const sysP = 'Du bist der Planer in einem Zwei-Modell-Team. Erarbeite einen präzisen Entwurf für die Aufgabe. Antworte auf Deutsch.';
          const usrP = 'Aufgabe: ' + task + (feedback ? '\n\nFeedback des Prüfers:\n' + feedback : '');
          const draft = await gwOnce(P, 'gpt-6-astra', sysP, usrP);
          if (draft.error) { send('team:error', { key, error: draft.error }); return; }
          const sysR = 'Du bist der Prüfer/Kritiker. Prüfe den Entwurf kritisch und gib konkretes, kurzes Verbesserungsfeedback. Wenn er gut genug ist, antworte nur mit: AKZEPTIERT';
          const usrR = 'Entwurf:\n' + draft.text;
          const rev = await gwOnce(R, 'claude-opus-5.5', sysR, usrR);
          if (rev.error) { send('team:error', { key, error: rev.error }); return; }
          const accepted = /akzeptiert/i.test(rev.text);
          send('team:round', { key, round: r, rounds, planner: draft.text, reviewer: rev.text, accepted });
          feedback = rev.text;
          if (accepted) { final = { round: r, accepted: true }; break; }
        }
        send('team:done', { key, final: final || { round: rounds, accepted: false } });
      } finally {
        teams.delete(key);
      }
    })();

    return { ok: true, key };
  });

  ipcMain.handle('team:stop', (_e, payload) => {
    const ctrl = teams.get(payload && payload.key);
    if (ctrl) { ctrl.abort(); teams.delete(payload.key); }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Task-Queue + desk.json-v2 (Runtime-Store ist SQLite, desk bleibt statisch)
// ---------------------------------------------------------------------------
let queue = null;
let broadcaster = null;
let orchestrator = null;

function broadcastToWindows(channel, payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  });
}

// --live-test: headless Zwei-Agenten-Lauf ohne GUI. Beweist die Kette
// Boss -> delegate -> Sub -> ToolRunner -> child_result -> Boss -> done.
// Der Transport ist gescriptet (der Upstream liefert aktuell 429); mit
// LIVE_TEST_TRANSPORT=real wird der echte Gateway-Chat benutzt.
async function runLiveTest() {
  const seconds = Math.max(5, Number(process.env.LIVE_TEST_SECONDS) || 60);
  const useReal = String(process.env.LIVE_TEST_TRANSPORT || 'scripted') === 'real';
  console.log('[live-test] modus: ' + (useReal ? 'real (gateway)' : 'scripted (deterministisch)') + ' | dauer: ' + seconds + 's');

  // desk.json validieren/migrieren
  try {
    const raw = fs.existsSync(DESK_FILE) ? JSON.parse(fs.readFileSync(DESK_FILE, 'utf8')) : {};
    const { desk, migrated } = taskqueue.migrateDesk(raw, {});
    console.log('[live-test] desk-check: raw-rollen=' + ((raw.roles || []).length) + ' migrated=' + migrated + ' ziel-rollen=' + desk.roles.length);
    if (migrated) deskWriter.save(desk);
  } catch (err) {
    console.error('[live-test] desk.json ungueltig: ' + err.message);
    app.exit(1);
    return;
  }

  const deskRoles = loadDesk().roles || [];
  if (!deskRoles.length) {
    console.error('[live-test] desk.json enthaelt keine Rollen - bitte zuerst: node scripts/seed-live-test.js');
    app.exit(1);
    return;
  }
  console.log('[live-test] desk-rollen: ' + deskRoles.map(r => r.id).join(', '));

  let client = null;
  let orch = null;
  try {
    const dbFile = path.join(app.getPath('userData'), 'astra-tasks.sqlite');
    client = new QueueClient(dbFile);
    client.onStatus(status => console.log('[live-test] queue ' + status.state));
    await client.ready(20000);
    await client.setPolicy(loadDesk().roles || []);

    orch = new taskqueue.Orchestrator({
      deskStore: { load: loadDesk, save: saveDesk, mutate: mutateDesk },
      registryStore: { load: loadRegistry },
      queue: client,
      policy: taskqueue.createPolicy(() => loadDesk().roles || []),
      transport: useReal ? createRoleChat({ logger: console }) : scriptedTransport(),
      pollMs: 250,
      synthMs: 5000,
      logger: console,
    });
    const booted = orch.startAll();
    console.log('[live-test] rollen: ' + booted.started + '/' + booted.total);
    console.log('[live-test] laeuft ...');

    // Ziel-Task feuern. better-sqlite3 ist gegen die Electron-ABI gebaut:
    // fire-test-task.js startet sich deshalb selbst mit ELECTRON_RUN_AS_NODE.
    try {
      const { spawnSync } = require('child_process');
      const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist',
        process.platform === 'win32' ? 'electron.exe' : 'electron');
      const fireScript = path.join(ROOT, 'scripts', 'fire-test-task.js');
      const fire = spawnSync(electronBin, [fireScript, '--db', dbFile], {
        stdio: 'inherit',
        env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
      });
      if (fire.status !== 0) {
        console.error('[live-test] fire-test-task fehlgeschlagen: ' + fire.status);
      }
    } catch (err) {
      console.error('[live-test] fire-test-task start fehlgeschlagen: ' + err.message);
    }

    await new Promise(resolve => setTimeout(resolve, seconds * 1000));

    const tasks = await client.listTasks({ limit: 100 });
    const counts = {};
    tasks.forEach(t => { counts[t.state] = (counts[t.state] || 0) + 1; });
    console.log('[live-test] task-status: ' + JSON.stringify(counts));
    tasks.filter(t => String(t.request_id || '').startsWith('live-')).forEach(t => {
      const result = t.result && typeof t.result === 'object' ? JSON.stringify(t.result).slice(0, 200) : String(t.result || '');
      console.log('[live-test] ' + t.request_id + ' -> ' + t.state + (result ? ' | ' + result : ''));
    });

    const sub = (loadDesk().roles || []).find(r => r && r.id === 'sub_opus');
    if (sub && sub.workspace) {
      const script = path.join(sub.workspace, 'hallo.py');
      if (fs.existsSync(script)) {
        console.log('[live-test] hallo.py: ' + JSON.stringify(fs.readFileSync(script, 'utf8')));
      } else {
        console.log('[live-test] hallo.py fehlt in ' + sub.workspace);
        process.exitCode = 1;
      }
    } else {
      console.error('[live-test] rolle sub_opus nicht gefunden - live-test unvollstaendig');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('[live-test] fehler: ' + err.message);
    process.exitCode = 1;
  } finally {
    try { if (orch) orch.stopAll(); } catch (e) { /* egal */ }
    try { if (client) client.close(); } catch (e) { /* egal */ }
    app.exit(process.exitCode || 0);
  }
}

function initDeskAndQueue() {
  // desk.json auf v2 heben (Rollen-Registry mit Hierarchie/Keys)
  try {
    const raw = fs.existsSync(DESK_FILE) ? JSON.parse(fs.readFileSync(DESK_FILE, 'utf8')) : {};
    const { desk, migrated } = taskqueue.migrateDesk(raw, {});
    if (migrated) {
      deskWriter.save(desk);
      console.log('[desk] auf v3 migriert (' + desk.roles.length + ' Rollen, Graph-Modell)');
    }
  } catch (err) {
    console.error('[desk] migration fehlgeschlagen:', err.message);
  }

  // SQLite-Queue laeuft in einem eigenen Node-Prozess (better-sqlite3 ist
  // im Electron-33-Main-Prozess nicht lauffaehig -> harter Crash beim Open).
  return (async () => {
    try {
      const dbFile = path.join(app.getPath('userData'), 'astra-tasks.sqlite');
      const client = new QueueClient(dbFile);
      client.onStatus(status => {
        broadcastToWindows('queue:status', status);
        console.log('[tasks] queue ' + status.state + (status.candidate ? ' via ' + status.candidate : '') +
          (status.error ? ' (' + status.error + ')' : ''));
      });
      await client.ready(20000);
      queue = client;
      // Graph-Berechtigungen in den Worker spiegeln
      await client.setPolicy(loadDesk().roles || []);
      console.log('[tasks] sqlite-store bereit: ' + dbFile);

      // Live-Stream: neue task_events -> 'task:event' an alle Fenster
      broadcaster = new TaskBroadcaster({
        queue: client,
        send: broadcastToWindows,
        intervalMs: 1000,
      });
      broadcaster.start();
      console.log('[tasks] live-stream aktiv (task:event)');

      // Orchestrator: aktive Rollen aus der desk.json -> AgentRuntime je Rolle
      try {
        // Transport fuer den Agent-Graphen: Stub (deterministisch) oder echtes LLM.
        // Default ist stub, weil der Upstream aktuell 429 liefert (der Gateway
        // antwortet dann nur mit dem Light-Upstream ohne Tool-Calls). Mit
        // ASTRA_TRANSPORT=real wird der echte Gateway-Chat benutzt.
        const transportMode = String(process.env.ASTRA_TRANSPORT || 'stub').toLowerCase();
        let agentTransport;
        if (transportMode === 'real') {
          agentTransport = createRoleChat({ logger: console });
          console.log('[orchestrator] transport: real (fr-gateway)');
        } else {
          agentTransport = liveStubTransport({
            log: msg => console.log(msg),
            roles: () => loadDesk().roles || [],
          });
          console.log('[orchestrator] transport: stub (deterministisch) - ASTRA_TRANSPORT=real fuer echtes LLM');
        }
        orchestrator = new taskqueue.Orchestrator({
          deskStore: { load: loadDesk, save: saveDesk, mutate: mutateDesk },
          registryStore: { load: loadRegistry },
          queue: client,
          policy: taskqueue.createPolicy(() => loadDesk().roles || []),
          synthMs: 30000,
          transport: agentTransport,
          pollMs: 1000,
        });
        const booted = orchestrator.startAll();
        console.log('[orchestrator] ' + booted.started + '/' + booted.total + ' rollen aktiv');
        console.log('[orchestrator] synthesizer aktiv (30s)');
      } catch (err) {
        orchestrator = null;
        console.error('[orchestrator] start fehlgeschlagen:', err.message);
      }
    } catch (err) {
      queue = null;
      console.error('[tasks] sqlite nicht verfuegbar:', err.message);
    }
  })();
}

app.whenReady().then(async () => {
  if (process.argv.includes('--live-test')) {
    await runLiveTest();
    return;
  }
  registerIpc();
  await initDeskAndQueue();
  const win = createWindow();

  if (process.argv.includes('--smoke')) {
    console.log('[smoke] boot: ' + new Date().toISOString());
    console.log('[smoke] claude: ' + JSON.stringify(publicClaude(claudeInfo())));
    win.webContents.on('console-message', (_e, level, message) => {
      console.log('[renderer:' + level + '] ' + message);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.log('[fail-load] ' + code + ' ' + desc + ' ' + url);
    });
    win.webContents.on('did-finish-load', () => {
      console.log('[smoke] did-finish-load: ' + new Date().toISOString());
      win.webContents.executeJavaScript('document.title').then(t => {
        console.log('[smoke] title: ' + t);
      });
    });
    await new Promise(r => setTimeout(r, 10000));
    console.log('[smoke] quit');
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    for (const ctrl of streams.values()) {
      try { ctrl.abort(); } catch (_) { /* ignore */ }
    }
    streams.clear();
  } catch (e) { /* ignore */ }
  try {
    for (const ctrl of teams.values()) {
      try { ctrl.abort(); } catch (_) { /* ignore */ }
    }
    teams.clear();
  } catch (e) { /* ignore */ }
  try { if (orchestrator) orchestrator.stopAll(); } catch (e) {}
  try { if (broadcaster) broadcaster.stop(); } catch (e) {}
  try { if (queue && typeof queue.close === 'function') queue.close(); } catch (e) {}
});
