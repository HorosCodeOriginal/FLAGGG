'use strict';
// desk-migrate.js — desk.json v1/v2 -> v3: Rollen-Graph statt Baum.
//
// v3-Rollenmodell:
//   relationships: {
//     superiors:   [roleId],  // wem dieser Agent berichtet (Quelle der Wahrheit)
//     subordinates:[roleId],  // abgeleitet aus den superiors-Kanten der anderen
//     peers:       [roleId]   // Augenhöhe, symmetrisch normalisiert
//   }
// Ein Agent darf mehrere Vorgesetzte, mehrere Untergebene und Peers gleichzeitig
// haben. Zyklen in den superiors-Kanten sind verboten; ein Peer darf nicht
// gleichzeitig Vorgesetzter/Untergebener sein.

const SCHEMA_VERSION = 3;

class HierarchyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HierarchyError';
    this.code = 'HIERARCHY_INVALID';
  }
}

function uniq(list) {
  return Array.from(new Set(list));
}

function idList(value) {
  return Array.isArray(value) ? value.filter(x => typeof x === 'string' && x.length > 0) : [];
}

function emptyRelationships() {
  return { superiors: [], subordinates: [], peers: [] };
}

function defaultRole(source, index) {
  const old = source || {};
  const rel = old.relationships || {};
  const legacyParent = old.hierarchy && old.hierarchy.parentId ? [old.hierarchy.parentId] : [];
  const superiors = idList(rel.superiors).length ? idList(rel.superiors) : legacyParent;
  const role = Object.assign({}, old, {
    id: old.id || 'role_' + String(index + 1).padStart(3, '0'),
    name: old.name || 'Rolle ' + (index + 1),
    model: old.model || 'astra',
    keyId: old.keyId || null,
    workspace: old.workspace || old.spacePath || '',
    permissions: {
      read: idList(old.permissions && old.permissions.read),
      write: idList(old.permissions && old.permissions.write),
    },
    relationships: {
      superiors: uniq(superiors),
      subordinates: idList(rel.subordinates),
      peers: uniq(idList(rel.peers)),
    },
    tokenBudget: {
      maxPerTask: Number(old.tokenBudget && old.tokenBudget.maxPerTask) || 8000,
      maxPerHour: Number(old.tokenBudget && old.tokenBudget.maxPerHour) || 50000,
    },
    status: old.status || 'active',
    // v1-Felder bleiben an der Oberflaeche erhalten (Kompatibilitaet zum Renderer)
    profile: {
      mandate: old.mandate || '',
      voice: old.voice || '',
      bounds: old.bounds || '',
      skills: idList(old.skills),
      tasks: idList(old.tasks),
      automations: idList(old.automations),
      spaceId: old.spaceId || null,
      alive: !!old.alive,
    },
  });
  delete role.hierarchy; // v3 kennt keine Baum-Kante mehr
  return role;
}

// v2-Kinderlisten pruefen: jedes deklarierte Kind muss auf diesen Agenten zeigen
function checkLegacyChildren(roles) {
  const byId = new Map(roles.map(r => [r.id, r]));
  roles.forEach(role => {
    const legacy = role.hierarchy;
    if (!legacy || !Array.isArray(legacy.children)) return;
    legacy.children.forEach(childId => {
      if (!byId.has(childId)) throw new HierarchyError('children verweisen auf unbekannte Rollen: ' + childId);
      const child = byId.get(childId);
      const parentId = child.hierarchy && child.hierarchy.parentId;
      if (parentId !== role.id) {
        throw new HierarchyError('Kind "' + childId + '" hat parentId "' + parentId + '" statt "' + role.id + '"');
      }
    });
  });
}

