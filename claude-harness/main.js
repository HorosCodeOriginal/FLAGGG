// main.js — Electron-Hülle für Claude Harness
// lädt die Web-App und stellt genau EINE API bereit: das ein-Gateway (wie Astra),
// mit Claude/Opus-Modell. Schlüssel kommt aus der fr-gateway-Registry.
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const REGISTRY = path.join(ROOT, '..', 'fr-gateway', 'secrets', 'registry.json');
const DESK_FILE = path.join(ROOT, 'data', 'desk.json');
const MARK = path.join(ROOT, 'assets', 'mark.jpg');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5.5';
const TOKEN_LIMIT = 2000000;

// Ein Key = genau ein Modell. Unter einem opus-Key wird ausschließlich das
// opus-Modell betrachtet; alle anderen vom Upstream gelisteten Modelle
// (astra, oc/*, lgw/*, ...) werden ignoriert.
const FAMILY_MODEL = CLAUDE_MODEL;
function ownModels(ids) {
  return (Array.isArray(ids) ? ids : []).filter(id => id === FAMILY_MODEL);
}

// ---------------------------------------------------------------------------
// die eine Gateway-API: aus der Registry lesen (bevorzugt Familie claude/opus)
// ---------------------------------------------------------------------------
function gatewayEnv() {
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
    if (!Array.isArray(data)) return null;
    const prefer = data.find(x => x && /claude|opus/i.test(x.model_family || ''));
    const e = prefer || data.find(x => x && Number(x.nr) === 1) || data[0];
    if (!e || !e.port || !e.unique_key) return null;
    return e;
  } catch (err) {
    console.error('[claude] registry lesefehler:', err.message);
    return null;
  }
}

function maskKey(key) {
  if (!key) return '(kein token)';
  return key.slice(0, 6) + '•••' + key.slice(-4);
}

function claudeInfo() {
  const e = gatewayEnv();
  if (!e) return { ok: false, error: 'registry/token nicht gefunden (fr-gateway läuft? start-fr-gateway.bat)', model: CLAUDE_MODEL };
  return {
    ok: true,
    nr: e.nr,
    port: e.port,
    family: e.model_family || 'claude',
    model: CLAUDE_MODEL,
    container: e.container || '',
    token: e.unique_key,
    masked: maskKey(e.unique_key),
  };
}

function publicClaude(info) {
  if (!info || !info.ok) return info || { ok: false, error: 'kein token' };
  return { ok: true, nr: info.nr, port: info.port, family: info.family, model: info.model, masked: info.masked };
}

function loadDesk() {
  try {
    const data = JSON.parse(fs.readFileSync(DESK_FILE, 'utf8'));
    return {
      spaces: Array.isArray(data.spaces) ? data.spaces : [],
      roles: Array.isArray(data.roles) ? data.roles : [],
      sessionTokens: Number(data.sessionTokens) || 0,
    };
  } catch (e) {
    return { spaces: [], roles: [], sessionTokens: 0 };
  }
}

function saveDesk(data) {
  fs.mkdirSync(path.dirname(DESK_FILE), { recursive: true });
  fs.writeFileSync(DESK_FILE, JSON.stringify(data, null, 2), 'utf8');
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
// Fenster
// ---------------------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b1220',
    title: 'Claude Harness',
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
  win.once('ready-to-show', () => win.show());

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

  ipcMain.handle('chat:send', (event, payload) => {
    const info = claudeInfo();
    if (!info.ok) return { error: info.error };
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { error: 'kein fenster' };

    const body = {
      messages: Array.isArray(payload.messages) ? payload.messages : [],
      stream: true,
    };
    const model = payload.model || info.model;
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

    let lastModel = model;
    let lastUsage = null;
    const req = gwRequest(info, 'POST', '/v1/chat/completions', body,
      j => {
        if (j.model) lastModel = j.model;
        if (j.usage) lastUsage = j.usage;
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        const text = (delta && (delta.content || delta.reasoning_content)) || '';
        if (text) send('chat:token', { nr: info.nr, delta: text });
      },
      async () => {
        const added = lastUsage ? Number(lastUsage.total_tokens) || ((Number(lastUsage.prompt_tokens) || 0) + (Number(lastUsage.completion_tokens) || 0)) : 0;
        if (added) {
          const desk = loadDesk();
          desk.sessionTokens += added;
          saveDesk(desk);
        }
        const counter = await dockerUsage(info.container);
        send('chat:done', { nr: info.nr, model: lastModel, usage: lastUsage, counter: counter });
      },
      err => send('chat:error', { nr: info.nr, ...err })
    );
    ctrl.signal.addEventListener('abort', () => req.destroy());

    return { ok: true, key };
  });

  ipcMain.handle('usage:get', async () => {
    const info = claudeInfo();
    const desk = loadDesk();
    const counter = info.ok ? await dockerUsage(info.container) : null;
    const used = counter == null ? desk.sessionTokens : counter;
    return { ok: true, used: used, limit: TOKEN_LIMIT, source: counter == null ? 'session' : 'counter' };
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
    const desk = loadDesk();
    const spaces = desk.spaces.filter(s => s && s.id !== item.id);
    spaces.unshift(item);
    desk.spaces = spaces.slice(0, 40);
    saveDesk(desk);
    return desk.spaces;
  });
  ipcMain.handle('roles:list', () => loadDesk().roles);
  ipcMain.handle('roles:save', (_e, item) => {
    const desk = loadDesk();
    const roles = desk.roles.filter(r => r && r.id !== item.id);
    roles.unshift(item);
    desk.roles = roles.slice(0, 40);
    saveDesk(desk);
    return desk.roles;
  });

  ipcMain.handle('chat:stop', (_e, payload) => {
    const ctrl = streams.get(payload && payload.key);
    if (ctrl) { ctrl.abort(); streams.delete(payload.key); }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  registerIpc();
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
