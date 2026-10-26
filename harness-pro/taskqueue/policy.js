'use strict';
// policy.js — Berechtigungsregeln fuer den Rollen-Graph.
//
// Senden:  system -> alles; an sich selbst; an eigene subordinates; an peers.
//          An Vorgesetzte senden ist NICHT erlaubt (dafuer gibt es Reports).
// Empfangen: system -> alles; von sich selbst; von superiors, subordinates
//          oder peers (jede Kante im Graph zaehlt).

const SYSTEM_ROLE = 'system';

function normalizeRole(role) {
  const rel = (role && role.relationships) || {};
  return {
    id: role && role.id,
    superiors: Array.isArray(rel.superiors) ? rel.superiors : [],
    subordinates: Array.isArray(rel.subordinates) ? rel.subordinates : [],
    peers: Array.isArray(rel.peers) ? rel.peers : [],
  };
}

function buildIndex(roles) {
  const index = new Map();
  (Array.isArray(roles) ? roles : []).forEach(role => {
    const norm = normalizeRole(role);
    if (norm.id) index.set(norm.id, norm);
  });
  return index;
}

function relatedIds(role) {
  if (!role) return new Set();
  return new Set([].concat(role.superiors, role.subordinates, role.peers));
}

function createPolicy(rolesProvider) {
  function currentIndex() {
    const roles = typeof rolesProvider === 'function' ? rolesProvider() : rolesProvider;
    return buildIndex(roles);
  }

  function canSend(fromRole, toRole) {
    if (!fromRole || !toRole) return false;
    if (fromRole === SYSTEM_ROLE) return true;
    if (fromRole === toRole) return true;
    const index = currentIndex();
    const from = index.get(fromRole);
    if (!from) return false;
    return from.subordinates.includes(toRole) || from.peers.includes(toRole);
  }

  function canReceive(roleId, fromRole) {
    if (!roleId || !fromRole) return false;
    if (fromRole === SYSTEM_ROLE) return true;
    if (fromRole === roleId) return true;
    const index = currentIndex();
    const role = index.get(roleId);
    if (!role) return false;
    return relatedIds(role).has(fromRole);
  }

  function relationBetween(fromRole, toRole) {
    const index = currentIndex();
    const from = index.get(fromRole);
    const to = index.get(toRole);
    if (!from || !to) return null;
    if (from.subordinates.includes(toRole)) return 'subordinate';
    if (from.peers.includes(toRole)) return 'peer';
    if (to.subordinates.includes(fromRole)) return 'superior';
    return null;
  }

  return { canSend, canReceive, relationBetween, index: currentIndex };
}

module.exports = { SYSTEM_ROLE, createPolicy, buildIndex, relatedIds };
