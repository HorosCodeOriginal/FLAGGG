'use strict';
// Tests der Netzwerk-Tools des ToolRunner: web_search, web_fetch, download_file.
// Es wird NIE echtes Netz benutzt: fetch wird ueber options.fetch injiziert.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { ToolRunner, MAX_FETCH_BYTES, MAX_DOWNLOAD_BYTES } = require('../lib/tool-runner');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astra-web-ws-'));
}

// Fake-fetch: sammelt Aufrufe, liefert die vom Test gebaute Response
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  fn.calls = calls;
  return fn;
}

// minimale fetch-Response: text() und arrayBuffer() immer vorhanden
function makeResponse({ status = 200, headers = {}, text, bytes } = {}) {
  const payload =
    bytes !== undefined ? Buffer.from(bytes) : Buffer.from(text === undefined ? '' : String(text), 'utf8');
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    async text() {
      return payload.toString('utf8');
    },
    async arrayBuffer() {
      return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    },
  };
}

// DuckDuckGo-HTML-Fixture: 4 Treffer, einer davon mit uddg-Redirect
function ddgHtml() {
  return `<!DOCTYPE html>
<html><body>
<div class="results">
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://nodejs.org/de/docs/">Node.js <b>&amp; Doku</b></a>
    </h2>
    <a class="result__snippet" href="https://nodejs.org/de/docs/">Offizielle <b>Node.js</b> Doku &quot;API&quot; &#39;Guide&#39;</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb&amp;rut=abc123">MDN &lt;Web&gt; Docs</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2F">Referenz f&#252;r Web-Technologien &amp; mehr</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://example.com/seite?a=1&amp;b=2">Example&nbsp;Domain</a>
    </h2>
    <a class="result__snippet" href="https://example.com/seite?a=1&amp;b=2">Eine <i>Beispielseite</i> f&#252;r Tests</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://example.org/vierter">Vierter &amp; letzter Treffer</a>
    </h2>
    <a class="result__snippet" href="https://example.org/vierter">Darf in den Top 3 nicht auftauchen</a>
  </div>
</div>
</body></html>`;
}

test('web_search liefert Top 3 mit Titel, URL und Snippet', async () => {
  const ws = workspace();
  const fetch = fakeFetch(() => makeResponse({ text: ddgHtml() }));
  const runner = new ToolRunner(ws, { fetch });
  const results = await runner.execute('web_search', { query: 'node js & doku' });

  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 3);
  assert.deepStrictEqual(results[0], {
    title: 'Node.js & Doku',
    url: 'https://nodejs.org/de/docs/',
    snippet: 'Offizielle Node.js Doku "API" \'Guide\'',
  });
  assert.strictEqual(results[1].title, 'MDN <Web> Docs');
  assert.strictEqual(results[1].url, 'https://developer.mozilla.org/en-US/docs/Web');
  assert.strictEqual(results[1].snippet, 'Referenz für Web-Technologien & mehr');
  assert.strictEqual(results[2].title, 'Example Domain');
  assert.strictEqual(results[2].url, 'https://example.com/seite?a=1&b=2');
  assert.strictEqual(results[2].snippet, 'Eine Beispielseite für Tests');
  assert.ok(!results.some((entry) => /Vierter/.test(entry.title)), 'vierter Treffer darf nicht in Top 3 sein');

  // Request: DDG-URL, Query encoded, Browser-User-Agent, AbortSignal
  assert.strictEqual(fetch.calls.length, 1);
  assert.strictEqual(
    fetch.calls[0].url,
    'https://html.duckduckgo.com/html/?q=' + encodeURIComponent('node js & doku'),
  );
  const headers = fetch.calls[0].options.headers || {};
  assert.match(headers['user-agent'], /Mozilla\/5\.0/);
  assert.ok(fetch.calls[0].options.signal, 'AbortSignal muss gesetzt sein');
});

test('web_search nutzt konfigurierbaren User-Agent', async () => {
  const fetch = fakeFetch(() => makeResponse({ text: ddgHtml() }));
  const runner = new ToolRunner(workspace(), { fetch, userAgent: 'TestBot/7.0' });
  await runner.web_search({ query: 'x' });
  assert.strictEqual(fetch.calls[0].options.headers['user-agent'], 'TestBot/7.0');
});

