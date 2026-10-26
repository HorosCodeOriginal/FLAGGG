// dashboard.js — launcher: env-defs aus registry (main) + live-fleet aus panel.
(() => {
const $ = id => document.getElementById(id);

let envs = [];
let fleet = [];
let filterFam = 'alle';
let filterText = '';

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n || 0);
}
function fmtUptime(s) {
  if (!s) return 'online —';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `online ${h}h ${m}m`;
}
function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function stateOf(env) {
  if (env.state === 'running') return 'running';
  if (env.state === 'stopped') return 'stopped';
  if (env.state === 'removed') return 'removed';
  return 'absent';
}

function mergedCards() {
  const byPort = new Map(fleet.map(f => [f.port, f]));
  return envs.map(e => {
    const live = byPort.get(e.port) || {};
    const tokens = live.tokens != null ? live.tokens : 0;
    const limit = live.limit != null ? live.limit : (e.limit_override || 2000000);
    return {
      nr: e.nr,
      port: e.port,
      container: e.container || ('fr-key-...'),
      family: e.model_family || '?',
      state: live.state || e.state || 'absent',
      tokens,
      limit,
      reset_at: live.reset_at || '',
      uptime: live.uptime || 0,
      unique_key: e.unique_key || '',
    };
  });
}

function filtered() {
  return mergedCards().filter(c => {
    if (filterFam !== 'alle' && c.family !== filterFam) return false;
    if (filterText) {
      const q = filterText.toLowerCase();
      const hay = `${c.nr} ${c.port} ${c.container} ${c.family}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderHeader(cards) {
  const all = mergedCards();
  const active = all.filter(c => c.state === 'running');
  const tokens = active.reduce((s, c) => s + c.tokens, 0);
  $('midStats').innerHTML =
    `<b>${active.length}</b> aktiv · <b>${all.filter(c => c.family === 'astra').length}</b> Astra · ` +
    `<b>${all.filter(c => c.family === 'opus').length}</b> Opus · <b>${fmtTokens(tokens)}</b> Verbrauch heute`;
  const maxUp = active.reduce((m, c) => Math.max(m, c.uptime), 0);
  $('upTime').textContent = fmtUptime(maxUp);
  const dot = $('headDot');
  dot.className = 'dot';
  if (active.length === 0) dot.classList.add('err');
  else if (active.length < all.length) dot.classList.add('warn');
}

function cardHTML(c) {
  const ratio = c.limit ? Math.min(1, c.tokens / c.limit) : 0;
  let fillCls = c.family === 'opus' ? 'opus' : '';
  if (c.state !== 'running') fillCls = 'full';
  else if (ratio >= 1) fillCls = 'full';
  else if (ratio > 0.8) fillCls = 'warn';
  const stateCls = c.state === 'running' ? '' : (c.state === 'absent' ? 'absent' : 'stopped');
  return `
  <div class="card" onclick="openEnv(${c.nr})">
    <div class="card-top">
      <span class="card-name">${c.container}</span>
      <span class="card-state ${stateCls}"></span>
    </div>
    <div class="card-mid">
      <span class="port ${c.family === 'opus' ? 'opus' : ''}">${c.port}</span>
      <span class="badge ${c.family === 'opus' ? 'opus' : ''}">${c.family.toUpperCase()}</span>
    </div>
    <div class="bar"><div class="bar-fill ${fillCls}" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
    <div class="card-bottom">
      <span>${fmtTokens(c.tokens)} / ${fmtTokens(c.limit)}</span>
      <span>${c.reset_at ? c.reset_at.slice(5, 16).replace('T', ' ') : ''}</span>
    </div>
  </div>`;
}

function render() {
  const cards = filtered();
  $('grid').innerHTML = cards.map(cardHTML).join('') || '<div style="padding:24px;color:var(--dim)">keine Umgebungen</div>';
  renderHeader(cards);
  $('lastUpdate').textContent = 'letzte Aktualisierung: ' + new Date().toLocaleTimeString('de-DE');
}

async function refreshFleet() {
  const r = await window.api.dashboard.getFleet();
  if (r && !r.error) {
    fleet = r;
    render();
  } else if (r && r.error) {
    $('srcInfo').textContent = 'Panel: ' + r.error;
    $('headDot').className = 'dot err';
  }
}

async function init() {
  envs = await window.api.dashboard.listEnvs();
  $('srcInfo').textContent = `Quelle: ${envs.length} Umgebungen`;
  await refreshFleet();
  setInterval(refreshFleet, 5000);
}

window.openEnv = async nr => {
  const r = await window.api.dashboard.openEnv(nr);
  if (!r || !r.ok) toast('Umgebung konnte nicht geöffnet werden', true);
};

$('btnRefresh').onclick = refreshFleet;
$('btnStudio').onclick = () => window.api.dashboard.openStudio();

document.querySelectorAll('.filter').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filter').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    filterFam = btn.dataset.f;
    render();
  };
});

$('search').addEventListener('input', e => {
  filterText = e.target.value.trim();
  render();
});

init();
})();
