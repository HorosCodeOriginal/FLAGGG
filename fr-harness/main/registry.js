// registry.js — liest fr-gateway/secrets/registry.json → liste env-defs
// env-def: { nr, key_hash, port, container, raw_key, unique_key, model_family, created, state, limit_override }
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function registryPath() {
  // Entwicklung: ../fr-gateway/secrets/registry.json relativ zum projektdir.
  // Paket (electron-builder): extraResources -> fr-gateway/secrets/registry.json
  const dev = path.join(app.getAppPath(), '..', 'fr-gateway', 'secrets', 'registry.json');
  if (fs.existsSync(dev)) return dev;
  const packed = path.join(process.resourcesPath, 'fr-gateway', 'secrets', 'registry.json');
  return packed;
}

function loadRegistry() {
  try {
    const raw = fs.readFileSync(registryPath(), 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(e => e && typeof e === 'object' && e.port);
  } catch (err) {
    console.error('[registry] lesefehler:', err.message);
    return [];
  }
}

// env-defs in dashboard-reihenfolge (nr aufsteigend, entfernte ans ende)
function envDefs() {
  return loadRegistry().sort((a, b) => {
    const na = typeof a.nr === 'number' ? a.nr : Number.MAX_SAFE_INTEGER;
    const nb = typeof b.nr === 'number' ? b.nr : Number.MAX_SAFE_INTEGER;
    return na - nb;
  });
}

function envByNr(nr) {
  return loadRegistry().find(e => e.nr === Number(nr)) || null;
}

module.exports = { loadRegistry, envDefs, envByNr, registryPath };