test('web_search ohne Ergebnisse wirft', async () => {
  const fetch = fakeFetch(() => makeResponse({ text: '<html><body>Keine Treffer hier</body></html>' }));
  const runner = new ToolRunner(workspace(), { fetch });
  await assert.rejects(runner.web_search({ query: 'gibtsnicht' }), /keine Ergebnisse/);
});

test('web_search wirft bei HTTP-Status ungleich 200', async () => {
  const fetch = fakeFetch(() => makeResponse({ status: 503, text: 'blockiert' }));
  const runner = new ToolRunner(workspace(), { fetch });
  await assert.rejects(runner.web_search({ query: 'x' }), /503/);
});

test('web_fetch liefert bereinigten Text ohne Skripte, Styles und Kommentare', async () => {
  const html = `<!DOCTYPE html>
<html><head><title>Seite</title>
<style>.geheim { color: red; }</style>
<script>const geheim = 'SCRIPT_INHALT';</script></head>
<body><!-- KOMMENTAR_INHALT -->
<h1>Hallo &amp; Welt</h1>
<p>Ein <b>fetter</b> Text mit &lt;Tags&gt; und &quot;Zitat&quot;.</p>
<noscript>NOSCRIPT_INHALT</noscript>
</body></html>`;
  const fetch = fakeFetch(() =>
    makeResponse({ text: html, headers: { 'content-type': 'text/html; charset=utf-8' } }),
  );
  const runner = new ToolRunner(workspace(), { fetch });
  const text = await runner.execute('web_fetch', { url: 'https://example.com/seite' });

  assert.strictEqual(typeof text, 'string');
  assert.match(text, /Hallo & Welt/);
  assert.match(text, /Ein fetter Text mit <Tags> und "Zitat"\./);
  assert.ok(!/SCRIPT_INHALT/.test(text), 'Skriptinhalt muss entfernt sein');
  assert.ok(!/NOSCRIPT_INHALT/.test(text), 'Noscript-Inhalt muss entfernt sein');
  assert.ok(!/KOMMENTAR_INHALT/.test(text), 'Kommentar muss entfernt sein');
  assert.ok(!/color: red/.test(text), 'Style-Inhalt muss entfernt sein');
  assert.ok(!/<(?:script|style|noscript|h1|p|b)\b/i.test(text), 'keine HTML-Tags mehr');
  assert.ok(!/\n/.test(text), 'Whitespace ist zu einer Zeile normalisiert');
});

test('web_fetch gibt Nicht-HTML unveraendert zurueck', async () => {
  const fetch = fakeFetch(() =>
    makeResponse({ text: 'zeile1\nzeile2', headers: { 'content-type': 'text/plain; charset=utf-8' } }),
  );
  const runner = new ToolRunner(workspace(), { fetch });
  const text = await runner.web_fetch({ url: 'https://example.com/data.txt' });
  assert.strictEqual(text, 'zeile1\nzeile2');
});

test('web_fetch bricht bei mehr als 1 MB ab', async () => {
  const tooBig = 'a'.repeat(MAX_FETCH_BYTES + 16);
  const fetch = fakeFetch(() => makeResponse({ text: tooBig }));
  const runner = new ToolRunner(workspace(), { fetch });
  await assert.rejects(runner.web_fetch({ url: 'https://example.com/gross.html' }), /1 MB|zu gross|limit/i);

  // Content-Length alleine reicht schon als Abbruchgrund
  const declared = fakeFetch(() =>
    makeResponse({
      text: 'kurz',
      headers: { 'content-type': 'text/html', 'content-length': String(MAX_FETCH_BYTES + 1) },
    }),
  );
  const declaredRunner = new ToolRunner(workspace(), { fetch: declared });
  await assert.rejects(
    declaredRunner.web_fetch({ url: 'https://example.com/gross.html' }),
    /1 MB|zu gross|limit/i,
  );
});

test('download_file schreibt Binaerdaten binaeridentisch in den Workspace', async () => {
  const payload = Buffer.from([0, 255, 1, 2]);
  const fetch = fakeFetch(() =>
    makeResponse({
      bytes: payload,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(payload.length),
      },
    }),
  );
  const ws = workspace();
  const runner = new ToolRunner(ws, { fetch });
  const result = await runner.execute('download_file', {
    url: 'https://example.com/blob.bin',
    path: 'downloads/blob.bin',
  });

  assert.strictEqual(result.path, path.join('downloads', 'blob.bin'));
  assert.strictEqual(result.bytes, 4);
  assert.strictEqual(result.status, 200);
  const absPath = path.join(ws, 'downloads', 'blob.bin');
  assert.ok(fs.existsSync(absPath), 'Datei muss existieren (inkl. mkdir -p)');
  assert.strictEqual(Buffer.compare(fs.readFileSync(absPath), payload), 0);
});

