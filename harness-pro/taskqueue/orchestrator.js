'use strict';
// orchestrator.js — Boot-Prozess: desk.json-Rollen -> AgentRuntime je Rolle.
// Reine Logik mit injizierten Abhaengigkeiten (deskStore, registryStore, queue, transport)
// damit sie ohne Electron testbar bleibt.

const { AgentRuntime } = require('./runtime');
const fs = require('fs');
const { validateRoles } = require('./desk-migrate');
const { createPolicy } = require('./policy');
const { synthesize } = require('./synthesizer');

const FAMILY_MODEL = { astra: 'gpt-6-astra', opus: 'claude-opus-5.5' };

function maskKey(key) {
  const value = String(key || '');
  if (value.length < 10) return value ? '•••' : '';
  return value.slice(0, 6) + '•••' + value.slice(-4);
}

function roleIdFromName(name) {
  const slug = String(name || 'role').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role';
  return 'role_' + slug;
}

/**
 * createRole(desk, registry, input) -> { desk, role, key }
 * desk: v2-Objekt (wird mutiert), registry: Array aus fr-gateway/secrets/registry.json
 */
function createRole(desk, registry, input) {
  const d = desk || {};
  const roles = Array.isArray(d.roles) ? d.roles : [];
  const keys = Array.isArray(d.keys) ? d.keys : [];
  const entries = Array.isArray(registry) ? registry : [];

  if (!input || !input.name) throw new Error('roles:create: name fehlt');

  const family = input.model === 'opus' ? 'opus' : 'astra';
  const used = new Set(keys.filter(k => k && k.status === 'assigned').map(k => Number(k.nr)));
  const free = entries.find(e => e && e.port && e.unique_key && !used.has(Number(e.nr)) &&
    (!e.model_family || e.model_family === family)) ||
    entries.find(e => e && e.port && e.unique_key && !used.has(Number(e.nr)));

  let roleId = input.id || roleIdFromName(input.name);
  let suffix = 1;
  while (roles.some(r => r && r.id === roleId)) {
    roleId = roleIdFromName(input.name) + '_' + suffix;
    suffix += 1;
  }

  // v3: Graph-Beziehungen. input.parentId bleibt als Legacy-Feld akzeptiert.
  const superiors = Array.isArray(input.superiors) ? input.superiors.slice() : [];
  if (input.parentId) superiors.push(input.parentId);
  const peers = Array.isArray(input.peers) ? input.peers.slice() : [];

  const role = {
    id: roleId,
    name: input.name,
    model: family,
    keyId: free ? 'key_' + family + '_' + free.nr : null,
    workspace: input.workspace || '',
    permissions: { read: input.read || [], write: input.write || [] },
    relationships: {
      superiors: Array.from(new Set(superiors)),
      subordinates: [],
      peers: Array.from(new Set(peers)),
    },
    tokenBudget: { maxPerTask: Number(input.maxPerTask) || 8000, maxPerHour: Number(input.maxPerHour) || 50000 },
    status: input.status || 'active',
    usage: { tokens: 0, updatedAt: null },
    profile: { mandate: input.mandate || '', skills: input.skills || [] },
  };

  roles.push(role);
  d.roles = roles;
  // Graph validieren: unbekannte IDs, Zyklen, Peer/Superior-Widerspruch,
  // subordinates aus den superiors-Kanten ableiten
  validateRoles(roles);

  let key = null;
  if (free) {
    key = {
      id: role.keyId,
      provider: family,
      status: 'assigned',
      assignedToRole: role.id,
      nr: free.nr,
      port: free.port,
      masked: maskKey(free.unique_key),
    };
    keys.push(key);
  }
  d.keys = keys;

  return { desk: d, role, key };
}

class Orchestrator {
  constructor(options) {
    const o = options || {};
    if (!o.deskStore || typeof o.deskStore.load !== 'function' || typeof o.deskStore.save !== 'function') {
      throw new Error('Orchestrator: deskStore {load,save} fehlt');
    }
    if (!o.registryStore || typeof o.registryStore.load !== 'function') {
      throw new Error('Orchestrator: registryStore {load} fehlt');
    }
    if (!o.queue) throw new Error('Orchestrator: queue fehlt');
    if (typeof o.transport !== 'function') throw new Error('Orchestrator: transport fehlt');

    this.deskStore = o.deskStore;
    this.registryStore = o.registryStore;
    this.queue = o.queue;
    this.transport = o.transport; // chat({entry, model, task, roleId, candidates})
    this.logger = o.logger || console;
    this.pollMs = Number(o.pollMs) || 1000;
    this.policy = o.policy || null;
    this.maxConcurrent = Math.max(1, Number(o.maxConcurrent) || 2);
    this.runtimes = new Map();
    this.synthTimer = null;
    this.synthBusy = false;
    this.synthMs = Number(o.synthMs) || 30000;
    this.started = false;
  }

  // Rolle -> Registry-Eintrag (Port + Key). Bereits zugewiesene Keys (desk.keys
  // status=assigned) werden nie doppelt vergeben; eine keyId zaehlt nur fuer
  // genau die Rolle, der sie zugewiesen wurde.
  resolveRole(role) {
    const registry = this.registryStore.load() || [];
    if (!role) return null;
    const desk = this.deskStore.load() || {};
    const keys = Array.isArray(desk.keys) ? desk.keys : [];
    const usedByOther = nr => keys.some(k => k && Number(k.nr) === Number(nr) &&
      k.status === 'assigned' && k.assignedToRole !== role.id);

    let entry = null;
    if (role.keyId) {
      const nrMatch = String(role.keyId).match(/_(\d+)$/);
      if (nrMatch) {
        const want = Number(nrMatch[1]);
        const hit = registry.find(e => e && Number(e.nr) === want && e.port && e.unique_key);
        if (hit && !usedByOther(want)) entry = hit;
      }
    }
    if (!entry) {
      const family = role.model === 'opus' ? 'opus' : 'astra';
      entry = registry.find(e => e && e.port && e.unique_key &&
        !usedByOther(e.nr) && (e.model_family || 'astra') === family) ||
        registry.find(e => e && e.port && e.unique_key && !usedByOther(e.nr));
    }
    return entry ? { role, entry } : null;
  }

