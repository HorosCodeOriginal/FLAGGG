'use strict';
// Tests der desk.json-Migration auf v3: Rollen-Graph statt Baum.

const test = require('node:test');
const assert = require('node:assert');

const { migrateDesk, isV3, HierarchyError } = require('../taskqueue/desk-migrate');

function v1Desk() {
  return {
    spaces: [{ id: 'sp1', name: 'core', path: 'C:\\src\\core' }],
    roles: [
      { id: 'boss', name: 'Lead', mandate: 'fuehren', skills: ['plan'], alive: true, spaceId: 'sp1' },
      { id: 'dev', name: 'Dev', mandate: 'bauen' },
      { id: 'qa', name: 'QA', mandate: 'pruefen' },
    ],
    sessionTokens: 1234,
    failover: { enabled: true },
  };
}

function v2Desk() {
  const desk = v1Desk();
  desk.schemaVersion = 2;
  desk.keys = [{ id: 'key_astra_1', provider: 'astra' }];
  desk.roles[1].hierarchy = { parentId: 'boss', children: [] };
  desk.roles[2].hierarchy = { parentId: 'boss', children: [] };
  desk.roles[0].hierarchy = { parentId: null, children: ['dev', 'qa'] };
  return desk;
}

test('v1 wird auf v3 migriert (leere Beziehungen)', () => {
  const { desk, migrated } = migrateDesk(v1Desk(), { keys: [{ id: 'key_astra_01' }] });
  assert.strictEqual(migrated, true);
  assert.strictEqual(desk.schemaVersion, 3);
  assert.strictEqual(desk.roles.length, 3);
  assert.strictEqual(desk.keys.length, 1);
  desk.roles.forEach(r => {
    assert.deepStrictEqual(r.relationships, { superiors: [], subordinates: [], peers: [] });
    assert.strictEqual(r.hierarchy, undefined, 'v2-Baumkante muss verschwunden sein');
  });
  const boss = desk.roles.find(r => r.id === 'boss');
  assert.strictEqual(boss.profile.mandate, 'fuehren');
  assert.strictEqual(boss.model, 'astra');
});

test('v2 parentId wird zu superiors/subordinates', () => {
  const { desk, migrated } = migrateDesk(v2Desk(), {});
  assert.strictEqual(migrated, true);
  assert.strictEqual(desk.schemaVersion, 3);
  const boss = desk.roles.find(r => r.id === 'boss');
  const dev = desk.roles.find(r => r.id === 'dev');
  assert.deepStrictEqual(dev.relationships.superiors, ['boss']);
  assert.deepStrictEqual(boss.relationships.subordinates.sort(), ['dev', 'qa']);
  assert.strictEqual(dev.hierarchy, undefined);
});

test('mehrere Vorgesetzte sind erlaubt (Graph statt Baum)', () => {
  const desk = { roles: [], keys: [], sessionTokens: 0 };
  desk.roles = [
    { id: 'bossA', name: 'A', relationships: { superiors: [], subordinates: [], peers: [] } },
    { id: 'bossB', name: 'B', relationships: { superiors: [], subordinates: [], peers: [] } },
    { id: 'dev', name: 'D', relationships: { superiors: ['bossA', 'bossB'], subordinates: [], peers: [] } },
  ];
  const out = migrateDesk(desk, {}).desk;
  const dev = out.roles.find(r => r.id === 'dev');
  assert.deepStrictEqual(dev.relationships.superiors.sort(), ['bossA', 'bossB']);
  assert.deepStrictEqual(out.roles.find(r => r.id === 'bossA').relationships.subordinates, ['dev']);
  assert.deepStrictEqual(out.roles.find(r => r.id === 'bossB').relationships.subordinates, ['dev']);
});

test('peers werden symmetrisch normalisiert', () => {
  const desk = {
    schemaVersion: 3, keys: [], sessionTokens: 0,
    roles: [
      { id: 'a', name: 'A', relationships: { superiors: [], subordinates: [], peers: ['b'] } },
      { id: 'b', name: 'B', relationships: { superiors: [], subordinates: [], peers: [] } },
    ],
  };
  const out = migrateDesk(desk, {}).desk;
  assert.deepStrictEqual(out.roles.find(r => r.id === 'a').relationships.peers, ['b']);
  assert.deepStrictEqual(out.roles.find(r => r.id === 'b').relationships.peers, ['a']);
});

test('Zyklus in den superiors-Kanten wird abgewiesen', () => {
  const desk = {
    schemaVersion: 3, keys: [], sessionTokens: 0,
    roles: [
      { id: 'a', name: 'A', relationships: { superiors: ['b'], subordinates: [], peers: [] } },
      { id: 'b', name: 'B', relationships: { superiors: ['a'], subordinates: [], peers: [] } },
    ],
  };
  assert.throws(() => migrateDesk(desk, {}), HierarchyError);
  assert.throws(() => migrateDesk(desk, {}), /Zyklus/);
});

test('laengerer Zyklus (A->B->C->A) wird abgewiesen', () => {
  const desk = {
    schemaVersion: 3, keys: [], sessionTokens: 0,
    roles: [
      { id: 'a', name: 'A', relationships: { superiors: ['b'], subordinates: [], peers: [] } },
      { id: 'b', name: 'B', relationships: { superiors: ['c'], subordinates: [], peers: [] } },
      { id: 'c', name: 'C', relationships: { superiors: ['a'], subordinates: [], peers: [] } },
    ],
  };
  assert.throws(() => migrateDesk(desk, {}), /Zyklus/);
});

test('Selbstbezug wird abgewiesen', () => {
  const desk = {
    schemaVersion: 3, keys: [], sessionTokens: 0,
    roles: [{ id: 'a', name: 'A', relationships: { superiors: ['a'], subordinates: [], peers: [] } }],
  };
  assert.throws(() => migrateDesk(desk, {}), /selbst/);
});

test('unbekannte roleId wird abgewiesen', () => {
  const desk = {
    schemaVersion: 3, keys: [], sessionTokens: 0,
    roles: [{ id: 'a', name: 'A', relationships: { superiors: ['gibt-es-nicht'], subordinates: [], peers: [] } }],
  };
  assert.throws(() => migrateDesk(desk, {}), /unbekannte Rolle/);
});

test('Peer und Vorgesetzter gleichzeitig wird abgewiesen', () => {
  const desk = {
    schemaVersion: 3, keys: [], sessionTokens: 0,
    roles: [
      { id: 'a', name: 'A', relationships: { superiors: [], subordinates: [], peers: ['b'] } },
      { id: 'b', name: 'B', relationships: { superiors: ['a'], subordinates: [], peers: [] } },
    ],
  };
  assert.throws(() => migrateDesk(desk, {}), /Peer und Vorgesetzter/);
});

test('v2 mit inkonsistenten children wird abgewiesen', () => {
  const desk = v2Desk();
  desk.roles[1].hierarchy = { parentId: 'qa', children: [] };
  assert.throws(() => migrateDesk(desk, {}), /parentId/);
});

test('v3 bleibt unveraendert (idempotent)', () => {
  const first = migrateDesk(v2Desk(), {}).desk;
  const second = migrateDesk(first, {});
  assert.strictEqual(second.migrated, false);
  assert.strictEqual(isV3(second.desk), true);
  assert.deepStrictEqual(second.desk.roles, first.roles);
});
