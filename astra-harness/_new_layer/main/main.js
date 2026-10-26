// main.js — electron-main: dashboard-fenster + env-fenster je key.
// statischer lokaler http-server (localhost, zufälliger port) serviert renderer + node_modules
// (monaco/xterm laufen so sauber inkl. web-workern).
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const registry = require('./registry');
const chat = require('./chat');
const filesys = require('./files');
const termMod = require('./term');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const PRELOAD = path.join(ROOT, 'preload', 'preload.js');
const PRO = path.resolve(ROOT, '..', 'harness-pro');
const ASTRA_FILE = path.join(ROOT, 'astra.json');

// Familie aus astra.json (astra | opus) — ein Codebestand für alle Klone.
let FAMILY = 'astra';
try {
  const pin = JSON.parse(fs.readFileSync(ASTRA_FILE, 'utf8'));
  if (pin && typeof pin.family === 'string' && pin.family) FAMILY = pin.family;
} catch (e) {}

const PANEL_BASE = 'http://127.0.0.1:8090';

// ---------------------------------------------------------------------------
// statischer http-server
// ---------------------------------------------------------------------------
let serverPort = 0;
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json', '.ttf': 'font/ttf',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function startStaticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (urlPath === '/') urlPath = '/index.html';
      if (urlPath === '/pro' || urlPath === '/pro/') urlPath = '/pro/index.html';
      let filePath;
      if (urlPath.startsWith('/pro/')) {
        filePath = path.resolve(PRO, urlPath.slice('/pro/'.length));
      } else if (urlPath.startsWith('/vendor/')) {
        filePath = path.join(NODE_MODULES, urlPath.slice('/vendor/'.length));
      } else {
        filePath = path.join(RENDERER, urlPath);
      }
      const allow = [RENDERER, NODE_MODULES, PRO].some(function (base) {
        const rel = path.relative(base, filePath);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
      });
      if (!allow) {
        res.writeHead(403); return res.end('forbidden');
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve(server);
    });
  });
}

function pageUrl(page) {
  return `http://127.0.0.1:${serverPort}/${page}`;
}

function createStudioWindow() {
  if (studioWin && !studioWin.isDestroyed()) {
    studioWin.focus();
    return studioWin;
  }
  const uiTest = process.argv.includes('--ui-test');
  studioWin = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#07111f',
    title: 'Astra Harness',
    icon: fs.existsSync(path.join(PRO, 'assets', 'mark.jpg')) ? path.join(PRO, 'assets', 'mark.jpg') : undefined,
    autoHideMenuBar: true,
    show: !uiTest,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (uiTest) attachUiTest(studioWin);
  studioWin.loadURL(pageUrl('pro/index.html'));
  studioWin.on('closed', () => { studioWin = null; });
  return studioWin;
}

function attachUiTest(win) {
  const failures = [];
  win.webContents.on('console-message', (_e, level, message) => {
    const text = String(message);
    if (level >= 3 && text.indexOf('Electron Security Warning') === -1) failures.push(text);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('UI_TEST_FAIL load ' + code + ' ' + desc);
    app.exit(1);
  });
  win.webContents.on('did-finish-load', async () => {
    const script = fs.readFileSync(path.join(PRO, 'ui-test.js'), 'utf8');
    const resultFile = path.join(PRO, 'ui-test-result.txt');
    try {
      const result = await win.webContents.executeJavaScript(script, true);
      if (failures.length) throw new Error(failures.join(' | '));
      fs.writeFileSync(resultFile, 'OK ' + result, 'utf8');
      console.log('UI_TEST_OK ' + result);
      app.exit(0);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      fs.writeFileSync(resultFile, 'FAIL ' + message, 'utf8');
      console.error('UI_TEST_FAIL ' + message);
      app.exit(1);
    }
  });
}

// ---------------------------------------------------------------------------
// fenster
// ---------------------------------------------------------------------------
let dashboardWin = null;
let studioWin = null;
const envWindows = new Map(); // nr -> BrowserWindow
const chatStops = new Map();