  // Chat-Callback einer Rolle: schickt an den Port der Rolle, faellt auf gleichwertige zurueck
  chatFor(role, entry) {
    const registry = this.registryStore.load() || [];
    const candidates = [{ nr: entry.nr, port: entry.port, key: entry.unique_key }];
    registry
      .filter(e => e && e.port && e.unique_key && Number(e.nr) !== Number(entry.nr) &&
        (e.model_family || 'astra') === (role.model === 'opus' ? 'opus' : 'astra'))
      .slice(0, 2)
      .forEach(e => candidates.push({ nr: e.nr, port: e.port, key: e.unique_key }));

    return async args => {
      const out = await this.transport({
        entry,
        candidates,
        model: FAMILY_MODEL[role.model] || FAMILY_MODEL.astra,
        roleId: role.id,
        task: args && args.task,
      });
      this.trackUsage(role.id, out && out.usage);
      return out && out.result !== undefined ? out.result : out;
    };
  }

  trackUsage(roleId, usage) {
    const used = usage ? Number(usage.total_tokens) ||
      ((Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0)) : 0;
    if (!used) return;
    // immer den neuesten Stand laden und unter dem Desk-Mutex schreiben
    const apply = desk => {
      const role = (desk.roles || []).find(r => r && r.id === roleId);
      if (!role) return false;
      role.usage = role.usage || { tokens: 0, updatedAt: null };
      role.usage.tokens += used;
      role.usage.updatedAt = new Date().toISOString();
      desk.sessionTokens = (Number(desk.sessionTokens) || 0) + used;
      return true;
    };
    if (typeof this.deskStore.mutate === 'function') {
      this.deskStore.mutate(apply);
      return;
    }
    const desk = this.deskStore.load();
    if (apply(desk)) this.deskStore.save(desk);
  }

  // Attention Economy: Kind-Ergebnisse regelmaessig zu einem Report verdichten
  startSynthesizer() {
    if (this.synthTimer) return this;
    this.synthTimer = setInterval(() => {
      this.runSynthesis().catch(err => this.logger.error('[synthesizer] ' + err.message));
    }, Math.max(50, this.synthMs));
    if (this.synthTimer.unref) this.synthTimer.unref();
    return this;
  }

  stopSynthesizer() {
    if (this.synthTimer) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    return this;
  }

  async runSynthesis() {
    // Schutz gegen ueberlappende Laeufe: setInterval wartet nicht auf async
    if (this.synthBusy) return [];
    this.synthBusy = true;
    try {
      return await this._runSynthesis();
    } finally {
      this.synthBusy = false;
    }
  }

  async _runSynthesis() {
    const desk = this.deskStore.load() || {};
    const parents = (desk.roles || []).filter(r => r && Array.isArray(r.relationships && r.relationships.subordinates) && r.relationships.subordinates.length);
    const out = [];
    for (const role of parents) {
      try {
        const report = typeof this.queue.listUnsynthizedChildren === 'function'
          ? await synthesize(this.queue, role.id)
          : await this.queue.synthesize(role.id);
        if (report) out.push(report);
      } catch (err) {
        this.logger.error('[synthesizer ' + role.id + '] ' + err.message);
      }
    }
    return out;
  }

  startAll() {
    const desk = this.deskStore.load() || {};
    const policy = this.policy || createPolicy(() => (this.deskStore.load() || {}).roles || []);
    const roles = (desk.roles || []).filter(r => r && r.status === 'active');
    let started = 0;
    roles.forEach(role => {
      const resolved = this.resolveRole(role);
      if (!resolved) {
        this.logger.error('[orchestrator] keine registry-instanz fuer rolle ' + role.id);
        return;
      }
      if (role.workspace) {
        try { fs.mkdirSync(role.workspace, { recursive: true }); }
        catch (err) { this.logger.error('[orchestrator] workspace ' + role.workspace + ': ' + err.message); }
      }
      const runtime = new AgentRuntime({
        queue: this.queue,
        roleId: role.id,
        model: FAMILY_MODEL[role.model] || FAMILY_MODEL.astra,
        pollMs: this.pollMs,
        chat: this.chatFor(role, resolved.entry),
        policy,
        workspace: role.workspace || null,
        maxConcurrent: this.maxConcurrent,
        logger: this.logger,
      });
      runtime.start();
      this.runtimes.set(role.id, { runtime, entry: resolved.entry, role });
      started += 1;
    });
    this.started = true;
    this.startSynthesizer();
    this.logger.log('[orchestrator] ' + started + ' runtime(s) gestartet');
    return { started, total: roles.length };
  }

  stopAll() {
    this.runtimes.forEach(item => {
      try { item.runtime.stop(); } catch (e) { /* egal */ }
    });
    this.runtimes.clear();
    this.stopSynthesizer();
    this.started = false;
    return true;
  }

  status() {
    return Array.from(this.runtimes.entries()).map(([roleId, item]) => ({
      roleId,
      port: item.entry.port,
      nr: item.entry.nr,
      stats: item.runtime.stats,
    }));
  }
}

module.exports = { Orchestrator, createRole, maskKey, roleIdFromName, FAMILY_MODEL };
