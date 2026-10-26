// env.js — workspace-umgebung pro key.
// chat (SSE gegen eigenen gateway-port), dateibaum + monaco, xterm/pTY-terminal, runner.
(() => {
window.onerror = (msg, src, line, col, err) => {
  console.error('[ERR] ' + msg + ' @' + line + ':' + col + ' stack=' + (err && err.stack));
};
window.addEventListener('unhandledrejection', e => {
  console.error('[REJ] ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
});
const $ = id => document.getElementById(id);

const nr = parseInt(new URLSearchParams(location.search).get('nr'), 10);
let def = null;
let messages = [];
let streaming = null; // { key, abort }
let modelSel = '';

const api = window.api;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ensureMarked() {
  // marked wird statisch vor env.js geladen (siehe env.html)
  return typeof window.marked === 'function' || (window.marked && window.marked.parse);
}

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------
function renderMessages() {
  const box = $('msgs');
  box.innerHTML = '';
  messages.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'msg ' + m.role;
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = m.role === 'user' ? 'du' : (m.role === 'system' ? 'System' : 'Assistent');
    div.appendChild(role);
    const md = document.createElement('div');
    md.className = 'md';
    md.innerHTML = m.role === 'assistant' && m.html ? m.html : fmtMessage(m.content);
    div.appendChild(md);
    if (m.role === 'assistant') {
      const foot = document.createElement('div');
      foot.className = 'foot';
      if (m.usage) {
        foot.innerHTML = `Verbrauch: prompt ${m.usage.prompt_tokens ?? '-'} · completion ${m.usage.completion_tokens ?? '-'} · gesamt ${m.usage.total_tokens ?? '-'}`;
      }
      if (m.model) foot.insertAdjacentHTML('beforeend', `<span>Modell: ${esc(m.model)}</span>`);
      if (m.elapsedMs != null) foot.insertAdjacentHTML('beforeend', `<span>${m.elapsedMs} ms</span>`);
      div.appendChild(foot);
    }
    // code-copy-buttons
    md.querySelectorAll('pre code').forEach(block => {
      const btn = document.createElement('button');
      btn.className = 'codecopy';
      btn.textContent = 'Kopieren';
      btn.onclick = async () => {
        try { await navigator.clipboard.writeText(block.textContent); toast('Kopiert'); }
        catch (e) { toast('Kopieren fehlgeschlagen', true); }
      };
      const pre = block.parentElement;
      pre.style.position = 'relative';
      pre.appendChild(btn);
    });
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function fmtMessage(text) {
  ensureMarked();
  try {
    return window.marked.parse(String(text || ''));
  } catch (e) {
    return esc(text);
  }
}

function appendAssistantBubble() {
  const box = $('msgs');
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML = '<div class="role">Assistent</div><div class="md"></div>';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div.querySelector('.md');
}

async function sendMessage() {
  const text = $('composer').value.trim();
  if (!text || streaming) return;
  $('composer').value = '';
  messages.push({ role: 'user', content: text });
  renderMessages();

  const params = {
    temperature: parseFloat($('pTemp').value),
    top_p: parseFloat($('pTop').value),
    max_tokens: parseInt($('pMax').value, 10),
  };
  const model = modelSel || undefined;

  const bubble = appendAssistantBubble();
  let acc = '';
  let meta = {};
  const stopBtn = $('btnStop');

  const clearStream = () => {
    streaming = null;
    stopBtn.disabled = true;
  };

  streaming = { key: null, abort: null };
  stopBtn.disabled = false;
  stopBtn.onclick = async () => {
    if (streaming && streaming.key) {
      await api.chat.stop(nr, streaming.key);
      streaming.abort && streaming.abort();
      messages.push({ role: 'assistant', content: acc || '(abgebrochen)', ...meta, html: bubble.innerHTML });
      renderMessages();
      clearStream();
    }
  };

  const start = await api.chat.send(nr, messages, model, params);
  if (!start.ok) {
    bubble.textContent = 'Fehler: ' + (start.error || 'Unbekannt');
    clearStream(); return;
  }
  streaming.key = start.key;

  const offToken = api.chat.onToken((enr, delta) => {
    if (enr !== nr) return;
    acc += delta;
    bubble.innerHTML = fmtMessage(acc);
    $('msgs').scrollTop = $('msgs').scrollHeight;
  });
  const offDone = api.chat.onDone(async (enr, done) => {
    if (enr !== nr) return;
    meta.usage = done.usage; meta.model = done.model; meta.elapsedMs = done.elapsedMs;
    const m = { role: 'assistant', content: acc, usage: done.usage, model: done.model, elapsedMs: done.elapsedMs, html: bubble.innerHTML };
    messages.push(m);
    await api.config.setHistory(nr, messages);
    renderMessages();
    clearStream();
  });
  const offError = api.chat.onError((enr, e) => {
    if (enr !== nr) return;
    bubble.innerHTML = '';

    if (e.status === 429) {
      bubble.textContent = 'tägliches Kontingent erreicht' + (e.reset_at_utc ? ' · Reset ' + e.reset_at_utc : '');
      toast('limit erreicht', true);
    } else {
      bubble.textContent = 'gateway-fehler (' + (e.status || '?') + '): ' + (e.message || '');
    }
    messages.push({ role: 'assistant', content: bubble.textContent, ...meta, html: bubble.innerHTML });
    renderMessages();
    clearStream();
  });
  // aufräumen: listener einmalig bei nächstem clear
  streaming.abort = () => {
    offToken(); offDone(); offError();
  };
}

$('btnSend').onclick = sendMessage;
$('composer').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('btnClear').onclick = async () => {
  if (streaming) { streaming.abort && streaming.abort(); streaming = null; $('btnStop').disabled = true; }
  messages = [];
  renderMessages();
  await api.config.setHistory(nr, []);
};

// ---------------------------------------------------------------------------
// model-selector + config
// ---------------------------------------------------------------------------
async function loadModels() {
  const list = await api.chat.models(nr);
  const sel = $('modelSel');
  sel.innerHTML = '';
  if (!list.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '(Kein Modell — Gateway offline?)';
    sel.appendChild(o);
    return;
  }
  list.forEach(id => {
    const o = document.createElement('option');
    o.value = id; o.textContent = id;
    sel.appendChild(o);
  });
  const cfg = await api.config.get(nr);
  if (cfg.model && list.includes(cfg.model)) sel.value = cfg.model;
  else sel.selectedIndex = 0;
  modelSel = sel.value;
}

$('modelSel').onchange = async () => {
  modelSel = $('modelSel').value;
  const cfg = await api.config.get(nr);
  cfg.model = modelSel;
  await api.config.set(nr, cfg);
};

async function loadConfig() {
  const cfg = await api.config.get(nr);
  $('pTemp').value = cfg.temperature ?? 0.7;
  $('pTop').value = cfg.top_p ?? 1;
  $('pMax').value = cfg.max_tokens ?? 1024;
  $('sysPrompt').value = cfg.system_prompt || '';
  messages = await api.config.getHistory(nr);
  if (!messages.some(m => m.role === 'system') && cfg.system_prompt) {
    messages.unshift({ role: 'system', content: cfg.system_prompt });
  }
  renderMessages();
}

$('btnSaveCfg').onclick = async () => {
  const cfg = await api.config.get(nr);
  cfg.system_prompt = $('sysPrompt').value;
  cfg.temperature = parseFloat($('pTemp').value);
  cfg.top_p = parseFloat($('pTop').value);
  cfg.max_tokens = parseInt($('pMax').value, 10);
  cfg.model = modelSel;
  await api.config.set(nr, cfg);
  const si = messages.findIndex(m => m.role === 'system');
  if (cfg.system_prompt) {
    if (si >= 0) messages[si].content = cfg.system_prompt;
    else messages.unshift({ role: 'system', content: cfg.system_prompt });
  } else if (si >= 0) {
    messages.splice(si, 1);
  }
  renderMessages();
  toast('Konfiguration gespeichert');
};

// ---------------------------------------------------------------------------
// datei-panel + monaco
// ---------------------------------------------------------------------------
let editor = null;
let currentFile = null;

async function loadTree() {
  const t = await api.files.tree(nr, '');
  $('tree').innerHTML = '';
  const rootDiv = document.createElement('div');
  rootDiv.className = 'tree-item dir open';
  rootDiv.textContent = 'Arbeitsbereich';
  rootDiv.onclick = () => toggleDir(rootDiv, t);
  $('tree').appendChild(rootDiv);
  renderChildren(rootDiv, t);
}

function renderChildren(parentEl, node) {
  const children = document.createElement('div');
  children.className = 'tree-children';
  (node.children || []).forEach(child => {
    const el = document.createElement('div');
    el.className = 'tree-item ' + child.type;
    el.textContent = child.name;
    if (child.type === 'dir') {
      el.onclick = e => { e.stopPropagation(); toggleDir(el, child); };
    } else {
      el.onclick = async () => {
        try {
          const r = await api.files.read(nr, child.path);
          openFile(child.path, r.content);
        } catch (err) { toast('Lesefehler: ' + err.message, true); }
      };
    }
    children.appendChild(el);
  });
  parentEl.appendChild(children);
}

function toggleDir(el, node) {
  el.classList.toggle('open');
  const existing = el.nextElementSibling;
  if (existing && existing.classList.contains('tree-children')) {
    existing.remove();
  } else {
    renderChildren(el, node);
  }
}

async function openFile(path, content) {
  currentFile = path;
  if (editor) {
    editor.setValue(content || '');
    editor.focus();
    return;
  }
  // monaco async laden
  const script = document.createElement('script');
  script.src = '/vendor/monaco-editor/min/vs/editor/editor.main.js';
  await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.appendChild(script); });
  const container = document.createElement('div');
  container.style.flex = '1';
  container.style.minHeight = '0';
  const chatPane = $('paneChat');
  chatPane.insertBefore(container, $('composer'));
  editor = monaco.editor.create(container, {
    value: content || '',
    language: guessLang(path),
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
  });
  editor.onDidChangeModelContent(() => {
    if (!currentFile) return;
    // debounced autosave
    clearTimeout(editor._saveT);
    editor._saveT = setTimeout(async () => {
      try { await api.files.write(nr, currentFile, editor.getValue()); }
      catch (e) { /* nur melden bei speicher-button */ }
    }, 800);
  });
  $('btnFiles').classList.add('on');
}

function guessLang(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', json: 'json', html: 'html', css: 'css', md: 'markdown', sh: 'shell', lua: 'lua', yml: 'yaml', yaml: 'yaml', txt: 'plaintext' };
  return map[ext] || 'plaintext';
}

function promptInput(title, placeholder) {
  return new Promise(resolve => {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = `<input type="text" id="modalInput" placeholder="${esc(placeholder || '')}">`;
    $('overlay').classList.add('open');
    const ok = $('modalOk'), cancel = $('modalCancel');
    const finish = v => { $('overlay').classList.remove('open'); ok.onclick = cancel.onclick = null; resolve(v); };
    ok.onclick = () => finish($('modalInput').value.trim());
    cancel.onclick = () => finish(null);
    $('modalInput').focus();
  });
}

$('btnNewFile').onclick = async () => {
  const name = await promptInput('Neue Datei', 'z. B. test.js');
  if (!name) return;
  try {
    await api.files.create(nr, name, 'file');
    await loadTree();
    openFile(name, '');
    toast('Datei angelegt: ' + name);
  } catch (e) { toast('Anlegen fehlgeschlagen', true); }
};
$('btnNewDir').onclick = async () => {
  const name = await promptInput('Neues Verzeichnis', 'z. B. src');
  if (!name) return;
  try {
    await api.files.create(nr, name, 'dir');
    await loadTree();
    toast('Verzeichnis angelegt: ' + name);
  } catch (e) { toast('Anlegen fehlgeschlagen', true); }
};
$('btnDelete').onclick = async () => {
  if (!currentFile) { toast('Keine Datei geöffnet'); return; }
  if (!confirm(`Löschen ${currentFile}?`)) return;
  try {
    await api.files.remove(nr, currentFile);
    currentFile = null;
    if (editor) { editor.setValue(''); }
    await loadTree();
    toast('Gelöscht');
  } catch (e) { toast('Löschen fehlgeschlagen', true); }
};

// ---------------------------------------------------------------------------
// tabs + resize
// ---------------------------------------------------------------------------
$('btnFiles').onclick = () => {
  $('paneFiles').style.display = 'flex';
  $('paneSide').style.display = 'flex';
};
$('btnTerm').onclick = () => {
  $('paneFiles').style.display = 'none';
  $('paneSide').style.display = 'flex';
};

document.querySelectorAll('.side-tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.side-tab').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    ['term', 'run', 'sys'].forEach(id => $(`side${id[0].toUpperCase()}${id.slice(1)}`).classList.add('hidden'));
    const map = { term: 'sideTerm', run: 'sideRun', sys: 'sideSys' };
    $(map[btn.dataset.tab]).classList.remove('hidden');
    if (btn.dataset.tab === 'term' && term) term.fit && term.fit();
  };
});