// superiors-Kanten pruefen, subordinates ableiten, peers symmetrisch machen
function normalizeRelationships(roles) {
  const list = Array.isArray(roles) ? roles : [];
  const ids = new Set(list.map(r => r.id));
  const byId = new Map(list.map(r => [r.id, r]));

  list.forEach(role => {
    if (!role.relationships || typeof role.relationships !== 'object') {
      role.relationships = emptyRelationships();
    }
    role.relationships.superiors = uniq(idList(role.relationships.superiors));
    role.relationships.peers = uniq(idList(role.relationships.peers));
    role.relationships.subordinates = uniq(idList(role.relationships.subordinates));
  });

  // Existenz + Selbstbezug
  list.forEach(role => {
    ['superiors', 'subordinates', 'peers'].forEach(key => {
      role.relationships[key].forEach(otherId => {
        if (!ids.has(otherId)) {
          throw new HierarchyError('relationships.' + key + ' verweist auf unbekannte Rolle "' + otherId + '" (Rolle "' + role.id + '")');
        }
        if (otherId === role.id) {
          throw new HierarchyError('Rolle "' + role.id + '" darf sich selbst nicht als ' + key + ' haben');
        }
      });
    });
  });

  // subordinates ausschliesslich aus den superiors-Kanten ableiten
  const derived = new Map(list.map(r => [r.id, []]));
  list.forEach(role => {
    role.relationships.superiors.forEach(superiorId => {
      derived.get(superiorId).push(role.id);
    });
  });
  list.forEach(role => {
    role.relationships.subordinates = uniq(derived.get(role.id));
  });

  // peers symmetrisch
  list.forEach(role => {
    role.relationships.peers.forEach(peerId => {
      const peer = byId.get(peerId);
      if (!peer.relationships.peers.includes(role.id)) {
        peer.relationships.peers.push(role.id);
      }
    });
  });
  list.forEach(role => { role.relationships.peers = uniq(role.relationships.peers); });

  // Widerspruch: Peer waere gleichzeitig Vorgesetzter/Untergebener
  list.forEach(role => {
    role.relationships.peers.forEach(peerId => {
      if (role.relationships.superiors.includes(peerId) || role.relationships.subordinates.includes(peerId)) {
        throw new HierarchyError('Rolle "' + role.id + '" und "' + peerId + '" sind gleichzeitig Peer und Vorgesetzter/Untergebener');
      }
    });
  });

  return list;
}

// Zykluspuefung ueber die superiors-Kanten (DFS, mehrere Vorgesetzte erlaubt)
function assertNoCycles(roles) {
  const list = Array.isArray(roles) ? roles : [];
  const byId = new Map(list.map(r => [r.id, r]));
  const state = new Map(); // id -> 1 = in arbeit, 2 = fertig

  function visit(id, stack) {
    const mark = state.get(id) || 0;
    if (mark === 1) {
      throw new HierarchyError('Zyklus in den superiors-Kanten: ' + stack.concat(id).join(' -> '));
    }
    if (mark === 2) return;
    state.set(id, 1);
    const role = byId.get(id);
    (role.relationships.superiors || []).forEach(superiorId => {
      if (byId.has(superiorId)) visit(superiorId, stack.concat(id));
    });
    state.set(id, 2);
  }

  list.forEach(role => visit(role.id, []));
  return list;
}

function validateRoles(roles) {
  normalizeRelationships(roles);
  assertNoCycles(roles);
  return roles;
}

function isV3(desk) {
  if (!desk || Number(desk.schemaVersion) < SCHEMA_VERSION) return false;
  if (!Array.isArray(desk.roles)) return false;
  return desk.roles.every(r => r && r.relationships && typeof r.relationships === 'object');
}

/**
 * migrateDesk(desk, { keys }) -> { desk, migrated }
 * v1: { spaces, roles, sessionTokens, failover } ohne Beziehungen
 * v2: hierarchy: { parentId, children }
 * v3: relationships: { superiors, subordinates, peers }
 */
function migrateDesk(desk, options) {
  const opts = options || {};
  const source = desk && typeof desk === 'object' ? desk : {};

  if (isV3(source)) {
    validateRoles(source.roles);
    return { desk: source, migrated: false };
  }

  if (Array.isArray(source.roles)) checkLegacyChildren(source.roles);

  const roles = (Array.isArray(source.roles) ? source.roles : []).map(defaultRole);
  validateRoles(roles);

  const keys = Array.isArray(source.keys) ? source.keys.slice() : (Array.isArray(opts.keys) ? opts.keys.slice() : []);

  const migrated = Object.assign({}, source, {
    schemaVersion: SCHEMA_VERSION,
    roles,
    keys,
    spaces: Array.isArray(source.spaces) ? source.spaces : [],
    sessionTokens: Number(source.sessionTokens) || 0,
    failover: source.failover && typeof source.failover === 'object' ? source.failover : {},
  });

  return { desk: migrated, migrated: true };
}

module.exports = {
  SCHEMA_VERSION,
  HierarchyError,
  migrateDesk,
  isV3,
  validateRoles,
  normalizeRelationships,
  assertNoCycles,
  emptyRelationships,
};