function createDashboardWindow() {
  dashboardWin = new BrowserWindow({
    width: 1280, height: 820,
    backgroundColor: '#0a0a0f',
    title: 'fr-harness — dashboard',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  dashboardWin.loadURL(pageUrl('index.html'));
  dashboardWin.on('closed', () => { dashboardWin = null; });
  return dashboardWin;
}

function createEnvWindow(nr) {
  const def = registry.envByNr(nr);
  if (!def) return null;
  if (envWindows.has(nr)) {
    envWindows.get(nr).focus();
    return envWindows.get(nr);
  }
  const win = new BrowserWindow({
    width: 1440, height: 900,
    backgroundColor: '#0a0a0f',
    title: `fr-harness — env ${nr} · :${def.port}`,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(pageUrl('env.html') + `?nr=${nr}`);
  win.on('closed', () => {
    envWindows.delete(nr);
    win._termCleanup && win._termCleanup();
  });
  envWindows.set(nr, win);

  // terminal für diese env booten
  const termState = { alive: false, kill: null };
  win._termCleanup = () => { if (termState.alive) { try { termState.kill && termState.kill(); } catch (e) {} } };
  win.webContents.on('did-finish-load', () => {
    console.log('[main] env:ready send nr=' + nr + ' def=' + JSON.stringify(def && { nr: def.nr, port: def.port, family: def.model_family }));
    win.webContents.send('env:ready', { nr, def });
  });

  const term = termMod.spawnTerminal(nr, data => {
    if (!win.isDestroyed()) win.webContents.send('term:data', { nr, data });
  }, code => {
    if (!win.isDestroyed()) win.webContents.send('term:exit', { nr, code });
  });
  win._term = term.term || null;
  termState.alive = !term.dead;
  termState.kill = () => { try { term.term && term.term.kill(); } catch (e) {} };
  return win;
}

// ---------------------------------------------------------------------------
// ipc
// ---------------------------------------------------------------------------
function ipcSend(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function readAstraPin() {
  try {
    const data = JSON.parse(fs.readFileSync(ASTRA_FILE, 'utf8'));
    if (data && typeof data.key_hash === 'string') return data;
  } catch (e) {}
  return null;
}

function astraEntry() {
  const all = registry.loadRegistry();
  const pin = readAstraPin();
  let entry = null;
  if (pin) entry = all.find(e => e && e.key_hash === pin.key_hash && e.model_family === FAMILY && e.unique_key);
  if (!entry) entry = all.find(e => e && e.model_family === FAMILY && e.unique_key && e.port);
  return entry || null;
}

function maskToken(token) {
  const value = String(token || '');
  if (value.length < 12) return 'token';
  return value.slice(0, 6) + '…' + value.slice(-4);
}

function astraInfo() {
  const entry = astraEntry();
  if (!entry) return { ok: false, error: 'kein ' + FAMILY + ' token' };
  return { ok: true, nr: entry.nr, port: entry.port, family: 'astra', masked: maskToken(entry.unique_key) };
}

function isStudio(event) {
  return !!(studioWin && !studioWin.isDestroyed() && event.sender === studioWin.webContents);
}

const DESK_FILE = path.join(PRO, 'data', 'desk.json');
const TOKEN_LIMIT = 2000000;

let usageCache = { used: 0, at: 0 };

function defaultFailover() {
  return {
    enabled: true,
    thresholdPct: 15,
    hysteresisPct: 10,
    sticky: true,
    preferFamily: FAMILY,
    activeNr: null,
    instances: [],
  };
}

function loadDesk() {
  try {
    const data = JSON.parse(fs.readFileSync(DESK_FILE, 'utf8'));
    return {
      spaces: Array.isArray(data.spaces) ? data.spaces : [],
      roles: Array.isArray(data.roles) ? data.roles : [],
      sessionTokens: Number(data.sessionTokens) || 0,
      failover: data.failover && typeof data.failover === 'object'
        ? Object.assign(defaultFailover(), data.failover)
        : defaultFailover(),
    };
  } catch (e) {
    return { spaces: [], roles: [], sessionTokens: 0, failover: defaultFailover() };
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

function publicInstances() {
  const primary = astraEntry();
  const desk = loadDesk();
  const fo = desk.failover || defaultFailover();
  const byNr = {};
  (fo.instances || []).forEach(item => { byNr[item.nr] = item; });
  return registry.loadRegistry()
    .filter(e => e && e.unique_key && e.port && (!primary || e.nr !== primary.nr))
    .map(e => {
      const conf = byNr[e.nr] || {};
      return {
        nr: e.nr,
        port: e.port,
        family: e.model_family || 'unknown',
        masked: maskToken(e.unique_key),
        limit: e.limit_override || 2000000,
        state: e.state || 'unknown',
        enabled: !!conf.enabled,
        priority: Number(conf.priority) || 50,
        maxTokens: Number(conf.maxTokens) || 1200,
        temperature: typeof conf.temperature === 'number' ? conf.temperature : 0.4,
      };
    })
    .sort((a, b) => a.priority - b.priority || a.nr - b.nr);
}

function resolveFailoverSync() {
  const primary = astraEntry();
  if (!primary) return null;
  const desk = loadDesk();
  const fo = desk.failover || defaultFailover();
  const used = usageCache.used || desk.sessionTokens || 0;
  const remainingPct = Math.max(0, ((TOKEN_LIMIT - used) / TOKEN_LIMIT) * 100);
  const threshold = Number(fo.thresholdPct) || 15;
  const hysteresis = Number(fo.hysteresisPct) || 10;
  const needBackup = remainingPct <= threshold;
  const stickyHold = !!(fo.sticky && fo.activeNr && remainingPct <= (threshold + hysteresis));

  if (!fo.enabled || (!needBackup && !stickyHold)) {
    if (fo.activeNr != null) {
      fo.activeNr = null;
      desk.failover = fo;
      saveDesk(desk);
    }
    return { entry: primary, via: 'primary', remainingPct };
  }

  const enabled = (fo.instances || [])
    .filter(item => item && item.enabled && item.nr !== primary.nr)
    .sort((a, b) => (a.priority || 50) - (b.priority || 50));
  const all = registry.loadRegistry();
  for (const item of enabled) {
    const entry = all.find(e => e && e.nr === item.nr && e.unique_key && e.port);
    if (!entry) continue;
    if (fo.preferFamily === FAMILY && entry.model_family !== FAMILY) continue;
    if (fo.activeNr !== entry.nr) {
      fo.activeNr = entry.nr;
      desk.failover = fo;
      saveDesk(desk);
    }
    return { entry, via: 'failover', remainingPct, settings: item };
  }
  if (fo.activeNr != null) {
    fo.activeNr = null;
    desk.failover = fo;
    saveDesk(desk);
  }
  return { entry: primary, via: 'primary', remainingPct };
}

function registerIpc() {
  // dashboard
  ipcMain.handle('env:list', (event) => {
    if (isStudio(event)) return [];
    return registry.envDefs();
  });
  ipcMain.handle('env:open', (event, nr) => {
    if (isStudio(event)) return { ok: false, error: 'nur ein astra token' };
    const win = createEnvWindow(nr);
    return win ? { ok: true, nr } : { ok: false };
  });
  ipcMain.handle('env:close', (_e, nr) => {
    const win = envWindows.get(nr);
    if (win) win.close();
    return { ok: true };
  });
  ipcMain.handle('clipboard:write', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('astra:info', (event) => {
    if (!isStudio(event)) return { ok: false, error: 'nur die desktop-app' };
    return astraInfo();
  });
  ipcMain.handle('usage:get', async () => {
    const entry = astraEntry();
    const desk = loadDesk();
    const counter = entry ? await dockerUsage(entry.container) : null;
    const used = counter == null ? desk.sessionTokens : counter;
    usageCache = { used, at: Date.now() };
    const fo = desk.failover || defaultFailover();
    return {
      ok: true,
      used,
      limit: TOKEN_LIMIT,
      source: counter == null ? 'session' : 'counter',
      remainingPct: Math.max(0, ((TOKEN_LIMIT - used) / TOKEN_LIMIT) * 100),
      activeNr: fo.activeNr || (entry && entry.nr) || null,
      via: fo.activeNr ? 'failover' : 'primary',
    };
  });
  ipcMain.handle('failover:list', () => publicInstances());
  ipcMain.handle('failover:get', () => {
    const desk = loadDesk();
    return desk.failover || defaultFailover();
  });
  ipcMain.handle('failover:save', (_e, conf) => {
    const desk = loadDesk();
    const next = Object.assign(defaultFailover(), conf || {});
    next.instances = Array.isArray(next.instances) ? next.instances.map((item, i) => ({
      nr: Number(item.nr),
      enabled: !!item.enabled,
      priority: Number(item.priority) || (i + 1) * 10,
      maxTokens: Math.max(64, Number(item.maxTokens) || 1200),
      temperature: Math.min(1.5, Math.max(0, Number(item.temperature) || 0.4)),
    })) : [];
    desk.failover = next;
    saveDesk(desk);
    return desk.failover;
  });
  ipcMain.handle('spaces:list', () => loadDesk().spaces);
  ipcMain.handle('spaces:save', (_e, item) => {
    const desk = loadDesk();
    desk.spaces = [item].concat(desk.spaces.filter(s => s && s.id !== item.id)).slice(0, 40);
    saveDesk(desk);
    return desk.spaces;
  });
  ipcMain.handle('roles:list', () => loadDesk().roles);
  ipcMain.handle('roles:save', (_e, item) => {
    const desk = loadDesk();
    desk.roles = [item].concat(desk.roles.filter(r => r && r.id !== item.id)).slice(0, 40);
    saveDesk(desk);
    return desk.roles;
  });
  ipcMain.handle('studio:open', () => {
    createStudioWindow();
    return { ok: true };
  });
  ipcMain.handle('fleet:get', async (event) => {
    if (isStudio(event)) return { error: 'nur ein astra token' };
    try {
      const res = await fetch(PANEL_BASE + '/api/fleet');
      if (!res.ok) throw new Error('panel http ' + res.status);
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  });

  // chat
  ipcMain.handle('chat:send', (event, payload) => {
    let { nr, messages, model, params } = payload;
    let via = 'direct';
    let remainingPct = null;
    if (isStudio(event)) {
      const resolved = resolveFailoverSync();
      if (!resolved || !resolved.entry) return { error: 'kein ' + FAMILY + ' token' };
      nr = resolved.entry.nr;
      via = resolved.via;
      remainingPct = resolved.remainingPct;
      if (resolved.settings) {
        params = Object.assign({}, params || {});
        if (resolved.settings.maxTokens) params.max_tokens = resolved.settings.maxTokens;
        if (typeof resolved.settings.temperature === 'number') params.temperature = resolved.settings.temperature;
      }
    }
    const def = registry.envByNr(nr);
    const win = envWindows.get(nr);
    if (!def) return { error: 'env unbekannt' };
    const targets = [event.sender];
    if (win && !win.isDestroyed() && win.webContents !== event.sender) targets.push(win.webContents);
    const emit = (channel, data) => targets.forEach(contents => {
      if (contents && !contents.isDestroyed()) contents.send(channel, data);
    });
    const stop = chat.streamChat({
      port: def.port,
      key: def.unique_key,
      messages,
      model,
      params,
      onDelta: t => emit('chat:token', { nr, delta: t }),
      onDone: r => emit('chat:done', { nr, usage: r.usage, model: r.model, elapsedMs: r.elapsedMs, via }),
      onError: e => emit('chat:error', { nr, status: e.status, message: e.message }),
    });
    const key = `chat_${nr}_${Date.now()}`;
    chatStops.set(key, stop);
    if (win && !win.isDestroyed()) {
      win._chatStops = win._chatStops || new Map();
      win._chatStops.set(key, stop);
    }
    return { ok: true, key, nr, via, remainingPct };
  });
  ipcMain.handle('chat:stop', (_e, payload) => {
    const { nr, key } = payload;
    const stop = chatStops.get(key);
    if (stop) { stop(); chatStops.delete(key); }
    const win = envWindows.get(nr);
    if (win && win._chatStops) win._chatStops.delete(key);
    return { ok: true };
  });
  ipcMain.handle('chat:models', async (event, nr) => {
    if (isStudio(event)) {
      const astra = astraEntry();
      if (!astra) return [];
      nr = astra.nr;
    }
    const def = registry.envByNr(nr);
    if (!def) return [];
    try {
      return await chat.models(def.port, def.unique_key);
    } catch (e) {
      return [];
    }
  });

  function studioPayload(event, payload) {
    const body = payload || {};
    if (!isStudio(event)) return { payload: body };
    const astra = astraEntry();
    if (!astra) return { error: 'kein ' + FAMILY + ' token' };
    return { payload: Object.assign({}, body, { nr: astra.nr }) };
  }

  // files — die desktop-app darf nur den einen astra-workspace anfassen
  ipcMain.handle('files:tree', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    return filesys.tree(filesys.envWorkspace(bound.payload.nr), bound.payload.path || '');
  });
  ipcMain.handle('file:read', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    return filesys.readFile(filesys.envWorkspace(bound.payload.nr), bound.payload.path);
  });
  ipcMain.handle('file:write', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    return filesys.writeFile(filesys.envWorkspace(bound.payload.nr), bound.payload.path, bound.payload.content);
  });
  ipcMain.handle('file:create', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    return filesys.create(filesys.envWorkspace(bound.payload.nr), bound.payload.path, bound.payload.type);
  });
  ipcMain.handle('file:delete', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    return filesys.remove(filesys.envWorkspace(bound.payload.nr), bound.payload.path);
  });

  // terminal
  ipcMain.handle('term:data', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return;
    const win = envWindows.get(bound.payload.nr);
    if (!win || !win._term) return;
    try { win._term.write(bound.payload.data); } catch (e) {}
  });
  ipcMain.handle('term:resize', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return;
    const win = envWindows.get(bound.payload.nr);
    if (!win || !win._term) return;
    try { win._term.resize(bound.payload.cols, bound.payload.rows); } catch (e) {}
  });
  ipcMain.handle('term:kill', (event, nr) => {
    if (isStudio(event)) return { ok: false, error: 'nur ein astra token' };
    const win = envWindows.get(nr);
    if (win && win._termCleanup) win._termCleanup();
    return { ok: true };
  });
  ipcMain.handle('term:run', async (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    return await termMod.runCode(bound.payload.nr, bound.payload.code, bound.payload.runtime);
  });

  // config/history
  ipcMain.handle('config:get', (event, nr) => {
    if (isStudio(event)) {
      const astra = astraEntry();
      if (!astra) return { error: 'kein ' + FAMILY + ' token' };
      nr = astra.nr;
    }
    const base = path.join(ROOT, 'envs', String(nr));
    const cfgFile = path.join(base, 'config.json');
    let cfg = { system_prompt: '', temperature: 0.7, top_p: 1, max_tokens: 1024, model: '' };
    try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile, 'utf-8'))); } catch (e) {}
    return cfg;
  });
  ipcMain.handle('config:set', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    payload = bound.payload;
    const base = path.join(ROOT, 'envs', String(payload.nr));
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'config.json'), JSON.stringify(payload.config, null, 2), 'utf-8');
    return { ok: true };
  });
  ipcMain.handle('history:get', (event, nr) => {
    if (isStudio(event)) {
      const astra = astraEntry();
      if (!astra) return [];
      nr = astra.nr;
    }
    const base = path.join(ROOT, 'envs', String(nr));
    const hFile = path.join(base, 'history.json');
    try { return JSON.parse(fs.readFileSync(hFile, 'utf-8')); } catch (e) { return []; }
  });
  ipcMain.handle('history:set', (event, payload) => {
    const bound = studioPayload(event, payload);
    if (bound.error) return { error: bound.error };
    payload = bound.payload;
    const base = path.join(ROOT, 'envs', String(payload.nr));
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'history.json'), JSON.stringify(payload.messages, null, 2), 'utf-8');
    return { ok: true };
  });

  // external links im standard-browser öffnen (kein navigation-escape)
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// smoke-modus: boot ohne GUI, registry+fleet drucken, dann quit
// ---------------------------------------------------------------------------
async function smoke() {
  const defs = registry.envDefs();
  console.log('[smoke] envs=' + defs.length);
  try {
    const res = await fetch(PANEL_BASE + '/api/fleet');
    const fleet = await res.json();
    const active = fleet.filter(e => e.state === 'running').length;
    console.log('[smoke] fleet=' + fleet.length + ' active=' + active);
    console.log('[smoke] nr1=' + JSON.stringify(defs[0] && { nr: defs[0].nr, port: defs[0].port, family: defs[0].model_family }));
  } catch (e) {
    console.log('[smoke] panel nicht erreichbar: ' + e.message);
  }

  const envNr = (() => {
    const i = process.argv.indexOf('--smoke-env');
    return i >= 0 ? Number(process.argv[i + 1]) : null;
  })();

  if (process.argv.includes('--smoke-term')) {
    const win = new BrowserWindow({ width: 800, height: 400, webPreferences: { sandbox: true, contextIsolation: true } });
    win.loadURL(pageUrl('xterm_test.html'));
    win.webContents.on('console-message', (_e, level, message) => console.log('[term:console] ' + message));
    await new Promise(r => setTimeout(r, 6000));
    win.close();
  }

  if (process.argv.includes('--smoke-dash')) {
    const win = createDashboardWindow();
    win.webContents.on('console-message', (_e, level, message) => {
      console.log('[dash:console] ' + message);
    });
    await new Promise(r => setTimeout(r, 10000));
    win.close();
  }

  if (process.argv.includes('--smoke-multi')) {
    for (const n of [1, 23]) {
      const win = createEnvWindow(n);
      if (win) {
        win.webContents.on('console-message', (_e, level, message) => {
          console.log('[env:' + n + ':console] ' + message);
        });
      }
    }
    await new Promise(r => setTimeout(r, 10000));
    for (const n of [1, 23]) {
      const w = envWindows.get(n);
      if (w) w.close();
    }
  }

  if (process.argv.includes('--smoke-chat')) {
    const def1 = registry.envByNr(1);
    const def23 = registry.envByNr(23);
    console.log('[smoke-chat] nr1 port=' + def1.port + ' family=' + def1.model_family);
    console.log('[smoke-chat] nr23 port=' + def23.port + ' family=' + def23.model_family);

    // datei-ops in env1-workspace
    const fsys = require('./files');
    const ws = filesys.envWorkspace(1);
    filesys.writeFile(ws, 'hello.txt', 'harness test\n');
    const readBack = filesys.readFile(ws, 'hello.txt').content;
    console.log('[smoke-chat] file write/read roundtrip=' + JSON.stringify(readBack));

    // runner: node + shell (pwd im env-cwd)
    const run1 = await termMod.runCode(1, 'console.log(21*2)', 'node');
    const run2 = await termMod.runCode(1, 'pwd', 'shell');
    console.log('[smoke-chat] runner node stdout=' + JSON.stringify(run1.stdout.trim()) + ' code=' + run1.code);
    console.log('[smoke-chat] runner shell stdout=' + JSON.stringify(run2.stdout.trim()) + ' code=' + run2.code);

    // chat-stream gegen nr1-gateway
    await new Promise(resolve => {
      let got = '';
      chat.streamChat({
        port: def1.port,
        key: def1.unique_key,
        messages: [{ role: 'user', content: 'say ok' }],
        model: undefined,
        params: { temperature: 0.2, max_tokens: 8 },
        onDelta: t => { got += t; },
        onDone: r => {
          console.log('[smoke-chat] stream delta-len=' + got.length + ' usage=' + JSON.stringify(r.usage) + ' model=' + r.model);
          resolve();
        },
        onError: e => {
          console.log('[smoke-chat] stream error status=' + e.status + ' msg=' + e.message);
          resolve();
        },
      });
    });
  }

  if (envNr != null) {
    const win = createEnvWindow(envNr);
    if (win) {
      win.webContents.on('console-message', (_e, level, message) => {
        console.log('[env:' + envNr + ':console] ' + message);
      });
      win.webContents.on('did-fail-load', (_e, code, desc) => {
        console.log('[env:' + envNr + ':fail-load] ' + code + ' ' + desc);
      });
      await new Promise(r => setTimeout(r, 12000));
      win.close();
    }
  }

  app.quit();
}

// ---------------------------------------------------------------------------
// app-lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  await startStaticServer();
  registerIpc();

  if (process.argv.includes('--smoke')) {
    await smoke();
    return;
  }

  createStudioWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createStudioWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
