// files.js — sandboxed fs-ops strikt unter dem env-cwd.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function envWorkspace(nr) {
  const base = path.join(ROOT, 'envs', String(nr));
  const ws = path.join(base, 'workspace');
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

function resolveInside(ws, rel) {
  const target = path.resolve(ws, rel || '.');
  if (target !== ws && !target.startsWith(ws + path.sep)) {
    const err = new Error('pfad ausserhalb der workspace: ' + rel);
    err.code = 'EACCES';
    throw err;
  }
  return target;
}

function tree(ws, rel) {
  const root = resolveInside(ws, rel);
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) return { name: path.basename(root), type: 'file', path: rel || '.' };
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    name: path.basename(root) || ws,
    type: 'dir',
    path: rel || '',
    children: entries.map(e => {
      const childRel = path.join(rel || '', e.name);
      if (e.isDirectory()) return tree(ws, childRel);
      return { name: e.name, type: 'file', path: childRel };
    }),
  };
}

function readFile(ws, rel) {
  const p = resolveInside(ws, rel);
  return { path: rel, content: fs.readFileSync(p, 'utf-8') };
}

function writeFile(ws, rel, content) {
  const p = resolveInside(ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
  return { path: rel, bytes: Buffer.byteLength(content, 'utf-8') };
}

function create(ws, rel, type) {
  const p = resolveInside(ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (type === 'dir') {
    fs.mkdirSync(p, { recursive: true });
  } else {
    if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf-8');
  }
  return { path: rel, type };
}

function remove(ws, rel) {
  const p = resolveInside(ws, rel);
  if (p === ws) throw new Error('workspace-root kann nicht geloescht werden');
  fs.rmSync(p, { recursive: true, force: true });
  return { path: rel, deleted: true };
}

module.exports = { envWorkspace, tree, readFile, writeFile, create, remove };
