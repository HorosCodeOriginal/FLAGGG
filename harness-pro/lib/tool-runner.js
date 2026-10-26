'use strict';
// tool-runner.js — die "Haende" der Agenten. Alle Pfade bleiben im Workspace,
// Shell-Befehle laufen dort mit Timeout und begrenztem Buffer.
// Netzwerk-Tools (web_search/web_fetch/download_file) nutzen options.fetch
// (Tests) oder globalThis.fetch; Antworten sind immer groessenbegrenzt.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  parseBundle,
  sha256,
  writeSkillFiles,
  loadSkillFromDisk,
  skillDir,
} = require('./skill-sandbox');

const BUILTIN_TOOLS = new Set([
  'read_file',
  'write_file',
  'execute_shell',
  'web_search',
  'web_fetch',
  'download_file',
  'install_skill',
  'list_skills',
  'uninstall_skill',
]);

const MAX_OUTPUT = 1024 * 1024; // 1 MB
const SHELL_TIMEOUT_MS = 60000;
const MAX_READ = 512 * 1024;

const MAX_FETCH_BYTES = 1024 * 1024; // 1 MB fuer web_search/web_fetch
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB fuer download_file
const WEB_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 60000;
const SHELL_MIN_TIMEOUT_MS = 1000;
const SHELL_MAX_TIMEOUT_MS = 300000;
const DDG_SEARCH_URL = 'https://html.duckduckgo.com/html/?q=';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------- kleine Helfer ----------

function formatLimit(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 && value % (1024 * 1024) === 0) return value / (1024 * 1024) + ' MB';
  if (value >= 1024 && value % 1024 === 0) return value / 1024 + ' KB';
  return value + ' Bytes';
}

function codePointToString(codePoint) {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '';
  try {
    return String.fromCodePoint(codePoint);
  } catch (_) {
    return '';
  }
}

