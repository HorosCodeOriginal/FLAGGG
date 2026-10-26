(function () {
  var D = window.HARNESS_DATA;
  var VIEWS = ['chat', 'roles', 'spaces', 'failover', 'orchestration', 'overview', 'market'];
  var TOKEN_LIMIT = 2000000;

  var state = {
    view: 'chat',
    preview: false,
    model: 'gpt-6-astra',
    modelMenu: false,
    models: null,
    api: null,
    prefs: { temperature: 0.4, topP: 1, maxTokens: 1200, systemPrompt: '' },
    prefsOpen: false,
    prefsChecking: false,
    prefsCheck: null,
    usage: { used: 0, limit: TOKEN_LIMIT, source: '' },
    roles: [],
    roleId: null,
    spaces: [],
    spaceId: null,
    liveKind: 'agent',
    failover: {
      enabled: true,
      thresholdPct: 15,
      hysteresisPct: 10,
      sticky: true,
      preferFamily: 'astra',
      activeNr: null,
      instances: []
    },
    instances: [],
    routeVia: 'primary',
    session: D.sessions[0].id,
    sessions: D.sessions.map(copy),
    fleet: [],
    file: 'src/services/payment_service.py',
    tabs: ['src/services/payment_service.py', 'tests/test_payment.py', 'src/services/idempotency.py'],
    open: {},
    termTab: 'terminal',
    termLines: [
      'deepseek-harness@pro:~/projects/payment-service$ pytest tests/services/test_payment.py -q',
      '............x....... [100%]',
      '18 passed, 2 xfailed in 4.32s',
      'deepseek-harness@pro:~/projects/payment-service$ '
    ],
    logs: ['10:27:03 executor  test run finished', '10:27:11 memory   indexed payment invariants', '10:28:02 qa       strategy approved'],
    events: ['Mission gestartet', 'Architekt gesperrt', 'Sub-Agenten gestartet', 'Ausführung läuft'],
    plugins: D.plugins.map(copy),
    catalog: D.catalog.map(copy),
    messages: D.messages.map(function (m) { return copy(m); }),
    workSteps: D.workSteps.map(copy),
    plan: D.plan.map(copy),
    progress: 70,
    working: false,
    paused: false,
    chatLayout: 'studio',
    chatPane: 'chat',
    marketCat: 'Tools',
    marketSide: 'marketplace',
    marketQuery: '',
    collapsed: false,
    node: 'architect',
    reason: {},
    bell: false,
    creator: false,
    voice: false,
    suggestion: true,
    started: Date.now() - (18 * 60 + 42) * 1000,
    turns: 24,
    liked: {},
    stopKey: null,
    liveNr: null,
    liveAttached: false
  };

  var hash = location.hash.replace('#', '');
  if (hash === 'workspace') hash = 'chat';
  if (VIEWS.indexOf(hash) >= 0) state.view = hash;

  function copy(o) {
    var out = {};
    Object.keys(o).forEach(function (k) { out[k] = o[k]; });
    return out;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nid() { return 'm' + Math.random().toString(36).slice(2, 8); }
  function nowTime() {
    var d = new Date();
    var h = d.getHours();
    var m = String(d.getMinutes()).padStart(2, '0');
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ap;
  }
  function dur() {
    var s = Math.max(0, Math.floor((Date.now() - state.started) / 1000));
    var hh = String(Math.floor(s / 3600)).padStart(2, '0');
    var mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    var ss = String(s % 60).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }
  function session() {
    return state.sessions.concat(state.fleet).filter(function (s) { return s.id === state.session; })[0] || state.sessions[0];
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
    clearTimeout(toast._t);
    if (msg) toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }
  function svg(inner) {
    return '<span class="ic"><svg viewBox="0 0 24 24">' + inner + '</svg></span>';
  }
  var P = {
    whale: '<path d="M4 13c2-6 8-8 12-6 2 1 3 3 4 3-2 4-6 8-12 7-3-1-5-2-4-4z"/><path d="M8 13h.01M14 10c1 2 1 3-1 4"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    spark: '<path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M4 12l16-8-6 16-2-6z"/>',
    clip: '<path d="M8 12l6-6a3 3 0 0 1 4 4l-8 8a4 4 0 0 1-6-6l8-8"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    lock: '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    users: '<path d="M16 20v-1a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v1"/><circle cx="10" cy="8" r="3"/><path d="M20 20v-1a3 3 0 0 0-2.2-2.9M16 5.1a3 3 0 0 1 0 5.8"/>',
    wrench: '<path d="M14 7a4 4 0 0 0-5.7 5.2L4 16.5 7.5 20l4.3-4.3A4 4 0 0 0 17 10l-3 1-1-3z"/>',
    star: '<path d="M12 3l2.2 4.8L20 9l-4 3.6L17 18l-5-2.8L7 18l1-5.4L4 9l5.8-1.2z"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    split: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4v0M8 18h4a4 4 0 0 0 4-4"/>',
    folder: '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
    beaker: '<path d="M9 3h6M10 3v6L5 19a3 3 0 0 0 3 2h8a3 3 0 0 0 3-2l-5-10V3"/>',
    git: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 12h8"/>',
    doc: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>',
    music: '<path d="M9 18a3 3 0 1 1-2-2.8V6l10-2v9"/><circle cx="17" cy="15" r="2"/>',
    scan: '<path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3M4 12h16"/>',
    cube: '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M12 12l8-4M12 12v9M12 12L4 8"/>',
    chat: '<path d="M5 16l-1 4 4-1a8 8 0 1 0-3-3z"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M4 16l5-4 4 3 2-2 5 4"/>',
    brain: '<path d="M9 7a3 3 0 0 1 5-1 3 3 0 0 1 4 3 3 3 0 0 1-1 6H8a3 3 0 0 1-1-6 3 3 0 0 1 2-2z"/>',
    flow: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M6 8l5 8M18 8l-5 8"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
    bot: '<rect x="5" y="8" width="14" height="10" rx="3"/><path d="M12 8V5M9 13h.01M15 13h.01M8 4h8"/>',
    user: '<circle cx="12" cy="8" r="3"/><path d="M5 19a7 7 0 0 1 14 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    list: '<path d="M9 7h11M9 12h11M9 17h11M4 7h.01M4 12h.01M4 17h.01"/>',
    thumb: '<path d="M8 11v9H5v-9zM8 11l3-6a2 2 0 0 1 2 2v4h5l-1 8H8"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V5h10"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-3.5-3.5"/>',
    bag: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.2-5.5M20 4v5h-5"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
    bolt: '<path d="M13 3L5 14h7l-1 7 8-11h-7z"/>',
    nodes: '<circle cx="6" cy="12" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 12h8M16 8l-6 3M16 16l-6-3"/>'
  };
  function ic(name) { return svg(P[name] || P.spark); }

  function hi(line) {
    var s = esc(line);
    if (/^\s*#/.test(line) || /^\s*\/\//.test(line)) return '<span class="tok-c">' + s + '</span>';
    var re = /(&#39;.*?&#39;|&quot;.*?&quot;)/g;
    var chunks = [];
    var last = 0;
    var m;
    while ((m = re.exec(s))) {
      chunks.push({ t: 'code', v: s.slice(last, m.index) });
      chunks.push({ t: 'str', v: m[0] });
      last = m.index + m[0].length;
    }
    chunks.push({ t: 'code', v: s.slice(last) });
    return chunks.map(function (c) {
      if (c.t === 'str') return '<span class="tok-s">' + c.v + '</span>';
      return c.v
        .replace(/\b(class|def|return|if|elif|else|with|import|from|None|True|False|assert|raise)\b/g, '<span class="tok-k">$1</span>')
        .replace(/\b(self)\b/g, '<span class="tok-v">$1</span>');
    }).join('');
  }
  function codeBlock(text, sugFrom) {
    var lines = String(text || '').split('\n');
    return lines.map(function (ln, i) {
      var sug = typeof sugFrom === 'number' && i >= sugFrom;
      return '<div class="ln' + (sug ? ' sug' : '') + '"><span>' + (i + 1) + '</span><code>' + hi(ln) + '</code></div>';
    }).join('');
  }
  function ring(pct) {
    var c = 251.2;
    var off = (c * (1 - Math.max(0, Math.min(100, pct)) / 100)).toFixed(1);
    return '<svg class="ring" viewBox="0 0 100 100" aria-label="' + pct + ' Prozent">' +
      '<circle cx="50" cy="50" r="40" stroke="#16324a" stroke-width="8" fill="none"></circle>' +
      '<circle cx="50" cy="50" r="40" stroke="#2ee6f0" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="' + c + ' ' + c + '" stroke-dashoffset="' + off + '" transform="rotate(-90 50 50)"></circle>' +
      '<text x="50" y="48" text-anchor="middle" fill="#e8f0fa" font-size="18" font-family="Segoe UI, sans-serif">' + pct + '%</text>' +
      '<text x="50" y="64" text-anchor="middle" fill="#8ea3bc" font-size="8" font-family="Segoe UI, sans-serif">in Arbeit</text></svg>';
  }

  function viewNav() {
    var labels = { chat: 'Chat', roles: 'Rollen', spaces: 'Workspaces', failover: 'Failover', orchestration: 'Orchestration', overview: 'Übersicht', market: 'Marktplatz' };
    return '<nav class="vnav">' + VIEWS.map(function (v) {
      return '<button type="button" data-act="nav" data-view="' + v + '"' + (state.view === v ? ' class="on"' : '') + '>' + labels[v] + '</button>';
    }).join('') + '</nav>';
  }
  function brand() {
    var route = state.routeVia === 'failover' ? 'Failover aktiv' : 'Primär Astra';
    return '<button type="button" class="brand" data-act="nav" data-view="chat"><span class="logo"><img src="assets/mark.jpg" alt=""></span><span><b>Astra Harness</b><small>' + route + ' · ' + esc(state.model) + '</small></span></button>';
  }
  function bell() {
    return '<div class="bellwrap"><button type="button" class="iconbtn" data-act="bell" title="Benachrichtigungen">' + ic('bell') + '</button>' +
      (state.bell ? '<div class="popover" id="bellpop"><div class="kicker">Aktivität</div>' + D.feed.map(function (f) {
        return '<div class="item"><b>' + esc(f.who) + '</b><div class="muted">' + esc(f.text) + ' · ' + esc(f.ago) + '</div></div>';
      }).join('') + '</div>' : '') + '</div>';
  }
  function orderModels(list) {
    var seen = {};
    list.forEach(function (id) { seen[id] = true; });
    var clean = list.filter(function (id) {
      return !(id.indexOf('lgw/') === 0 && seen[id.slice(4)]);
    });
    clean.sort(function (a, b) {
      if (a === 'gpt-6-astra') return -1;
      if (b === 'gpt-6-astra') return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return clean;
  }
  function modelList() {
    return state.models && state.models.length ? state.models : ['gpt-6-astra'];
  }
  function modelPicker() {
    var list = modelList();
    return '<div class="modelpick"><button type="button" class="btn" data-act="modelmenu">' + esc(state.model) + '</button>' +
      (state.modelMenu ? '<div class="modelmenu" id="modelmenu">' + list.map(function (m) {
        return '<button type="button" data-act="modelpick" data-model="' + esc(m) + '"' + (m === state.model ? ' class="on"' : '') + '>' + esc(m) + '</button>';
      }).join('') + '</div>' : '') + '</div>';
  }
  function fmtTokens(n) {
    return new Intl.NumberFormat('de-DE').format(Math.max(0, Math.round(n || 0)));
  }
  function tokenMeter() {
    var u = state.usage || { used: 0, limit: TOKEN_LIMIT };
    var limit = u.limit || TOKEN_LIMIT;
    var pct = Math.max(0, Math.min(100, (u.used / limit) * 100));
    var left = Math.max(0, limit - u.used);
    return '<div class="metric tokenmeter" title="' + esc(u.source === 'counter' ? 'Verbrauch (Zähler)' : 'Verbrauch dieser Sitzung') + '"><span>Astra Tokens</span><b>' + fmtTokens(u.used) + '</b><div class="meter"><i style="width:' + pct.toFixed(1) + '%"></i></div><small>' + fmtTokens(left) + ' von ' + fmtTokens(limit) + ' frei</small></div>';
  }
  function topbar(extra) {
    return '<header class="topbar">' + brand() + viewNav() + tokenMeter() + (extra || '') + bell() +
      '<button type="button" class="avatar icon" data-act="prefs-open" title="Feineinstellungen">' + ic('gear') + '</button></header>';

  }

  function sessionList(extraClass) {
    var demo = state.sessions.map(sessionBtn).join('');
    var fleet = state.fleet.length ? '<div class="side-head">Flotte</div>' + state.fleet.map(sessionBtn).join('') : '';
    return '<div class="' + (extraClass || 'scroll') + '">' + demo + fleet + '</div>';
  }
  function sessionBtn(s) {
    return '<button type="button" class="session' + (s.id === state.session ? ' on' : '') + '" data-act="session" data-id="' + esc(s.id) + '"><i class="mark"></i><span class="grow"><b>' + esc(s.code) + ' / ' + esc(s.title) + '</b><small>' + esc(s.ago) + '</small></span></button>';
  }

  function nodeById(id) {
    var found = null;
    D.layers.forEach(function (layer) {
      layer.nodes.forEach(function (n) { if (n.id === id) found = n; });
    });
    return found;
  }
  function orchestration() {
    var selected = nodeById(state.node);
    return '<div class="screen">' + topbar('<span class="muted">Modell</span>' + modelPicker() + '<button type="button" class="btn" data-act="collapse">' + (state.collapsed ? 'Alle aufklappen' : 'Alle einklappen') + '</button>') +
      '<div class="canvas-screen"><div class="canvas scroll"><div class="between" style="margin-bottom:8px"><div><div class="kicker">' + ic('nodes') + ' Agent-Orchestration-Canvas</div><div class="muted">Live · Hierarchisch · Multi-Agent-Ausführung</div></div><span class="pill">' + (selected ? esc(selected.title) : '') + '</span></div>' +
      '<div class="spine"></div>' + D.layers.map(function (layer) {
        return '<section class="layer"><div class="kicker">' + ic(layer.icon) + '<span><h3>' + esc(layer.name).toUpperCase() + '</h3><small>' + esc(layer.sub) + '</small></span></div>' +
          (state.collapsed ? '' : '<div class="nodes">' + layer.nodes.map(function (n) {
            var cls = 'node' + (n.core ? ' core' : '') + (n.id === state.node ? ' on' : '');
            return '<button type="button" class="' + cls + '" data-act="node" data-id="' + n.id + '"><b>' + esc(n.title) + '</b><span class="sub">' + (n.status === 'locked' ? '🔒 ' : '') + esc(n.sub) + '</span></button>';
          }).join('') + '</div>') + '</section>';
      }).join('') +
      '<div class="legend"><span><i style="background:#2ee6f0"></i>Aktiv / Ausführung</span><span><i style="background:#3ee0a0"></i>Abgeschlossen</span><span><i style="background:#5b9dff"></i>Bereit</span><span><i style="background:#6d829b"></i>Ausstehend</span><span>🔒 Gesperrt / Kernknoten</span></div></div>' +
      '<aside class="dashrail scroll">' + overviewCards() + '</aside></div></div>';
  }

  function overviewCards() {
    var s = session();
    return '<div class="between"><h3 style="margin:0">' + ic('target') + ' Übersichts-Dashboard</h3><span class="pill"><i class="dot"></i> Live</span></div>' +
      '<article class="card"><h3>' + ic('clock') + ' Missions-Timeline</h3><ul class="tl">' + D.timeline.map(function (ev) {
        var col = ev.state === 'now' ? 'cyan' : (ev.state === 'wait' ? 'wait' : 'green');
        return '<li><i class="dot ' + col + '"></i><span class="faint">' + esc(ev.t) + '</span><span><b>' + esc(ev.title) + '</b><div class="muted">' + esc(ev.detail) + '</div></span></li>';
      }).join('') + '</ul></article>' +
      '<article class="card"><div class="between"><h3>' + ic('target') + ' Ziel-Fortschritt</h3><b class="cyan">' + state.progress + '%</b></div><div class="bar"><i style="width:' + state.progress + '%"></i></div><div class="muted" style="margin-top:8px">Primäres Ziel<br>' + esc(s.goal) + '</div><div class="pill" style="margin-top:8px">' + (state.paused ? 'Pausiert' : 'In Arbeit') + '</div></article>' +
      '<article class="card"><h3>' + ic('db') + ' Kontext-Zusammenfassung</h3><div class="kv"><div><span class="faint">Aktiver Kontext</span><b>' + esc(s.title) + '</b></div><div><span class="faint">Wichtige Randbedingungen</span><b>Sicherheit, Auditierbarkeit</b></div><div><span class="faint">Relevante Bereiche</span><b>Auth, Berechtigungen, API</b></div><div><span class="faint">Sitzungsdauer</span><b id="durClock2">' + dur() + '</b></div></div></article>' +
      '<article class="card"><div class="between"><h3>' + ic('pulse') + ' Aktivitäts-Feed</h3><span class="pill">Live-Feed</span></div>' + D.feed.map(function (f) {
        return '<div class="feedrow"><b class="grow">' + esc(f.who) + '</b><span class="pill">' + esc(f.status) + '</span><span class="muted">' + esc(f.text) + '</span><span class="faint">' + esc(f.ago) + '</span></div>';
      }).join('') + '</article>';
  }
  function overview() {
    return '<div class="screen">' + topbar('<span class="pill"><i class="dot"></i> Live</span>') + '<div class="overview-page scroll">' + overviewCards() + '</div></div>';
  }

  function filteredCatalog() {
    var q = state.marketQuery.trim().toLowerCase();
    return state.catalog.filter(function (p) {
      if (state.marketSide === 'installed' && !p.installed) return false;
      if (state.marketSide === 'updates' && !(p.installed && (p.id === 'copilot' || p.id === 'vector'))) return false;
      if (state.marketSide === 'marketplace' && state.marketCat !== 'All' && p.cat !== state.marketCat) return false;
      if (!q) return true;
      return (p.name + ' ' + p.blurb + ' ' + p.cat).toLowerCase().indexOf(q) >= 0;
    });
  }
  function market() {
    var cats = ['Tools', 'Skills', 'UI', 'Memory', 'Workflow'];
    var side = [
      ['marketplace', 'bag', 'Marktplatz'],
      ['installed', 'check', 'Installiert'],
      ['updates', 'refresh', 'Updates'],
      ['settings', 'gear', 'Einstellungen']
    ];
    var body;
    if (state.marketSide === 'settings') {
      body = '<div class="page"><h2>Marktplatz-Einstellungen</h2><p class="muted">Plugins laufen in einer Sandbox mit minimalen Rechten.</p><div class="setting"><label>Bevorzugtes Modell</label>' + modelPicker() + '<p class="muted">Marktplatz gerade synchronisiert.</p></div></div>';
    } else {
      var cards = filteredCatalog();
      body = '<div class="m-head"><div class="between"><h1>' + (state.marketSide === 'installed' ? 'Installiert' : state.marketSide === 'updates' ? 'Updates' : 'Plugin-Marktplatz') + '</h1>' +
        '<label class="searchline find" style="min-width:280px"><span class="ic">' + ic('search') + '</span><input id="marketSearch" placeholder="Plugins, Tools, Skills oder Schlüsselwörter suchen …" value="' + esc(state.marketQuery) + '"></label></div>' +
        '<p class="muted">Erweitere deinen Coding-Agent um Plugins für Tools, Skills, UI, Memory und Workflows.</p></div>' +
        (state.marketSide === 'marketplace' ? '<div class="cats">' + cats.map(function (c) {
          return '<button type="button" class="chip' + (state.marketCat === c ? ' on' : '') + '" data-act="cat" data-cat="' + c + '">' + c + '</button>';
        }).join('') + '</div>' : '') +
        '<div class="scroll grow"><div class="grid3" id="marketGrid">' + (cards.length ? cards.map(cardHtml).join('') : '<div class="empty">Keine Plugins passen zur Suche.</div>') + '</div></div>';
    }
    return '<div class="screen">' + topbar('') + '<div class="market"><aside class="m-side"><div class="brand" style="padding:6px"><span class="logo"><img src="assets/mark.jpg" alt=""></span><span><b>Astra Harness</b><small>Eine API</small></span></div><nav class="m-nav">' +
      side.map(function (item) {
        return '<button type="button" data-act="mside" data-side="' + item[0] + '"' + (state.marketSide === item[0] ? ' class="on"' : '') + '>' + ic(item[1]) + ' ' + item[2] + '</button>';
      }).join('') + '</nav>' + astraChip() + '</aside><section class="m-main">' + body +
      '<footer class="m-foot"><span>' + ic('shield') + ' Plugins laufen in einer Sandbox mit minimalen Rechten.</span><span>' + ic('refresh') + ' Marktplatz gerade synchronisiert <i class="dot"></i></span></footer></section></div></div>';
  }
  function cardHtml(p) {
    var action = p.installed
      ? '<button type="button" class="btn" data-act="uninstall" data-id="' + p.id + '">' + ic('check') + ' Installiert</button>'
      : '<button type="button" class="btn" data-act="install" data-id="' + p.id + '">' + ic('plus') + ' Installieren</button>';
    if (state.marketSide === 'updates') action = '<button type="button" class="btn primary" data-act="toast" data-msg="' + esc(p.name) + ' ist in diesem Build bereits aktuell.">Aktualisieren</button>';
    return '<article class="card mcard"><div class="between"><span style="color:' + p.color + '">' + ic(p.icon) + '</span>' + (p.verified ? '<span class="badge">✓ Verifiziert</span>' : '<span class="faint">Community</span>') + '</div><h3>' + esc(p.name) + '</h3><p>' + esc(p.blurb) + '</p><div class="between"><span class="muted">★ ' + esc(p.stars) + '</span>' + action + '</div></article>';
  }

  function chat() {
    var showContext = state.chatLayout === 'studio' || state.chatLayout === 'phases';
    var panes = [['chat', 'chat', 'Chat'], ['tasks', 'list', 'Aufgaben'], ['memory', 'clock', 'Speicher'], ['knowledge', 'star', 'Wissen'], ['agents', 'users', 'Agenten'], ['settings', 'gear', 'Einstellungen']];
    return '<div class="screen">' + topbar('<span class="pill"><i class="dot"></i> ' + (state.working && !state.paused ? 'Agent arbeitet' : 'Online') + '</span>') +
      '<div class="chat' + (showContext ? '' : ' no-context') + '"><aside class="rail"><div class="pane-head"><span>' + ic('bot') + ' CodeAgent</span><span class="pill">v2.4.1</span></div><nav class="rail-nav">' +
      panes.map(function (p) {
        return '<button type="button" data-act="cpane" data-pane="' + p[0] + '"' + (state.chatPane === p[0] ? ' class="on"' : '') + '>' + ic(p[1]) + ' ' + p[2] + '</button>';
      }).join('') + '</nav><div class="side-head">Neueste</div><div class="scroll">' + state.sessions.slice(0, 4).map(function (s) {
        return '<button type="button" class="conv" data-act="session" data-id="' + esc(s.id) + '"><span class="grow"><b>' + esc(s.title) + '</b><small>' + esc(s.ago) + '</small></span></button>';
      }).join('') + '</div>' + astraChip() + '</aside>' +
      '<section class="thread"><div class="thread-head between"><div><b>Chat mit CodeAgent</b><div class="muted">Dein KI-Assistent für Softwareentwicklung</div></div><div class="row">' +
      ['studio', 'thread', 'phases', 'code'].map(function (l) {
        var chipLabel = ({ studio: 'Studio', thread: 'Thread', phases: 'Phasen', code: 'Code' })[l] || l;
        return '<button type="button" class="chip' + (state.chatLayout === l ? ' on' : '') + '" data-act="layout" data-layout="' + l + '">' + chipLabel + '</button>';
      }).join('') + '</div></div>' + (state.chatPane === 'chat' ? threadBody() : paneBody()) + '</section>' +
      (showContext ? contextRail() : '') + '</div></div>';
  }
  function threadBody() {
    return '<div class="msgs scroll" id="msgs">' + state.messages.map(renderMsg).join('') + filePreview() +
      (state.working ? '<div class="thinking">' + ic('spark') + ' Agent denkt nach …</div>' : '') + '</div>' + composer();
  }
  function renderMsg(m) {
    if (state.chatLayout === 'thread') return bubble(m);
    if (state.chatLayout === 'code') return codeLayout(m);
    if (state.chatLayout === 'phases') return phaseLayout(m);
    return studioLayout(m);
  }
  function humanizeChatError(err) {
    var status = Number(err && err.status) || 0;
    var raw = String((err && err.message) || '');
    if (status === 429 || /429|rate.?limit|FreeUsageLimit/i.test(raw)) {
      return 'Keine Antwort vom Modell: Das Kontingent beim Anbieter ist erschöpft (429). Das ist kein Fehler der App — bitte später erneut versuchen oder einen zweiten Upstream eintragen.';
    }
    if (status === 401) return 'Keine Antwort vom Modell: Der Gateway-Token wurde abgelehnt (401).';
    if (status >= 500) return 'Keine Antwort vom Modell: Gateway/Upstream nicht erreichbar (' + status + ').';
    return 'Keine Antwort vom Modell: ' + (raw || 'unbekannter Fehler');
  }
  function who(m) {
    var name = m.role === 'user' ? 'Du' : (m.error ? 'System' : 'CodeAgent');
    return '<div class="who">' + (m.role === 'user' ? ic('user') : ic('bot')) + '<b>' + name + '</b><span class="faint">' + esc(m.time) + '</span></div>';
  }
  function bubble(m) {
    if (m.role === 'user') {
      return '<div class="userwrap"><div class="bubble user"><div>' + esc(m.text) + '</div><div class="faint" style="text-align:right">' + esc(m.time) + '</div></div><img class="avatar" src="assets/mark.jpg" alt=""></div>';
    }
    return '<article class="msg' + (m.error ? ' err' : '') + '">' + who(m) + '<div>' + esc(m.text) + '</div>' + bullets(m) + codeBox(m) + react(m) + '</article>';
  }
  function studioLayout(m) {
    if (m.role === 'user') return '<article class="msg' + (m.error ? ' err' : '') + '">' + who(m) + '<div>' + esc(m.text) + '</div></article>';
    var progress = m.progress ? '<div class="progress-card"><div><div class="kicker cyan">' + ic('bolt') + ' Agent-Fortschritt</div><b>Arbeite an: ' + esc(session().title) + '</b><ul class="checks">' +
      state.workSteps.map(function (step, i) {
        return '<li class="' + (step.done ? 'done' : '') + '"><button type="button" class="check" data-act="step" data-i="' + i + '">' + (step.done ? '✓' : '') + '</button>' + esc(step.text) + '</li>';
      }).join('') + '</ul><div class="between muted"><span>Arbeite … das kann ein paar Minuten dauern.</span><span>Voraussichtlich ~2 Min.</span></div></div>' + ring(state.progress) + '</div>' : '';
    var stream = m.streaming ? '<div id="streamBody">' + esc(m.text) + '</div>' : '<div>' + esc(m.text) + '</div>';
    return '<article class="msg' + (m.error ? ' err' : '') + '">' + who(m) + stream + progress + bullets(m) + codeBox(m) + (m.ask ? '<p>' + esc(m.ask) + '</p>' : '') + react(m) + '</article>';
  }
  function phaseLayout(m) {
    if (m.role === 'user') return bubble(m);
    var phase = m.phase ? '<div class="phases"><span class="chip on">' + esc(m.phase) + '</span><span class="chip">Prüfung</span></div>' : '';
    var checks = (m.checks || []).map(function (c) { return '<li class="done"><span class="check">✓</span>' + esc(c) + '</li>'; }).join('');
    var tools = (m.tools || []).map(function (t) {
      return '<div class="tool" style="margin-top:6px;padding:8px">' + ic('terminal') + ' ' + esc(t.name) + ' <span class="faint">(' + esc(t.args) + ')</span></div>';
    }).join('');
    var reason = m.reasoning ? '<button type="button" class="linkish" data-act="reason" data-id="' + m.id + '">Begründung ' + (state.reason[m.id] ? '▾' : '▸') + '</button>' +
      (state.reason[m.id] ? '<div class="muted">' + esc(m.reasoning) + '</div>' : '') : '';
    return '<article class="msg' + (m.error ? ' err' : '') + '">' + who(m) + '<div>' + (m.streaming ? '<span id="streamBody">' + esc(m.text) + '</span>' : esc(m.text)) + '</div>' + phase +
      (checks ? '<ul class="checks">' + checks + '</ul>' : '') + tools + bullets(m) + reason + '</article>';
  }
  function codeLayout(m) {
    if (!m.code && m.role === 'user') return '<article class="msg' + (m.error ? ' err' : '') + '">' + who(m) + esc(m.text) + '</article>';
    if (!m.code) return '';
    return '<article class="msg' + (m.error ? ' err' : '') + '">' + who(m) + '<div>' + esc(m.text) + '</div>' + codeBox(m) + '</article>';
  }
  function bullets(m) {
    if (!m.bullets) return '';
    return '<ul class="checks">' + m.bullets.map(function (b) { return '<li class="done"><span class="check">•</span>' + esc(b) + '</li>'; }).join('') + '</ul>';
  }
  function codeBox(m) {
    if (!m.code) return '';
    return '<div class="codebox"><header><span>' + esc(m.code.file) + '</span><button type="button" class="iconbtn tiny" data-act="copy" data-id="' + m.id + '" title="Kopieren">' + ic('copy') + '</button></header><pre>' + esc(m.code.body) + '</pre></div>';
  }
  function react(m) {
    if (m.role !== 'agent') return '';
    var up = state.liked[m.id] === 'up' ? ' on' : '';
    var down = state.liked[m.id] === 'down' ? ' on' : '';
    return '<div class="actions"><button type="button" class="iconbtn tiny" data-act="copytext" data-id="' + m.id + '" title="Kopieren">' + ic('copy') + '</button>' +
      '<button type="button" class="iconbtn tiny' + up + '" data-act="like" data-id="' + m.id + '" data-vote="up">' + ic('thumb') + '</button>' +
      '<button type="button" class="iconbtn tiny' + down + '" data-act="like" data-id="' + m.id + '" data-vote="down">' + ic('thumb') + '</button></div>';
  }
  function filePreview() {
    if (!state.preview) return '';
    var f = D.files[state.file];
    if (!f) return '';
    return '<article class="msg"><div class="kicker">' + ic('file') + ' ' + esc(f.crumb || state.file) + '</div><div class="codebox"><pre>' + esc(f.body || '') + '</pre></div></article>';
  }
  function composer() {
    var disabled = state.paused ? ' disabled' : '';
    return '<div class="composer-wrap"><div class="quick"><span class="muted">Schnellaktionen</span>' +
      quick('plan', 'Plan ansehen') + quick('pause', state.paused ? 'Fortsetzen' : 'Pausieren') + quick('stop', 'Stopp') +
      quick('tests', 'Tests ausführen') + quick('explain', 'Erklären') + quick('refactor', 'Refactoring') + '</div>' +
      '<form class="composer" id="composerForm"><span class="muted">' + ic('clip') + '</span><input id="composer" placeholder="' + (state.paused ? 'Agent pausiert' : 'Nachricht an Coding Agent …') + '"' + disabled + '><button class="send iconbtn" type="submit" title="Senden"' + disabled + '>' + ic('send') + '</button></form>' +
      '<div class="disclaimer">CodeAgent kann Fehler machen. Prüfe wichtigen Code und Änderungen.</div></div>';
  }
  function quick(id, label) {
    return '<button type="button" class="chip" data-act="quick" data-q="' + id + '">' + label + '</button>';
  }
  function contextRail() {
    var s = session();
    var done = state.workSteps.filter(function (x) { return x.done; }).length;
    return '<aside class="context scroll"><div class="between"><h3>' + ic('doc') + ' Kontext-Zusammenfassung</h3><button type="button" class="btn" data-act="toast" data-msg="Kontext aus dem geöffneten Workspace aktualisiert.">' + ic('refresh') + ' Aktualisieren</button></div>' +
      '<article class="card"><h3>' + ic('target') + ' Ziel</h3><div>' + esc(s.goal) + '</div><div class="between" style="margin-top:8px"><span>Fortschritt</span><b>' + state.progress + '%</b></div><div class="bar"><i style="width:' + state.progress + '%"></i></div></article>' +
      '<article class="card"><h3>' + ic('bolt') + ' Aktueller Fokus</h3><div class="muted">Verbessere die Resilienz des Zahlungsablaufs durch Retries, Logging und Tests.</div><div class="pill" style="margin-top:8px">' + done + ' / ' + state.workSteps.length + ' Schritte</div></article>' +
      '<article class="card"><h3>' + ic('list') + ' Wichtige Änderungen</h3><ul class="checks">' + state.workSteps.map(function (step) {
        return '<li class="' + (step.done ? 'done' : '') + '"><span class="check">' + (step.done ? '✓' : '') + '</span>' + esc(step.text) + '</li>';
      }).join('') + '</ul></article>' +
      '<article class="card"><h3>' + ic('folder') + ' Beteiligte Dateien</h3><ul>' +
      ['src/services/payment_service.py', 'src/services/idempotency.py', 'tests/test_payment.py'].map(function (p) {
        return '<li><button type="button" class="linkish" data-act="openfile" data-path="' + esc(p) + '">' + esc(p) + '</button></li>';
      }).join('') + '</ul></article>' +
      '<article class="card"><h3>' + ic('spark') + ' Aktive Skills</h3><ul>' + D.skills.slice(0, 5).map(function (sk) {
        return '<li><span>' + esc(sk.name) + '</span><span class="cyan">' + esc(sk.state) + '</span></li>';
      }).join('') + '</ul><button type="button" class="linkish" data-act="cpane" data-pane="agents">Skills verwalten →</button></article>' +
      '<p class="muted">Fokus auf Zuverlässigkeit und Beobachtbarkeit. Bestehendes Verhalten bleibt erhalten, während der Zahlungsablauf robuster wird.</p></aside>';
  }
  function paneBody() {
    if (state.chatPane === 'tasks') {
      return '<div class="page scroll"><h2>Aufgaben</h2><ul class="checks">' + state.workSteps.map(function (step, i) {
        return '<li class="' + (step.done ? 'done' : '') + '"><button type="button" class="check" data-act="step" data-i="' + i + '">' + (step.done ? '✓' : '') + '</button>' + esc(step.text) + '</li>';
      }).join('') + '</ul><h2 style="margin-top:18px">Plan</h2><ul class="checks">' + state.plan.map(function (step, i) {
        return '<li class="' + (step.done ? 'done' : '') + '"><button type="button" class="check" data-act="plan" data-i="' + i + '">' + (step.done ? '✓' : '') + '</button>' + esc(step.text) + '</li>';
      }).join('') + '</ul></div>';
    }
    if (state.chatPane === 'memory') {
      return '<div class="page scroll"><h2>Speicher</h2><div class="grid3">' + D.layers[3].nodes.map(function (n) {
        return '<article class="card"><h3>' + esc(n.title) + '</h3><p class="muted">' + esc(n.sub) + '</p></article>';
      }).join('') + '</div></div>';
    }
    if (state.chatPane === 'knowledge') {
      return '<div class="page scroll"><h2>Wissen</h2><article class="card"><b>Randbedingungen</b><p class="muted">Sicherheit, Auditierbarkeit, Skalierbarkeit. Keine offengelegten Geheimnisse. Minimale Rechte für Tools.</p><b>Bereiche</b><p class="muted">Auth, Berechtigungen, API-Sicherheit, Zahlungen.</p></article></div>';
    }
    if (state.chatPane === 'agents') {
      return '<div class="page scroll"><h2>Agenten & Skills</h2><div class="list">' + D.layers[0].nodes.concat([]).map(function (n) {
        return '<article class="card between"><span><b>' + esc(n.title) + '</b><div class="muted">' + esc(n.sub) + '</div></span><span class="pill">' + esc(n.status) + '</span></article>';
      }).join('') + D.skills.map(function (sk) {
        return '<article class="card between"><span><b>' + esc(sk.name) + '</b><div class="muted">' + esc(sk.detail) + '</div></span><span class="pill">' + esc(sk.state) + '</span></article>';
      }).join('') + '</div></div>';
    }
    var apiLine = !state.api ? 'Astra-Token wird gebunden…' : (state.api.ok ? esc(state.api.masked) + ' · ' + esc(state.api.model || state.api.family) : esc(state.api.error || 'nicht verbunden'));
    return '<div class="page scroll"><h2>API</h2><article class="card"><b>Gateway-API</b><p class="muted">Diese Anwendung spricht mit deinem fr-gateway und nutzt das Astra-Modell. Der Key kommt aus data/astra-key.txt oder der fr-gateway-Registry.</p><p>' + apiLine + '</p></article><h2 style="margin-top:18px">Einstellungen</h2><div class="setting"><label>Modell</label>' + modelPicker() + '<p class="muted">Änderungen bleiben auf dem Workspace-Branch, bis du einen PR erstellst.</p><button type="button" class="btn" data-act="clearchat">Unterhaltung löschen</button></div></div>';
  }

  function roleDock(role) {
    if (!role) {
      return '<div class="role-dock empty-dock"><div class="dock-card"><b>Workspace</b><p class="muted">Lege unter Workspaces einen festen Arbeitsordner an. Hier verbindest du ihn danach mit der Rolle.</p><button type="button" class="btn" data-act="nav" data-view="spaces">Zu Workspaces</button></div></div>';
    }
    var linked = state.spaces.filter(function (s) { return s.id === role.spaceId; })[0];
    var work = linked
      ? '<div class="path-locked" title="' + esc(linked.path) + '"><span class="lock">🔒</span><code>' + esc(linked.path) + '</code></div><p class="faint">Kommt aus Workspace „' + esc(linked.name) + '“ und bleibt fest.</p>'
      : (state.spaces.length
        ? '<div class="space-pick">' + state.spaces.map(function (s) {
            return '<button type="button" class="btn" data-act="role-space" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>';
          }).join('') + '</div><p class="faint">Wähle einen Workspace. Der Ordner wird fest übernommen.</p>'
        : '<p class="muted">Noch kein Workspace. Lege zuerst unter Workspaces einen festen Ordner an.</p><button type="button" class="btn" data-act="nav" data-view="spaces">Zu Workspaces</button>');
    var rpath = role.rolePathLocked
      ? '<div class="path-locked" title="' + esc(role.rolePath) + '"><span class="lock">🔒</span><code>' + esc(role.rolePath) + '</code></div><p class="faint">Rollenpfad ist optional und bereits gesetzt.</p>'
      : '<form class="dock-form" data-bind="rolepath"><input id="rolePathInput" placeholder="optional: Ordner für Rollenakten" value="' + esc(role.rolePath || '') + '"><button type="submit" class="btn">Optional binden</button></form>';
    var skills = (role.skills || []).length;
    var tasks = (role.tasks || []).length;
    var autos = (role.automations || []).length;
    return '<div class="role-dock">' +
      '<div class="dock-card"><b>Fester Workspace</b><p class="muted">Arbeitsordner kommen aus Workspaces, nicht hier.</p>' + work + '</div>' +
      '<div class="dock-card"><b>Rollenpfad</b><p class="muted">Optional. Für Specs oder Prompt-Akten der Rolle.</p>' + rpath + '</div>' +
      '<div class="dock-card pulse-card"><b>Puls</b><div class="pulse-grid"><span><i>' + skills + '</i> Skills</span><span><i>' + tasks + '</i> Tasks</span><span><i>' + autos + '</i> Autos</span><span class="' + (role.alive ? 'live' : '') + '"><i>' + (role.alive ? '●' : '○') + '</i> ' + (role.alive ? 'lebendig' : 'Entwurf') + '</span></div></div>' +
      '</div>';
  }
  function kitBlock(role, key, title, placeholder) {
    var items = role[key] || [];
    var pills = items.map(function (item, i) {
      return '<span class="kit-pill">' + esc(item) + '<button type="button" data-act="kit-del" data-kit="' + key + '" data-i="' + i + '" aria-label="entfernen">×</button></span>';
    }).join('');
    return '<section class="kit"><b>' + title + '</b><div class="kit-pills">' + (pills || '<span class="faint">noch leer</span>') + '</div><form class="kit-add" data-kit="' + key + '"><input placeholder="' + esc(placeholder) + '"><button type="submit" class="btn">+</button></form></section>';
  }
  function currentRole() {
    return state.roles.filter(function (r) { return r.id === state.roleId; })[0] || null;
  }
  function currentSpace() {
    return state.spaces.filter(function (s) { return s.id === state.spaceId; })[0] || null;
  }
  function rolesView() {
    var role = currentRole();
    var list = state.roles.map(function (r) {
      return '<button type="button" class="role-item' + (r.id === state.roleId ? ' on' : '') + '" data-act="role" data-id="' + esc(r.id) + '"><i class="mark"></i><span class="grow"><b>' + esc(r.name || 'Unbenannte Rolle') + '</b></span><span class="role-pill' + (r.alive ? ' live' : '') + '">' + (r.alive ? 'lebendig' : 'Entwurf') + '</span></button>';
    }).join('');
    var thread = role ? (role.thread || []).map(function (m) {
      return '<article class="msg' + (m.error ? ' err' : '') + '"><div class="who"><b>' + (m.role === 'user' ? 'Du' : (m.error ? 'System' : 'Astra')) + '</b></div><div>' + esc(m.content || '') + '</div></article>';
    }).join('') : '';
    var sheet = role ? '<article class="card role-core"><h3>Rollenkern</h3><label>Name</label><input data-field="name" value="' + esc(role.name || '') + '"><label>Mandat</label><textarea data-field="mandate">' + esc(role.mandate || '') + '</textarea><label>Stimme</label><textarea data-field="voice">' + esc(role.voice || '') + '</textarea><label>Grenzen</label><textarea data-field="bounds">' + esc(role.bounds || '') + '</textarea><button type="button" class="btn primary" data-act="awaken">' + (role.alive ? 'Lebendig' : 'Zum Leben erwecken') + '</button>' + kitBlock(role, 'skills', 'Skills', 'zum Beispiel Code Review') + kitBlock(role, 'tasks', 'Tasks', 'zum Beispiel Tests schreiben') + kitBlock(role, 'automations', 'Automationen', 'zum Beispiel täglich 02:00') + '</article>' : '<article class="card"><p class="muted">Lege eine Rolle an und sprich mit Astra, bis Mandat, Stimme, Grenzen, Skills, Tasks und Automationen stehen.</p></article>';
    return '<div class="screen roles-screen">' + topbar('') + '<div class="chat"><aside class="rail role-rail"><div class="pane-head"><span>Rollen</span><button type="button" class="iconbtn" data-act="role-new" title="Neue Rolle">' + ic('plus') + '</button></div><div class="role-list">' + (list || '<p class="empty">Noch keine Rolle.</p>') + '</div>' + roleDock(role) + astraChip() + '</aside><section class="thread"><div class="thread-head"><b>Rolle zum Leben erwecken</b><div class="muted">Internes Gespräch mit deiner LLM. Das formt die Rolle, es ist nicht der Coding-Chat.</div></div><div class="msgs" id="roleMsgs">' + thread + (state.working && state.liveKind === 'role' ? '<div class="thinking">Astra schreibt…</div>' : '') + '</div><form class="composer" id="roleForm"><input id="roleComposer" placeholder="' + (role ? 'Mit Astra über diese Rolle sprechen…' : 'Zuerst eine Rolle anlegen') + '"' + (role ? '' : ' disabled') + '><button class="send iconbtn" type="submit">' + ic('send') + '</button></form></section><aside class="context role-sheet">' + sheet + '</aside></div></div>';
  }
  function failoverView() {
    var fo = state.failover || {};
    var used = (state.usage && state.usage.used) || 0;
    var limit = (state.usage && state.usage.limit) || TOKEN_LIMIT;
    var remPct = Math.max(0, ((limit - used) / limit) * 100);
    var cards = (state.instances || []).map(function (inst) {
      var conf = (fo.instances || []).filter(function (i) { return Number(i.nr) === Number(inst.nr); })[0] || inst;
      var on = !!conf.enabled;
      return '<article class="fail-card' + (on ? ' on' : '') + (fo.activeNr === inst.nr ? ' active' : '') + '">' +
        '<div class="between"><div><b>Claude · ' + esc(inst.family) + '</b><div class="faint">' + esc(inst.masked) + '</div></div>' +
        '<button type="button" class="sw' + (on ? ' on' : '') + '" data-act="fo-toggle" data-nr="' + inst.nr + '"><i></i></button></div>' +
        '<div class="fail-grid">' +
        '<label>Priorität<input type="number" min="1" max="99" data-fo="priority" data-nr="' + inst.nr + '" value="' + (conf.priority || 50) + '"></label>' +
        '<label>Max Tokens<input type="number" min="64" max="8000" data-fo="maxTokens" data-nr="' + inst.nr + '" value="' + (conf.maxTokens || 1200) + '"></label>' +
        '<label>Temperature<input type="number" min="0" max="1.5" step="0.1" data-fo="temperature" data-nr="' + inst.nr + '" value="' + (conf.temperature != null ? conf.temperature : 0.4) + '"></label>' +
        '<label>Limit<span class="fail-static">' + fmtTokens(inst.limit || 2000000) + '</span></label>' +
        '</div>' +
        (fo.activeNr === inst.nr ? '<div class="pill" style="margin-top:8px">gerade aktiv</div>' : '') +
        '</article>';
    }).join('');
    return '<div class="screen failover-screen">' + topbar('') +
      '<div class="failover-layout">' +
      '<section class="card fail-settings">' +
      '<h2>Failover</h2>' +
      '<p class="muted">Primär ist die Astra-API. Ein Failover auf weitere Instanzen ist aktuell nicht konfiguriert.</p>' +
      '<div class="between" style="margin:10px 0"><b>Automatisch umschalten</b><button type="button" class="sw' + (fo.enabled ? ' on' : '') + '" data-act="fo-master"><i></i></button></div>' +
      '<label>Schwellwert Rest %<input type="number" min="1" max="50" data-fo-global="thresholdPct" value="' + (fo.thresholdPct || 15) + '"></label>' +
      '<label>Hysterese %<input type="number" min="0" max="30" data-fo-global="hysteresisPct" value="' + (fo.hysteresisPct || 10) + '"></label>' +
      '<div class="between" style="margin:10px 0"><b>Sticky auf Backup</b><button type="button" class="sw' + (fo.sticky ? ' on' : '') + '" data-act="fo-sticky"><i></i></button></div>' +
      '<label>Familie<select data-fo-global="preferFamily"><option value="astra"' + (fo.preferFamily !== 'any' ? ' selected' : '') + '>nur Astra</option><option value="any"' + (fo.preferFamily === 'any' ? ' selected' : '') + '>Astra und andere</option></select></label>' +
      '<div class="fail-status"><span>Rest Primär</span><b>' + remPct.toFixed(1) + '%</b><span>Route</span><b>' + (state.routeVia === 'failover' ? 'Failover' : 'Primär') + '</b></div>' +
      '<button type="button" class="btn primary" data-act="fo-save" style="margin-top:12px;width:100%">Einstellungen speichern</button>' +
      '</section>' +
      '<section class="fail-board"><div class="between"><h2>Instanzen</h2><span class="muted">Einschalten in Prioritätsreihenfolge</span></div>' +
      '<div class="fail-grid-cards">' + (cards || '<div class="empty-space card"><b>Keine weiteren Instanzen</b><p class="muted">Die Registry hat neben dem Primär-Token keine weiteren Harness-Einträge.</p></div>') + '</div></section>' +
      '</div></div>';
  }
  function spacesView() {
    var active = currentSpace();
    var cards = state.spaces.map(function (s) {
      var linked = state.roles.filter(function (r) { return r.spaceId === s.id; }).length;
      return '<article class="space-card' + (s.id === state.spaceId ? ' on' : '') + '" data-act="space" data-id="' + esc(s.id) + '">' +
        '<div class="between"><b>' + esc(s.name) + '</b><span class="role-pill live">🔒 fest</span></div>' +
        '<p class="muted">' + esc(s.goal || 'ohne Ziel') + '</p>' +
        '<div class="path-locked"><span class="lock">📁</span><code>' + esc(s.path) + '</code></div>' +
        '<div class="space-meta"><span>' + (s.id === state.spaceId ? 'aktiv' : 'wählen') + '</span><span>' + linked + ' Rolle' + (linked === 1 ? '' : 'n') + '</span><span>' + esc((s.created || '').slice(0, 10)) + '</span></div>' +
        '</article>';
    }).join('');
    return '<div class="screen spaces-screen">' + topbar('') +
      '<div class="spaces-layout">' +
      '<section class="spaces-create card"><h2>Festen Arbeitsordner anlegen</h2><p class="muted">Der Ordner wird beim Anlegen festgebunden und lässt sich danach nicht mehr wechseln. Rollen greifen später darauf zu.</p>' +
      '<form id="spaceForm" class="setting">' +
      '<label>Name</label><input id="spaceName" placeholder="zum Beispiel payment-service" required>' +
      '<label>Ziel</label><input id="spaceGoal" placeholder="Was dieser Workspace erledigen soll">' +
      '<label>Arbeitsordner</label><input id="spacePath" placeholder="C:\\Projekte\\payment-service" required>' +
      '<button class="btn primary" type="submit">Workspace fest anlegen</button>' +
      '</form></section>' +
      '<section class="spaces-board">' +
      '<div class="between"><h2>Gebundene Workspaces</h2><span class="muted">' + (active ? 'Aktiv: ' + esc(active.name) : 'Noch keiner aktiv') + '</span></div>' +
      '<div class="spaces-grid">' + (cards || '<div class="empty-space card"><b>Noch leer</b><p class="muted">Lege links den ersten festen Arbeitsordner an. Er bleibt an den Pfad gebunden.</p></div>') + '</div>' +
      '</section></div></div>';
  }
  function screen() {
    if (state.view === 'roles') return rolesView();
    if (state.view === 'spaces') return spacesView();
    if (state.view === 'failover') return failoverView();
    if (state.view === 'orchestration') return orchestration();
    if (state.view === 'overview') return overview();
    if (state.view === 'market') return market();
    return chat();
  }
  function render() {
    var focus = document.activeElement;
    var focusId = focus && focus.id;
    var caret = focus && typeof focus.selectionStart === 'number' ? focus.selectionStart : null;
    document.getElementById('app').innerHTML = screen() + (state.prefsOpen ? prefsModal() : '');
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (caret != null && el.setSelectionRange) {
          try { el.setSelectionRange(caret, caret); } catch (e) { /* input type may reject */ }
        }
      }
    }
    var msgs = document.getElementById('msgs');
    if (msgs && state.stick) msgs.scrollTop = msgs.scrollHeight;
  }

  function go(view) {
    if (VIEWS.indexOf(view) < 0) return;
    state.view = view;
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    render();
  }
  function recalc() {
    var done = state.workSteps.filter(function (s) { return s.done; }).length;
    state.progress = Math.round((done / state.workSteps.length) * 100);
  }
  function localReply(text) {
    var q = text.toLowerCase();
    var msg = { id: nid(), role: 'agent', time: nowTime(), text: '' };
    if (q.indexOf('test') >= 0) {
      msg.text = 'Verstanden. Hier sind Unit-Tests, die die neue Logik abdecken.';
      msg.code = { file: 'test_user_service.py', body: 'def test_get_user_success(self):\n    user = self.agent.get_user("123")\n    assert user.id == "123"\n\ndef test_get_user_not_found(self):\n    with pytest.raises(UserNotFound):\n        self.agent.get_user("999")' };
    } else if (q.indexOf('auth') >= 0 || q.indexOf('token') >= 0 || q.indexOf('security') >= 0) {
      msg.text = 'Ich habe einige Bereiche gefunden, die eine Erwähnung wert sind. Hier eine Zusammenfassung der möglichen Probleme:';
      msg.findings = true;
      msg.phase = 'Prüfung';
      msg.bullets = [
        'Passwort-Reset-Tokens werden nach der Verwendung nicht ungültig gemacht.',
        'Sitzungs-IDs werden bei Weiterleitungen in URLs offengelegt.',
        'Passwortrichtlinien prüfen die Länge, aber keine häufigen Muster.'
      ];
      msg.reasoning = 'Login, Weiterleitung und Lebensdauer des Reset-Tokens gegen die Testsuite geprüft.';
    } else if (q.indexOf('refactor') >= 0) {
      msg.text = 'Funktion refaktoriert, um die Lesbarkeit zu verbessern und Verschachtelung zu reduzieren.';
      msg.code = { file: 'user_service.py', body: 'def get_user(self, user_id: str) -> User:\n    user = self.repo.fetch(user_id)\n    if user is None:\n        raise UserNotFound(user_id)\n    return user' };
    } else {
      var next = state.workSteps.filter(function (s) { return !s.done; })[0];
      if (next) next.done = true;
      recalc();
      msg.progress = true;
      msg.phase = 'Ausführung';
      msg.text = "Ich arbeite am Zahlungsablauf weiter: " + text;
      msg.tools = [{ name: 'edit_file', args: 'path=src/services/payment_service.py' }];
      msg.checks = ['Plan aktualisiert', 'Lese Projektstruktur'];
    }
    state.working = false;
    state.turns += 1;
    state.messages.push(msg);
    render();
  }
  function sendText(text) {
    text = (text || '').trim();
    if (!text) return;
    if (state.paused) { toast('Agent ist pausiert. Zum Senden fortsetzen.'); return; }
    state.messages.push({ id: nid(), role: 'user', time: nowTime(), text: text });
    state.working = true;
    state.liveKind = 'agent';
    state.stick = true;
    state.view = state.view === 'chat' ? 'chat' : state.view;
    var useAstra = !window.__UITEST && state.api && state.api.ok && window.api && window.api.chat;
    if (useAstra) {
      state.liveNr = state.api.nr;
      var draft = { id: nid(), role: 'agent', time: nowTime(), text: '', streaming: true };
      state.messages.push(draft);
      render();
      var history = state.messages.filter(function (m) { return m !== draft; }).map(function (m) {
        return { role: m.role === 'agent' ? 'assistant' : 'user', content: m.text };
      });
      var liveModel = state.models && state.models.indexOf(state.model) >= 0 ? state.model : '';
      if (state.prefs.systemPrompt) history.unshift({ role: 'system', content: state.prefs.systemPrompt });
      window.api.chat.send(state.api.nr, history, liveModel, { temperature: state.prefs.temperature, top_p: state.prefs.topP, max_tokens: state.prefs.maxTokens }).then(function (res) {
        if (!res || res.error) {
          state.working = false;
          draft.streaming = false;
          draft.text = (res && res.error) || 'Das Gateway hat die Anfrage nicht akzeptiert.';
          render();
        } else {
          state.stopKey = res.key;
          if (res.via) {
            state.routeVia = res.via;
            if (res.via === 'failover') toast('Failover aktiv');
          }
        }
      });
      return;
    }
    render();
    setTimeout(function () { localReply(text); }, 650);
  }
  function bridge() {
    if (!window.api) return null;
    return window.api.astra || window.api.astro || null;
  }
  function saveRole(role) {
    if (window.api && window.api.roles) window.api.roles.save(role).catch(function () {});
    try { localStorage.setItem('astra-roles', JSON.stringify(state.roles)); } catch (e) {}
  }
  function saveSpace(space) {
    if (window.api && window.api.spaces) window.api.spaces.save(space).catch(function () {});
    try { localStorage.setItem('astra-spaces', JSON.stringify(state.spaces)); } catch (e) {}
  }
  function sendRole(text) {
    text = (text || '').trim();
    var role = currentRole();
    if (!text || !role) return;
    if (state.paused) { toast('Agent ist pausiert. Zum Senden fortsetzen.'); return; }
    role.thread = role.thread || [];
    role.thread.push({ role: 'user', content: text });
    state.working = true;
    state.liveKind = 'role';
    state.view = 'roles';
    var useAstra = !window.__UITEST && state.api && state.api.ok && window.api && window.api.chat;
    if (useAstra) {
      var draft = { role: 'assistant', content: '', streaming: true };
      role.thread.push(draft);
      state.liveNr = state.api.nr;
      render();
      var linkedSpace = state.spaces.filter(function (s) { return s.id === role.spaceId; })[0];
      var history = [{ role: 'system', content: 'Du bist die interne Astra-LLM. Hilf, diese Rolle zum Leben zu erwecken. Sprich auf Deutsch. Name: ' + (role.name || '') + '. Mandat: ' + (role.mandate || '') + '. Stimme: ' + (role.voice || '') + '. Grenzen: ' + (role.bounds || '') + '. Skills: ' + (role.skills || []).join(', ') + '. Tasks: ' + (role.tasks || []).join(', ') + '. Automationen: ' + (role.automations || []).join(', ') + '. Workspace: ' + (linkedSpace ? linkedSpace.name + ' → ' + linkedSpace.path + ' (fest)' : 'nicht verbunden') + '. Rollenpfad: ' + (role.rolePath || 'optional, offen') + (role.rolePathLocked ? ' (fest)' : '') + '.' }].concat(role.thread.filter(function (m) { return m !== draft; }).map(function (m) {
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
      }));
      window.api.chat.send(state.api.nr, history, state.model, { temperature: state.prefs.temperature, top_p: state.prefs.topP, max_tokens: state.prefs.maxTokens }).then(function (res) {
        if (!res || res.error) {
          state.working = false;
          draft.streaming = false;
          draft.content = (res && res.error) || 'Die Astra-API hat nicht geantwortet.';
          saveRole(role);
          render();
        }
      });
      return;
    }
    render();
    setTimeout(function () {
      role.thread.push({ role: 'assistant', content: 'Kern der Rolle „' + (role.name || 'neu') + '“: Mandat, Stimme und Grenzen stehen links. Sag mir, was diese Rolle niemals tun darf.' });
      state.working = false;
      saveRole(role);
      render();
    }, 400);
  }
  function refreshUsage() {
    if (!window.api || !window.api.usage) return;
    window.api.usage.get().then(function (u) {
      if (!u || !u.ok) return;
      state.usage = { used: Number(u.used) || 0, limit: Number(u.limit) || TOKEN_LIMIT, source: u.source || '' };
      if (u.via) state.routeVia = u.via;
      if (state.failover) state.failover.activeNr = u.activeNr || null;
      var node = document.querySelector('.tokenmeter');
      if (node) node.outerHTML = tokenMeter();
      if (state.view === 'failover') render();
    }).catch(function () {});
  }
  function ensureFailoverInstance(nr) {
    var list = state.failover.instances || [];
    var hit = list.filter(function (i) { return Number(i.nr) === Number(nr); })[0];
    if (hit) return hit;
    var base = (state.instances || []).filter(function (i) { return Number(i.nr) === Number(nr); })[0] || { nr: Number(nr) };
    hit = { nr: Number(nr), enabled: false, priority: base.priority || 50, maxTokens: base.maxTokens || 1200, temperature: base.temperature != null ? base.temperature : 0.4 };
    list.push(hit);
    state.failover.instances = list;
    return hit;
  }
  function persistFailover() {
    if (!window.api || !window.api.failover) {
      try { localStorage.setItem('astra-failover', JSON.stringify(state.failover)); } catch (e) {}
      toast('Failover gespeichert');
      return;
    }
    window.api.failover.save(state.failover).then(function (conf) {
      state.failover = conf || state.failover;
      toast('Failover gespeichert');
      render();
    }).catch(function () { toast('Failover speichern fehlgeschlagen'); });
  }
  function loadFailover() {
    var apply = function (conf, list) {
      if (conf) state.failover = Object.assign(state.failover, conf);
      if (Array.isArray(list)) state.instances = list;
      if (!window.__UITEST && state.view === 'failover') render();
    };
    if (window.api && window.api.failover) {
      Promise.all([window.api.failover.get(), window.api.failover.list()]).then(function (pair) {
        apply(pair[0], pair[1]);
      }).catch(function () {});
      return;
    }
    try {
      apply(JSON.parse(localStorage.getItem('astra-failover') || 'null'), []);
    } catch (e) {}
  }
  function messageById(id) {
    return state.messages.filter(function (m) { return m.id === id; })[0];
  }
  function writeClipboard(value) {
    function fallback() {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
      toast(ok ? 'Kopiert' : 'Kopieren fehlgeschlagen');
    }
    if (window.api && window.api.clipboard && window.api.clipboard.write) {
      window.api.clipboard.write(value).then(function () { toast('Kopiert'); }, fallback);
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { toast('Kopiert'); }, fallback);
      return;
    }
    fallback();
  }

  document.body.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    var inBell = e.target.closest && e.target.closest('#bellpop');
    var inMenu = e.target.closest && e.target.closest('#modelmenu');
    var closedBell = false;
    var closedMenu = false;
    if (state.bell && !(t && t.dataset.act === 'bell') && !inBell) {
      state.bell = false;
      closedBell = true;
    }
    if (state.modelMenu && !(t && (t.dataset.act === 'modelmenu' || t.dataset.act === 'modelpick')) && !inMenu) {
      state.modelMenu = false;
      closedMenu = true;
    }
    if (!t) {
      if (closedBell || closedMenu) render();
      return;
    }
    if (closedBell || closedMenu) render();
    var act = t.dataset.act;
    if (act === 'modelmenu') { state.modelMenu = !state.modelMenu; return render(); }
    if (act === 'modelpick') {
      state.model = t.dataset.model;
      state.modelMenu = false;
      toast('Modell auf ' + state.model + ' gesetzt');
      return render();
    }
    if (act === 'nav') { state.modelMenu = false; return go(t.dataset.view); }
    if (act === 'session') {
      state.session = t.dataset.id;
      toast(session().code + ' · ' + session().title);
      return render();
    }
    if (act === 'plugin') {
      var plugin = state.plugins.filter(function (p) { return p.id === t.dataset.id; })[0];
      if (plugin) plugin.on = !plugin.on;
      return render();
    }
    if (act === 'file' || act === 'openfile') {
      state.file = t.dataset.path;
      state.preview = true;
      state.view = 'chat';
      state.chatPane = 'chat';
      state.stick = true;
      return render();
    }
    if (act === 'plan' || act === 'step') {
      var list = act === 'plan' ? state.plan : state.workSteps;
      var item = list[Number(t.dataset.i)];
      if (item) item.done = !item.done;
      if (act === 'step') recalc();
      return render();
    }
    if (act === 'collapse') { state.collapsed = !state.collapsed; return render(); }
    if (act === 'node') { state.node = t.dataset.id; return render(); }
    if (act === 'cat') { state.marketCat = t.dataset.cat; return render(); }
    if (act === 'mside') { state.marketSide = t.dataset.side; return render(); }
    if (act === 'install') {
      var item = state.catalog.filter(function (p) { return p.id === t.dataset.id; })[0];
      if (item) {
        item.installed = true;
        if (!state.plugins.some(function (p) { return p.id === item.id; })) {
          state.plugins.push({ id: item.id, name: item.name, version: 'v1.0.0', on: true, icon: item.icon, color: item.color });
        }
        toast(item.name + ' installiert');
      }
      return render();
    }
    if (act === 'uninstall') {
      var gone = state.catalog.filter(function (p) { return p.id === t.dataset.id; })[0];
      if (gone) gone.installed = false;
      state.plugins = state.plugins.filter(function (p) { return p.id !== t.dataset.id; });
      toast((gone ? gone.name : 'Plugin') + ' entfernt');
      return render();
    }
    if (act === 'layout') { state.chatLayout = t.dataset.layout; return render(); }
    if (act === 'cpane') { state.chatPane = t.dataset.pane; return render(); }
    if (act === 'bell') { state.bell = !state.bell; return render(); }
    if (act === 'toast') return toast(t.dataset.msg || 'Erledigt');
    if (act === 'reason') { state.reason[t.dataset.id] = !state.reason[t.dataset.id]; return render(); }
    if (act === 'like') { state.liked[t.dataset.id] = t.dataset.vote; return render(); }
    if (act === 'copy' || act === 'copytext') {
      var msg = messageById(t.dataset.id);
      var value = msg ? (act === 'copy' && msg.code ? msg.code.body : msg.text) : '';
      writeClipboard(value);
      return;
    }
    if (act === 'clearchat') { state.messages = []; state.working = false; toast('Unterhaltung gelöscht'); return render(); }
    if (act === 'role-new') {
      var born = { id: nid(), name: 'Neue Rolle', mandate: '', voice: '', bounds: '', skills: [], tasks: [], automations: [], workPath: '', workLocked: false, rolePath: '', rolePathLocked: false, alive: false, thread: [] };
      state.roles.unshift(born);
      state.roleId = born.id;
      state.view = 'roles';
      saveRole(born);
      return render();
    }
    if (act === 'role') { state.roleId = t.dataset.id; state.view = 'roles'; return render(); }
    if (act === 'kit-del') {
      var host = currentRole();
      if (!host || !host[t.dataset.kit]) return;
      host[t.dataset.kit].splice(Number(t.dataset.i), 1);
      saveRole(host);
      return render();
    }
    if (act === 'awaken') {
      var role = currentRole();
      if (!role) return;
      role.alive = true;
      saveRole(role);
      toast(role.name + ' ist lebendig');
      return render();
    }
    if (act === 'space') {
      state.spaceId = t.dataset.id;
      toast(currentSpace().name + ' ist aktiv');
      return render();
    }
    if (act === 'fo-master') {
      state.failover.enabled = !state.failover.enabled;
      return render();
    }
    if (act === 'fo-sticky') {
      state.failover.sticky = !state.failover.sticky;
      return render();
    }
    if (act === 'fo-toggle') {
      var nr = Number(t.dataset.nr);
      var list = state.failover.instances || [];
      var hit = list.filter(function (i) { return Number(i.nr) === nr; })[0];
      if (!hit) {
        var base = (state.instances || []).filter(function (i) { return Number(i.nr) === nr; })[0] || { nr: nr };
        hit = { nr: nr, enabled: true, priority: base.priority || 50, maxTokens: base.maxTokens || 1200, temperature: base.temperature != null ? base.temperature : 0.4 };
        list.push(hit);
      } else hit.enabled = !hit.enabled;
      state.failover.instances = list;
      return render();
    }
    if (act === 'fo-save') {
      persistFailover();
      return;
    }
    if (act === 'role-space') {
      var roleLink = currentRole();
      var spaceLink = state.spaces.filter(function (s) { return s.id === t.dataset.id; })[0];
      if (!roleLink || !spaceLink) return;
      roleLink.spaceId = spaceLink.id;
      roleLink.workPath = spaceLink.path;
      roleLink.workLocked = true;
      saveRole(roleLink);
      state.spaceId = spaceLink.id;
      toast('Workspace „' + spaceLink.name + '“ fest an die Rolle');
      return render();
    }
    if (act === 'prefs-open') { state.prefsOpen = true; state.prefsCheck = null; return render(); }
    if (act === 'prefs-close') { state.prefsOpen = false; return render(); }
    if (act === 'prefs-check') {
      if (!window.api || !window.api.prefs) { toast('API nicht verfügbar'); return; }
      state.prefsChecking = true;
      state.prefsCheck = null;
      render();
      window.api.prefs.check().then(function (r) {
        state.prefsChecking = false;
        state.prefsCheck = r && r.ok ? { ok: true, models: r.models } : { ok: false, error: (r && r.error) || 'Prüfung fehlgeschlagen' };
        render();
      }).catch(function (e) {
        state.prefsChecking = false;
        state.prefsCheck = { ok: false, error: String((e && e.message) || e) };
        render();
      });
      return;
    }
    if (act === 'quick') return onQuick(t.dataset.q);
  });

  function onQuick(q) {
    if (q === 'pause') { state.paused = !state.paused; state.working = state.paused ? false : state.working; toast(state.paused ? 'Agent pausiert' : 'Agent fortgesetzt'); return render(); }
    if (q === 'stop') {
      state.working = false;
      state.paused = false;
      if (state.stopKey && window.api && window.api.chat) window.api.chat.stop(state.liveNr, state.stopKey);
      toast('Agent gestoppt');
      return render();
    }
    if (q === 'plan') { state.view = 'chat'; state.chatPane = 'tasks'; return render(); }
    if (q === 'tests') {
      state.termLines.push('pytest tests/services/test_payment.py -q', '20 passed in 3.1s', 'deepseek-harness@pro:~/projects/payment-service$ ');
      state.events.push('Tests bestanden');
      toast('Testlauf beendet: 20 bestanden');
      var step = state.workSteps.filter(function (s) { return s.text.indexOf('Tests') === 0; })[0];
      if (step) step.done = true;
      recalc();
      return render();
    }
    if (q === 'explain') return sendText('Erkläre die Änderungen an der Zahlungs-Resilienz in einfacher Sprache.');
    if (q === 'refactor') return sendText('Refaktoriere den Zahlungs-Lookup, damit er schnell scheitert und weniger verschachtelt ist.');
  }

  document.body.addEventListener('submit', function (e) {
    if (e.target.id === 'composerForm') {
      e.preventDefault();
      var input = document.getElementById('composer');
      sendText(input ? input.value : '');
      return;
    }
    if (e.target.classList && e.target.classList.contains('dock-form')) {
      e.preventDefault();
      var roleBind = currentRole();
      if (!roleBind) return;
      var kind = e.target.dataset.bind;
      if (kind === 'rolepath') {
        if (roleBind.rolePathLocked) { toast('Rollenpfad ist fest'); return; }
        var rolePath = (document.getElementById('rolePathInput').value || '').trim();
        if (!rolePath) { toast('Optionalen Pfad eingeben oder leer lassen'); return; }
        roleBind.rolePath = rolePath;
        roleBind.rolePathLocked = true;
        saveRole(roleBind);
        toast('Rollenpfad gesetzt');
        return render();
      }
      return;
    }
    if (e.target.classList && e.target.classList.contains('kit-add')) {
      e.preventDefault();
      var owner = currentRole();
      var field = e.target.dataset.kit;
      var typed = (e.target.querySelector('input').value || '').trim();
      if (!owner || !field || !typed) return;
      owner[field] = owner[field] || [];
      owner[field].push(typed);
      saveRole(owner);
      render();
      return;
    }
    if (e.target.id === 'roleForm') {
      e.preventDefault();
      var box = document.getElementById('roleComposer');
      sendRole(box ? box.value : '');
      return;
    }
    if (e.target.id === 'spaceForm') {
      e.preventDefault();
      var name = (document.getElementById('spaceName').value || '').trim();
      var path = (document.getElementById('spacePath').value || '').trim();
      if (!name) { toast('Workspace braucht einen Namen'); return; }
      if (!path) { toast('Arbeitsordner-Pfad fehlt'); return; }
      var space = {
        id: nid(),
        name: name,
        goal: document.getElementById('spaceGoal').value.trim(),
        path: path,
        locked: true,
        created: new Date().toISOString()
      };
      state.spaces.unshift(space);
      state.spaceId = space.id;
      saveSpace(space);
      toast(name + ' fest angelegt');
      render();
    }
  });
  document.body.addEventListener('change', function (e) {
    if (e.target.dataset && e.target.dataset.foGlobal === 'preferFamily') {
      state.failover.preferFamily = e.target.value;
    }
  });
  document.body.addEventListener('input', function (e) {
    if (e.target.dataset && e.target.dataset.field) {
      var role = currentRole();
      if (role) role[e.target.dataset.field] = e.target.value;
      return;
    }
    if (e.target.dataset && e.target.dataset.pref) {
      var pk = e.target.dataset.pref;
      state.prefs[pk] = (pk === 'model' || pk === 'systemPrompt') ? e.target.value : Number(e.target.value);
      if (pk === 'temperature') {
        var lbl = document.getElementById('prefTempVal');
        if (lbl) lbl.textContent = state.prefs.temperature.toFixed(1);
      } else if (pk === 'topP') {
        var lbl2 = document.getElementById('prefTopPVal');
        if (lbl2) lbl2.textContent = state.prefs.topP.toFixed(2);
      }
      return;
    }
    if (e.target.dataset && e.target.dataset.foGlobal) {
      var gkey = e.target.dataset.foGlobal;
      var gval = e.target.value;
      if (gkey === 'preferFamily') state.failover.preferFamily = gval;
      else state.failover[gkey] = Number(gval);
      return;
    }
    if (e.target.dataset && e.target.dataset.fo) {
      var fnr = Number(e.target.dataset.nr);
      var fkey = e.target.dataset.fo;
      var flist = state.failover.instances || [];
      var fhit = flist.filter(function (i) { return Number(i.nr) === fnr; })[0];
      if (!fhit) {
        fhit = { nr: fnr, enabled: false, priority: 50, maxTokens: 1200, temperature: 0.4 };
        flist.push(fhit);
      }
      fhit[fkey] = fkey === 'temperature' ? Number(e.target.value) : Number(e.target.value);
      state.failover.instances = flist;
      return;
    }
    if (e.target.id !== 'marketSearch') return;
    state.marketQuery = e.target.value;
    var grid = document.getElementById('marketGrid');
    if (!grid) return render();
    var cards = filteredCatalog();
    grid.innerHTML = cards.length ? cards.map(cardHtml).join('') : '<div class="empty">Keine Plugins passen zur Suche.</div>';
  });


  function attachLive() {
    if (!window.api || !window.api.chat || state.liveAttached) return;
    state.liveAttached = true;
    window.api.chat.onToken(function (nr, delta) {
      if (String(nr) !== String(state.liveNr)) return;
      if (state.liveKind === 'role') {
        var role = currentRole();
        var last = role && role.thread && role.thread[role.thread.length - 1];
        if (!last || !last.streaming) return;
        last.content += delta || '';
        var box = document.getElementById('roleMsgs');
        if (box) {
          var nodes = box.querySelectorAll('.msg');
          var hold = nodes[nodes.length - 1];
          if (hold) hold.lastChild.textContent = last.content;
        }
        return;
      }
      var msg = state.messages[state.messages.length - 1];
      if (!msg || !msg.streaming) return;
      msg.text += delta || '';
      var body = document.getElementById('streamBody');
      if (body) body.textContent = msg.text;
    });
    window.api.chat.onDone(function (nr) {
      if (String(nr) !== String(state.liveNr)) return;
      state.working = false;
      state.turns += 1;
      if (state.liveKind === 'role') {
        var role = currentRole();
        var last = role && role.thread && role.thread[role.thread.length - 1];
        if (last) last.streaming = false;
        if (role) saveRole(role);
      } else {
        var msg = state.messages[state.messages.length - 1];
        if (msg) msg.streaming = false;
      }
      render();
      refreshUsage();
    });
    window.api.chat.onError(function (nr, err) {
      if (String(nr) !== String(state.liveNr)) return;
      state.working = false;
      if (state.liveKind === 'role') {
        var role = currentRole();
        var last = role && role.thread && role.thread[role.thread.length - 1];
        if (last && last.streaming) {
          last.streaming = false;
          last.content = humanizeChatError(err);
          last.error = true;
          saveRole(role);
        }
      }
      var msg = state.messages[state.messages.length - 1];
      if (msg && msg.streaming) {
        msg.streaming = false;
        msg.text = humanizeChatError(err);
        msg.error = true;
      }
      toast('Anfrage fehlgeschlagen: siehe Hinweis im Thread', true);
      render();
    });
  }
  function astraChip() {
    var line = state.api && state.api.ok ? state.api.masked : 'Intern';
    return '<div class="userchip"><img class="avatar" src="assets/mark.jpg" alt=""><span><b>Astra</b><small class="muted">' + esc(line) + '</small></span></div>';
  }
  function prefsModal() {
    var check = state.prefsCheck;
    var checkHtml;
    if (state.prefsChecking) {
      checkHtml = '<div class="muted">Prüfe Verbindung (nur das eigene Modell) …</div>';
    } else if (check) {
      if (check.ok && Array.isArray(check.pings)) {
        var rows = check.pings.map(function (p) {
          return '<div class="pingrow"><span class="' + (p.ok ? 'pongok' : 'pongfail') + '">' + (p.ok ? '✓' : '✗') + '</span><span class="pingname">' + esc(p.model) + '</span><span class="pingms">' + (p.ok ? p.ms + ' ms' : '') + '</span><span class="pingerr">' + (p.ok ? '' : esc(p.error || '')) + '</span></div>';
        }).join('');
        checkHtml = '<div class="checkok">✓ Gateway erreichbar · ' + check.okCount + ' von ' + check.total + ' Modellen antworten</div><div class="pinglist">' + rows + '</div>';
      } else if (check.ok) {
        checkHtml = '<div class="checkok">✓ Verbindung ok · verfügbare Modelle: ' + esc((check.models || []).join(', ') || '—') + '</div>';
      } else {
        checkHtml = '<div class="checkfail">✗ ' + esc(check.error || 'Fehler') + '</div>';
      }
    } else {
      checkHtml = '<div class="muted">Noch nicht geprüft.</div>';
    }
    var api = state.api || {};
    var infoHtml = '<div class="prefs-info">' +
      '<div class="between"><span>Modell</span><b>' + esc(state.model) + '</b></div>' +
      '<div class="between"><span>API-Key</span><b>' + esc(api.masked || 'kein Key') + '</b></div>' +
      '<div class="between"><span>Status</span><b>' + (api.ok ? 'verbunden' : esc(api.error || 'nicht verbunden')) + '</b></div>' +
      '</div>';
    return '<div class="prefs-overlay"><div class="prefs-modal"><h2>Feineinstellungen</h2>' + infoHtml +
      '<label>Modell<select data-pref="model"><option value="' + esc(state.model) + '">' + esc(state.model) + '</option></select></label>' +
      '<label>Temperatur <span class="faint" id="prefTempVal">' + state.prefs.temperature.toFixed(1) + '</span><input type="range" min="0" max="1.5" step="0.1" data-pref="temperature" value="' + state.prefs.temperature + '"></label>' +
      '<label>Top-P <span class="faint" id="prefTopPVal">' + state.prefs.topP.toFixed(2) + '</span><input type="range" min="0" max="1" step="0.05" data-pref="topP" value="' + state.prefs.topP + '"></label>' +
      '<label>Max Tokens<input type="number" min="64" max="8000" data-pref="maxTokens" value="' + state.prefs.maxTokens + '"></label>' +
      '<label>System-Prompt<textarea data-pref="systemPrompt" rows="3" placeholder="Optionaler System-Prompt für den Chat">' + esc(state.prefs.systemPrompt || '') + '</textarea></label>' +
      '<div class="between" style="margin-top:12px"><b>Prüf-Logik</b><button type="button" class="btn" data-act="prefs-check">Verbindung prüfen</button></div>' +
      checkHtml +
      '<button type="button" class="btn primary" data-act="prefs-close" style="width:100%;margin-top:12px">Schließen</button></div></div>';
  }
  function loadDesk() {
    var apply = function (roles, spaces) {
      if (Array.isArray(roles)) state.roles = roles;
      if (Array.isArray(spaces)) state.spaces = spaces;
      if (!state.roleId && state.roles[0]) state.roleId = state.roles[0].id;
      if (!state.spaceId && state.spaces[0]) state.spaceId = state.spaces[0].id;
      if (!window.__UITEST) render();
    };
    if (window.api && window.api.roles && window.api.spaces) {
      Promise.all([window.api.roles.list(), window.api.spaces.list()]).then(function (pair) {
        apply(pair[0], pair[1]);
      }).catch(function () {});
      return;
    }
    try {
      apply(JSON.parse(localStorage.getItem('astra-roles') || '[]'), JSON.parse(localStorage.getItem('astra-spaces') || '[]'));
    } catch (e) {}
  }
  function bindAstra() {
    var api = bridge();
    if (!api) return;
    api.info().then(function (info) {
      state.api = info || { ok: false, error: 'keine antwort' };
      if (window.__UITEST) return;
      if (!state.api.ok) return render();
      window.api.chat.models(state.api.nr).then(function (models) {
        if (window.__UITEST) return;
        if (Array.isArray(models) && models.length) {
          state.models = orderModels(models);
          if (state.models.indexOf(state.model) < 0) state.model = state.models[0];
        }
        render();
      }).catch(function () { render(); });
    }).catch(function () {});
  }

  render();
  attachLive();
  bindAstra();
  loadDesk();
  loadFailover();
  refreshUsage();
  setInterval(refreshUsage, 20000);
  setInterval(function () {
    var a = document.getElementById('durClock');
    var b = document.getElementById('durClock2');
    var text = dur();
    if (a) a.textContent = text;
    if (b) b.textContent = text;
  }, 1000);
})();