// drag-resize (vertikal: files/chat; horizontal: chat/side)
let dragMode = null;
$('dragV').onmousedown = e => { dragMode = 'v'; e.preventDefault(); };
$('dragH').onmousedown = e => { dragMode = 'h'; e.preventDefault(); };
document.addEventListener('mousemove', e => {
  if (dragMode === 'v') {
    const w = Math.max(120, Math.min(480, e.clientX));
    $('paneFiles').style.width = w + 'px';
  } else if (dragMode === 'h') {
    const w = Math.max(240, Math.min(640, window.innerWidth - e.clientX));
    $('paneSide').style.width = w + 'px';
  }
});
document.addEventListener('mouseup', () => { dragMode = null; });

// ---------------------------------------------------------------------------
// terminal (xterm + node-pty über main)
// ---------------------------------------------------------------------------
let term = null;
let xterm = null;

async function initTerm() {
  // xterm wird statisch vor env.js geladen (siehe env.html)
  xterm = window.Terminal;
  term = new xterm({ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, theme: { background: '#0a0a0f', foreground: '#c8c8d0' } });
  term.open($('terminal'));
  term.onData(data => api.term.data(nr, data));
  term.onResize(({ cols, rows }) => api.term.resize(nr, cols, rows));
  api.term.onData((enr, data) => { if (enr === nr) term.write(data); });
  api.term.onExit((enr, code) => { if (enr === nr) term.write(`\r\n[Prozess beendet: Code ${code}]\r\n`); });
  // initial-fit
  try { term.fit && term.fit(); } catch (e) {}
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
$('btnRun').onclick = async () => {
  const code = $('runCode').value;
  const runtime = $('runRuntime').value;
  if (!code.trim()) return;
  $('runStdout').textContent = '… läuft';
  $('runStderr').textContent = '';
  const r = await api.term.run(nr, code, runtime);
  $('runStdout').textContent = r.stdout || '(kein stdout)';
  $('runStderr').textContent = r.stderr || '';
  $('runStdout').insertAdjacentText('beforeend', `\n[Exit-Code: ${r.code}]`);
};

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function boot() {
  $('title').textContent = `Umgebung ${nr} — wird geladen…`;
  try {
    const envs = await api.dashboard.listEnvs();
    def = envs.find(e => e.nr === nr) || null;
    if (def) {
      $('title').textContent = `${nr} · :${def.port} · ${def.model_family.toUpperCase()}`;
    }
  } catch (e) {}
  api.chat.onReady((enr, d) => {
    if (enr !== nr || !d || !d.def) return;
    def = d.def;
    $('title').textContent = `${nr} · :${def.port} · ${def.model_family.toUpperCase()}`;
  });
  await loadConfig();
  await loadModels();
  await loadTree();
  try { await initTerm(); } catch (e) { toast('terminal nicht verfügbar', true); }
  $('btnClose').onclick = () => api.dashboard.closeEnv(nr);
}

boot();
})();
