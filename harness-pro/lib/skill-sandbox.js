'use strict';
// skill-sandbox.js — laedt Agent-Skills aus Manifest + Entry in einer VM ohne
// process/require/child_process/fetch. Nur workspace-gebundene ctx-APIs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ALLOWED_PERMISSIONS = new Set(['workspace_read', 'workspace_write']);
const TOOL_TIMEOUT_MS = 5000;
const LOAD_TIMEOUT_MS = 2000;
const SKILL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function validateManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('skill: Manifest fehlt');
  const id = String(raw.id || '').trim();
  if (!SKILL_ID_RE.test(id)) throw new Error('skill: ungueltige id');
  const name = String(raw.name || id).trim();
  const version = String(raw.version || '0.0.0').trim();
  const entry = String(raw.entry || 'index.js').trim();
  if (!entry || entry.indexOf('..') >= 0 || path.isAbsolute(entry)) {
    throw new Error('skill: ungueltiger entry');
  }
  const tools = Array.isArray(raw.tools) ? raw.tools : [];
  if (!tools.length) throw new Error('skill: tools[] fehlt');
  const toolNames = [];
  tools.forEach((t, i) => {
    if (!t || typeof t.name !== 'string' || !t.name.trim()) {
      throw new Error('skill: tools[' + i + '].name fehlt');
    }
    const n = t.name.trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(n)) throw new Error('skill: ungueltiger tool-name: ' + n);
    toolNames.push(n);
  });
  const permissions = Array.isArray(raw.permissions) ? raw.permissions.map(String) : ['workspace_read'];
  permissions.forEach((p) => {
    if (!ALLOWED_PERMISSIONS.has(p)) {
      throw new Error('skill: Permission nicht erlaubt: ' + p + ' (v1: nur workspace_read/write)');
    }
  });
  return { id, name, version, entry, tools: toolNames, permissions, description: String(raw.description || '') };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function createSkillContext(runner, permissions) {
  const canRead = permissions.indexOf('workspace_read') >= 0;
  const canWrite = permissions.indexOf('workspace_write') >= 0;
  return {
    readFile(relPath) {
      if (!canRead) throw new Error('skill: keine workspace_read Permission');
      return runner.read_file({ path: relPath });
    },
    writeFile(relPath, content) {
      if (!canWrite) throw new Error('skill: keine workspace_write Permission');
      return runner.write_file({ path: relPath, content: content });
    },
    log() {
      /* no-op / optional later */
    },
  };
}

/**
 * Laedt Entry-Quelltext in einer VM und liefert { tools: { name: fn } }.
 */
function loadSkillModule(source, runner, manifest) {
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    console: {
      log: function () {},
      warn: function () {},
      error: function () {},
    },
    // bewusst kein require, process, Buffer, setTimeout mit Netz, fetch
  };
  vm.createContext(sandbox);
  const script = new vm.Script(String(source), { filename: 'skill:' + manifest.id + '/' + manifest.entry });
  script.runInContext(sandbox, { timeout: LOAD_TIMEOUT_MS });
  const exported = sandbox.module.exports || sandbox.exports;
  if (!exported || typeof exported !== 'object') {
    throw new Error('skill: Entry exportiert kein Objekt');
  }
  const toolsObj = exported.tools && typeof exported.tools === 'object' ? exported.tools : exported;
  const ctx = createSkillContext(runner, manifest.permissions);
  const bound = {};
  manifest.tools.forEach((name) => {
    const fn = toolsObj[name];
    if (typeof fn !== 'function') {
      throw new Error('skill: Tool "' + name + '" nicht im Entry exportiert');
    }
    bound[name] = async function skillTool(args) {
      const raw = await runWithTimeout(() => fn.call(null, args || {}, ctx), TOOL_TIMEOUT_MS, name);
      // VM-Objekte gehoeren einem anderen Realm — in den Host klonen
      return cloneOut(raw);
    };
  });
  return bound;
}

function cloneOut(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return String(value);
  }
}

function runWithTimeout(fn, ms, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('skill: Timeout bei Tool "' + label + '" nach ' + ms + 'ms'));
    }, ms);
    Promise.resolve()
      .then(() => fn())
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

function skillDir(workspace, skillId) {
  return path.join(workspace, 'skills', skillId);
}

function writeSkillFiles(dir, manifest, files) {
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'skill.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        entry: manifest.entry,
        description: manifest.description,
        tools: manifest.tools.map((n) => ({ name: n })),
        permissions: manifest.permissions,
      },
      null,
      2,
    ),
    'utf8',
  );
  Object.keys(files).forEach((rel) => {
    if (!rel || rel.indexOf('..') >= 0 || path.isAbsolute(rel)) {
      throw new Error('skill: ungueltiger Dateiname im Bundle: ' + rel);
    }
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel], 'utf8');
  });
}

function loadSkillFromDisk(runner, dir) {
  const manifestPath = path.join(dir, 'skill.json');
  if (!fs.existsSync(manifestPath)) throw new Error('skill.json fehlt in ' + dir);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  const entryPath = path.join(dir, manifest.entry);
  if (!fs.existsSync(entryPath)) throw new Error('skill entry fehlt: ' + manifest.entry);
  const source = fs.readFileSync(entryPath, 'utf8');
  const tools = loadSkillModule(source, runner, manifest);
  return { manifest, tools };
}

/**
 * Bundle-JSON:
 * {
 *   "id", "name", "version", "entry", "tools", "permissions",
 *   "files": { "index.js": "module.exports = { tools: { ... } }" }
 * }
 */
function parseBundle(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch (err) {
    throw new Error('skill: Bundle ist kein JSON (' + err.message + ')');
  }
  const files = data.files && typeof data.files === 'object' ? data.files : null;
  if (!files) throw new Error('skill: Bundle braucht files{} mit Entry-Quelltext');
  const entry = String(data.entry || 'index.js');
  if (typeof files[entry] !== 'string') {
    throw new Error('skill: files["' + entry + '"] fehlt im Bundle');
  }
  const manifest = validateManifest(data);
  return { manifest, files };
}

module.exports = {
  validateManifest,
  sha256,
  loadSkillModule,
  loadSkillFromDisk,
  writeSkillFiles,
  skillDir,
  parseBundle,
  SKILL_ID_RE,
  TOOL_TIMEOUT_MS,
  ALLOWED_PERMISSIONS,
};