// loest benannte und numerische HTML-Entities auf
function decodeEntities(input) {
  return String(input === undefined || input === null ? '' : input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePointToString(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => codePointToString(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

// entfernt Tags, decodiert Entities, normalisiert Whitespace (fuer Titel/Snippets)
function stripHtml(input) {
  const withoutTags = String(input === undefined || input === null ? '' : input).replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

// HTML-Seite -> reiner Text: Skripte/Styles/Noscripts/Kommentare samt Inhalt raus
function htmlToText(input) {
  let text = String(input === undefined || input === null ? '' : input);
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function attrValue(attrsRaw, name) {
  const attrs = String(attrsRaw || '');
  const re = new RegExp(
    '(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))',
    'i',
  );
  const match = attrs.match(re);
  if (!match) return '';
  if (match[1] !== undefined) return match[1];
  if (match[2] !== undefined) return match[2];
  return match[3] !== undefined ? match[3] : '';
}

function hasClass(classAttr, name) {
  const value = String(classAttr || '').trim();
  if (!value) return false;
  return value.split(/\s+/).indexOf(name) >= 0;
}

// DuckDuckGo-Redirect (//duckduckgo.com/l/?uddg=<encoded>) aufloesen
function resolveDdgHref(href) {
  const raw = decodeEntities(href).trim();
  if (!raw) return '';
  let target = raw;
  try {
    const parsed = new URL(raw, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    target = uddg ? uddg : parsed.toString();
  } catch (_) {
    target = raw;
  }
  return /^https?:\/\//i.test(target) ? target : '';
}

// <a class="result__snippet">...</a> im Abstand zwischen zwei Treffern finden
function findSnippet(source, start, end) {
  const gap = source.slice(start, end);
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchorRe.exec(gap))) {
    if (hasClass(attrValue(match[1], 'class'), 'result__snippet')) return stripHtml(match[2]);
  }
  const fallback = gap.match(/result__snippet[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
  return fallback ? stripHtml(fallback[1]) : '';
}

// DDG-HTML -> [{ title, url, snippet }] in Dokumentreihenfolge
function extractDdgResults(html) {
  const source = String(html === undefined || html === null ? '' : html);
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  const anchors = [];
  let match;
  while ((match = anchorRe.exec(source))) {
    anchors.push({ index: match.index, end: anchorRe.lastIndex, attrs: match[1], inner: match[2] });
  }
  const titleAnchors = anchors.filter(
    (anchor) => hasClass(attrValue(anchor.attrs, 'class'), 'result__a') && attrValue(anchor.attrs, 'href'),
  );
  const results = [];
  for (let i = 0; i < titleAnchors.length; i++) {
    const anchor = titleAnchors[i];
    const url = resolveDdgHref(attrValue(anchor.attrs, 'href'));
    if (!url) continue;
    const gapEnd = i + 1 < titleAnchors.length ? titleAnchors[i + 1].index : source.length;
    results.push({
      title: stripHtml(anchor.inner),
      url,
      snippet: findSnippet(source, anchor.end, gapEnd),
    });
  }
  return results;
}

// nur http(s) zulassen, sonst klarer Fehler
function requireHttpUrl(raw, label) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(label + ': url fehlt');
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch (_) {
    throw new Error(label + ': ungueltige URL: ' + raw);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(label + ': nur http/https erlaubt (nicht ' + parsed.protocol.replace(':', '') + ')');
  }
  assertPublicHttpUrl(parsed, label);
  return parsed.toString();
}

// SSRF: localhost, private und link-local Ziele ablehnen (Hostname + IP)
function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === 'localhost.localdomain') return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  // IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // IPv6 unique-local / link-local
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  return false;
}

function assertPublicHttpUrl(parsed, label) {
  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error(label + ': Zieladresse nicht erlaubt (privat/localhost): ' + parsed.hostname);
  }
}

// ---------- ToolRunner ----------

class ToolRunner {
  constructor(workspace, options) {
    if (!workspace) throw new Error('ToolRunner: workspace fehlt');
    this.workspace = path.resolve(String(workspace));
    const opts = options && typeof options === 'object' ? options : {};
    // injizierbar fuer Tests; Default ist das globale fetch
    this.fetch =
      typeof opts.fetch === 'function'
        ? opts.fetch
        : typeof globalThis.fetch === 'function'
          ? globalThis.fetch
          : null;
    this.userAgent =
      typeof opts.userAgent === 'string' && opts.userAgent.trim() ? opts.userAgent : DEFAULT_USER_AGENT;
    this.maxDownloadBytes =
      Number.isFinite(opts.maxDownloadBytes) && opts.maxDownloadBytes > 0
        ? Math.floor(opts.maxDownloadBytes)
        : MAX_DOWNLOAD_BYTES;
    // skillId -> { manifest, tools: { name: fn } }
    this.skills = new Map();
    // toolName -> { skillId, fn }
    this.skillTools = new Map();
    if (opts.loadSkills !== false) {
      try {
        this._loadInstalledSkills();
      } catch (_) {
        /* Workspace ohne skills/ ist ok */
      }
    }
  }

  _loadInstalledSkills() {
    const root = path.join(this.workspace, 'skills');
    if (!fs.existsSync(root)) return;
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    dirs.forEach((d) => {
      try {
        this._registerSkill(loadSkillFromDisk(this, path.join(root, d.name)));
      } catch (err) {
        // defekter Skill blockiert den Runner nicht
      }
    });
  }

  _registerSkill(loaded) {
    const { manifest, tools } = loaded;
    // bestehende Tools dieses Skills entfernen
    if (this.skills.has(manifest.id)) {
      this._unregisterSkill(manifest.id);
    }
    Object.keys(tools).forEach((name) => {
      if (BUILTIN_TOOLS.has(name)) {
        throw new Error('skill: Tool-Name kollidiert mit Built-in: ' + name);
      }
      if (this.skillTools.has(name)) {
        throw new Error('skill: Tool-Name bereits registriert: ' + name);
      }
    });
    Object.keys(tools).forEach((name) => {
      this.skillTools.set(name, { skillId: manifest.id, fn: tools[name] });
    });
    this.skills.set(manifest.id, { manifest, tools });
  }

  _unregisterSkill(skillId) {
    const prev = this.skills.get(skillId);
    if (!prev) return;
    Object.keys(prev.tools).forEach((name) => {
      const entry = this.skillTools.get(name);
      if (entry && entry.skillId === skillId) this.skillTools.delete(name);
    });
    this.skills.delete(skillId);
  }

  list_skills() {
    const out = [];
    this.skills.forEach((entry) => {
      out.push({
        id: entry.manifest.id,
        name: entry.manifest.name,
        version: entry.manifest.version,
        tools: entry.manifest.tools.slice(),
        permissions: entry.manifest.permissions.slice(),
      });
    });
    return out;
  }

  uninstall_skill(args) {
    const id = args && args.id ? String(args.id).trim() : '';
    if (!id) throw new Error('uninstall_skill: id fehlt');
    this._unregisterSkill(id);
    const dir = skillDir(this.workspace, id);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { ok: true, id };
  }

  async install_skill(args) {
    const a = args || {};
    const url = requireHttpUrl(a.url, 'install_skill');
    const expectSha = a.sha256 ? String(a.sha256).trim().toLowerCase() : '';
    const { res, done } = await this._request(url, DOWNLOAD_TIMEOUT_MS);
    let text;
    try {
      const status = res && res.status !== undefined ? Number(res.status) : 200;
      if (status < 200 || status >= 300) throw new Error('install_skill: HTTP ' + status);
      text = await this._readBodyText(res, MAX_FETCH_BYTES, 'install_skill');
    } finally {
      done();
    }
    const digest = sha256(Buffer.from(text, 'utf8'));
    if (expectSha && digest !== expectSha) {
      throw new Error('install_skill: sha256 mismatch (erwartet ' + expectSha + ', got ' + digest + ')');
    }
    const { manifest, files } = parseBundle(text);
    if (a.id && String(a.id).trim() && String(a.id).trim() !== manifest.id) {
      throw new Error('install_skill: id-Argument weicht vom Manifest ab');
    }
    const dir = skillDir(this.workspace, manifest.id);
    writeSkillFiles(dir, manifest, files);
    const loaded = loadSkillFromDisk(this, dir);
    this._registerSkill(loaded);
    return {
      ok: true,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      tools: manifest.tools.slice(),
      sha256: digest,
      path: path.relative(this.workspace, dir),
    };
  }

  // blockiert Pfade ausserhalb des Workspace (auch ../, absolut, Symlink/Junction)
  _resolveInside(target) {
    const rel = String(target === undefined || target === null ? '' : target);
    if (rel.indexOf('\0') >= 0) throw new Error('ungueltiger Pfad');
    let rootReal;
    try {
      rootReal = fs.realpathSync(this.workspace);
    } catch (_) {
      rootReal = path.resolve(this.workspace);
    }
    const abs = path.resolve(rootReal, rel);
    const suffixes = [];
    let candidate = abs;
    while (!fs.existsSync(candidate)) {
      suffixes.unshift(path.basename(candidate));
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
    let resolvedBase;
    try {
      resolvedBase = fs.realpathSync(candidate);
    } catch (_) {
      resolvedBase = candidate;
    }
    const resolved = suffixes.length ? path.join(resolvedBase, ...suffixes) : resolvedBase;
    const relToRoot = path.relative(rootReal, resolved);
    if (relToRoot === '..' || relToRoot.startsWith('..' + path.sep) || path.isAbsolute(relToRoot)) {
      throw new Error('Pfad ausserhalb des Workspace: ' + rel);
    }
    return resolved;
  }

  read_file(args) {
    const abs = this._resolveInside(args && args.path);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error('kein Datei-Pfad: ' + abs);
    const content = fs.readFileSync(abs, 'utf8');
    return content.length > MAX_READ ? content.slice(0, MAX_READ) + '\n[gekuerzt]' : content;
  }

  write_file(args) {
    const abs = this._resolveInside(args && args.path);
    const content = args && args.content !== undefined ? String(args.content) : '';
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return { path: path.relative(this.workspace, abs), bytes: Buffer.byteLength(content, 'utf8') };
  }

  execute_shell(args) {
    const command = args && args.command;
    if (typeof command !== 'string' || !command.trim()) throw new Error('command fehlt');
    // Bewusst KEINE Whitelist: Paketmanager wie `pip install`, `npm install` oder
    // `git clone` bleiben erlaubt — Agenten/Skills duerfen sich selbst heilen und
    // Werkzeuge nachladen. Schutz kommt von Timeout, Buffer-Limit und Workspace-cwd.
    let timeoutMs = SHELL_TIMEOUT_MS;
    const rawTimeout = args && (args.timeout_ms !== undefined ? args.timeout_ms : args.timeoutMs);
    if (rawTimeout !== undefined && rawTimeout !== null) {
      const parsed = Number(rawTimeout);
      if (Number.isFinite(parsed)) {
        timeoutMs = Math.min(SHELL_MAX_TIMEOUT_MS, Math.max(SHELL_MIN_TIMEOUT_MS, Math.floor(parsed)));
      }
    }
    const maxBuffer = MAX_OUTPUT;
    return new Promise((resolve, reject) => {
      execFile(
        process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command],
        { cwd: this.workspace, timeout: timeoutMs, maxBuffer, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            const e = new Error('shell fehlgeschlagen: ' + (err.message || 'unbekannt'));
            e.stdout = String(stdout || '');
            e.stderr = String(stderr || '');
            e.code = err.code;
            e.exitCode = typeof err.code === 'number' ? err.code : null;
            return reject(e);
          }
          resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), exitCode: 0 });
        },
      );
    });
  }

  // HTTP-GET mit AbortController-Timeout; done() muss nach dem Body-Lesen laufen
  async _request(url, timeoutMs) {
    const fetchFn = this.fetch;
    if (typeof fetchFn !== 'function') {
      throw new Error('fetch nicht verfuegbar (kein globalThis.fetch und kein options.fetch)');
    }
    // Redirect manuell: jedes Hop gegen SSRF pruefen
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {
        /* ignore */
      }
    }, timeoutMs);
    const done = () => clearTimeout(timer);
    try {
      let current = requireHttpUrl(url, 'request');
      for (let hop = 0; hop < 5; hop += 1) {
        const res = await fetchFn(current, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'user-agent': this.userAgent,
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
            'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
          },
          signal: controller.signal,
        });
        const status = res && res.status !== undefined ? Number(res.status) : 200;
        if (status >= 300 && status < 400) {
          const loc = this._header(res, 'location');
          if (!loc) throw new Error('request: Redirect ohne Location');
          let next;
          try {
            next = new URL(loc, current).toString();
          } catch (_) {
            throw new Error('request: ungueltige Redirect-URL');
          }
          current = requireHttpUrl(next, 'request');
          continue;
        }
        return { res, done, finalUrl: current };
      }
      throw new Error('request: zu viele Redirects');
    } catch (err) {
      done();
      if (controller.signal.aborted || (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'))) {
        const timeoutErr = new Error(
          'Zeitueberschreitung nach ' + Math.round(timeoutMs / 1000) + 's: ' + url,
        );
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      throw err;
    }
  }

  _header(res, name) {
    const headers = res && res.headers;
    if (!headers) return '';
    if (typeof headers.get === 'function') {
      const value = headers.get(name);
      return value === null || value === undefined ? '' : String(value);
    }
    const wanted = String(name).toLowerCase();
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
    return key === undefined ? '' : String(headers[key]);
  }

  async _readBodyText(res, maxBytes, label) {
    const limitError = () =>
      new Error(label + ': Antwort zu gross (Limit ' + formatLimit(maxBytes) + ' ueberschritten)');
    const declared = Number(this._header(res, 'content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw limitError();
    let text;
    if (res && typeof res.text === 'function') {
      text = await res.text();
    } else if (res && typeof res.arrayBuffer === 'function') {
      text = Buffer.from(await res.arrayBuffer()).toString('utf8');
    } else {
      throw new Error(label + ': Antwortkoerper nicht lesbar');
    }
    text = String(text === undefined || text === null ? '' : text);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw limitError();
    return text;
  }

  async _readBodyBytes(res, maxBytes, label) {
    const limitError = () =>
      new Error(label + ': Datei zu gross (Limit ' + formatLimit(maxBytes) + ' ueberschritten)');
    const declared = Number(this._header(res, 'content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw limitError();
    const body = res && res.body;
    if (body && typeof body.getReader === 'function') {
      // Streaming mit Cap: bei Ueberschreitung sofort abbrechen und verwerfen
      const reader = body.getReader();
      const chunks = [];
      let total = 0;
      try {
        for (;;) {
          const step = await reader.read();
          if (step.done) break;
          const chunk = Buffer.from(step.value);
          total += chunk.length;
          if (total > maxBytes) {
            try {
              await reader.cancel();
            } catch (_) {
              /* ignore */
            }
            throw limitError();
          }
          chunks.push(chunk);
        }
      } finally {
        try {
          if (typeof reader.releaseLock === 'function') reader.releaseLock();
        } catch (_) {
          /* ignore */
        }
      }
      return Buffer.concat(chunks, total);
    }
    let buffer;
    if (res && typeof res.arrayBuffer === 'function') {
      buffer = Buffer.from(await res.arrayBuffer());
    } else if (res && typeof res.text === 'function') {
      buffer = Buffer.from(await res.text(), 'utf8');
    } else {
      throw new Error(label + ': Antwortkoerper nicht lesbar');
    }
    if (buffer.length > maxBytes) throw limitError();
    return buffer;
  }

  async web_search(args) {
    const query = args && args.query;
    if (typeof query !== 'string' || !query.trim()) throw new Error('web_search: query fehlt');
    const target = DDG_SEARCH_URL + encodeURIComponent(query.trim());
    const { res, done } = await this._request(target, WEB_TIMEOUT_MS);
    let html;
    try {
      const status = res && res.status !== undefined ? Number(res.status) : 200;
      if (status !== 200) throw new Error('web_search: HTTP ' + status + ' von DuckDuckGo');
      html = await this._readBodyText(res, MAX_FETCH_BYTES, 'web_search');
    } finally {
      done();
    }
    const results = extractDdgResults(html).slice(0, 3);
    if (results.length === 0) throw new Error('web_search: keine Ergebnisse (ggf. blockiert)');
    return results;
  }

  async web_fetch(args) {
    const rawUrl = args && args.url;
    const url = requireHttpUrl(rawUrl, 'web_fetch');
    const { res, done } = await this._request(url, WEB_TIMEOUT_MS);
    let text;
    let contentType;
    try {
      const status = res && res.status !== undefined ? Number(res.status) : 200;
      if (status < 200 || status >= 300) throw new Error('web_fetch: HTTP ' + status);
      contentType = this._header(res, 'content-type');
      text = await this._readBodyText(res, MAX_FETCH_BYTES, 'web_fetch');
    } finally {
      done();
    }
    const isHtml = /html/i.test(contentType) || (!contentType && /^\s*<[a-z!]/i.test(text));
    return isHtml ? htmlToText(text) : text;
  }

  async download_file(args) {
    const rawUrl = args && args.url;
    const url = requireHttpUrl(rawUrl, 'download_file');
    const relPath = args && args.path;
    if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('download_file: path fehlt');
    // Pfad-Grenze zuerst pruefen: kein Netzwerk fuer Ziele ausserhalb des Workspace
    const abs = this._resolveInside(relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const { res, done } = await this._request(url, DOWNLOAD_TIMEOUT_MS);
    let bytes;
    let status;
    try {
      status = res && res.status !== undefined ? Number(res.status) : 200;
      // keine Fehlerseiten (404/500/...) als Datei speichern
      if (status < 200 || status >= 300) throw new Error('download_file: HTTP ' + status + ' fuer ' + url);
      bytes = await this._readBodyBytes(res, this.maxDownloadBytes, 'download_file');
    } finally {
      done();
    }
    fs.writeFileSync(abs, bytes);
    return { path: path.relative(this.workspace, abs), bytes: bytes.length, status };
  }

  // zentrale Ausfuehrung: Built-ins zuerst, dann Skill-Registry
  async execute(toolName, args) {
    switch (toolName) {
      case 'read_file':
        return this.read_file(args || {});
      case 'write_file':
        return this.write_file(args || {});
      case 'execute_shell':
        return this.execute_shell(args || {});
      case 'web_search':
        return this.web_search(args || {});
      case 'web_fetch':
        return this.web_fetch(args || {});
      case 'download_file':
        return this.download_file(args || {});
      case 'install_skill':
        return this.install_skill(args || {});
      case 'list_skills':
        return this.list_skills(args || {});
      case 'uninstall_skill':
        return this.uninstall_skill(args || {});
      default: {
        const skill = this.skillTools.get(toolName);
        if (skill && typeof skill.fn === 'function') {
          return skill.fn(args || {});
        }
        throw new Error('unbekanntes Tool: ' + toolName);
      }
    }
  }

  // Kompatibilitaets-Alias (aeltere Aufrufer nutzen run)
  async run(toolName, args) {
    return this.execute(toolName, args);
  }
}

module.exports = {
  ToolRunner,
  MAX_OUTPUT,
  SHELL_TIMEOUT_MS,
  MAX_FETCH_BYTES,
  MAX_DOWNLOAD_BYTES,
  isPrivateOrLocalHost,
  BUILTIN_TOOLS,
};