test('download_file blockiert Pfad-Traversal und startet kein Netzwerk', async () => {
  const fetch = fakeFetch(() => makeResponse({ bytes: Buffer.from([1]) }));
  const ws = workspace();
  const runner = new ToolRunner(ws, { fetch });
  await assert.rejects(
    runner.download_file({ url: 'https://example.com/x.bin', path: '../evil.bin' }),
    /ausserhalb des Workspace/,
  );
  await assert.rejects(
    runner.execute('download_file', { url: 'https://example.com/x.bin', path: path.join(os.tmpdir(), 'evil.bin') }),
    /ausserhalb des Workspace/,
  );
  assert.strictEqual(fetch.calls.length, 0, 'vor der Pfadpruefung darf nicht gefetcht werden');
  assert.ok(!fs.existsSync(path.join(path.dirname(ws), 'evil.bin')));
});

test('download_file lehnt Nicht-HTTP-URLs ab', async () => {
  const fetch = fakeFetch(() => makeResponse({ bytes: Buffer.from([1]) }));
  const runner = new ToolRunner(workspace(), { fetch });
  await assert.rejects(runner.download_file({ url: 'ftp://example.com/x.bin', path: 'x.bin' }), /http/);
  assert.strictEqual(fetch.calls.length, 0);
});

test('download_file respektiert maxDownloadBytes', async () => {
  const fetch = fakeFetch(() => makeResponse({ bytes: Buffer.from([1, 2, 3, 4]) }));
  const runner = new ToolRunner(workspace(), { fetch, maxDownloadBytes: 3 });
  await assert.rejects(runner.download_file({ url: 'https://example.com/x.bin', path: 'x.bin' }), /zu gross|limit/i);
});

test('web_fetch und web_search brauchen ihre Argumente', async () => {
  const fetch = fakeFetch(() => {
    throw new Error('fetch haette nicht laufen duerfen');
  });
  const runner = new ToolRunner(workspace(), { fetch });
  await assert.rejects(runner.execute('web_search', {}), /query fehlt/);
  await assert.rejects(runner.execute('web_fetch', {}), /url fehlt/);
  await assert.rejects(runner.execute('web_fetch', { url: 'file:///etc/passwd' }), /http/);
  await assert.rejects(runner.execute('download_file', { url: 'https://example.com/x' }), /path fehlt/);
  assert.strictEqual(fetch.calls.length, 0);
});

test('ToolRunner bleibt ohne options kompatibel (Defaults + Limits)', () => {
  const runner = new ToolRunner(workspace());
  assert.strictEqual(MAX_FETCH_BYTES, 1024 * 1024);
  assert.strictEqual(MAX_DOWNLOAD_BYTES, 20 * 1024 * 1024);
  assert.strictEqual(runner.maxDownloadBytes, MAX_DOWNLOAD_BYTES);
  assert.match(runner.userAgent, /Mozilla\/5\.0/);
  assert.strictEqual(typeof runner.run, 'function');
  assert.strictEqual(typeof runner.execute, 'function');
  assert.strictEqual(typeof runner.read_file, 'function');
  assert.strictEqual(typeof runner.write_file, 'function');
  assert.strictEqual(typeof runner.execute_shell, 'function');
  assert.strictEqual(typeof runner.web_search, 'function');
  assert.strictEqual(typeof runner.web_fetch, 'function');
  assert.strictEqual(typeof runner.download_file, 'function');
});

// Paketmanager bleiben erlaubt: nur `pip --version`, KEINE echte Installation
function pyAvailable() {
  try {
    const probe = spawnSync('py', ['-m', 'pip', '--version'], {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    });
    return !probe.error && probe.status === 0;
  } catch (_) {
    return false;
  }
}

test(
  'execute_shell erlaubt Paketmanager (py -m pip --version)',
  { skip: pyAvailable() ? false : 'py/pip nicht verfuegbar' },
  async () => {
    const runner = new ToolRunner(workspace());
    const out = await runner.run('execute_shell', { command: 'py -m pip --version', timeout_ms: 120000 });
    assert.strictEqual(out.exitCode, 0);
    assert.match(out.stdout, /pip/i);
  },
);
