#!/usr/bin/env node
'use strict';
// seed-live-test.js — legt die desk.json für den Zwei-Agenten-Live-Test an.
// Aufruf:  node scripts/seed-live-test.js
// Optionen: --out <desk.json>  --workspaces <verzeichnis>

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const DESK_FILE = path.resolve(argValue('--out', path.join(ROOT, 'data', 'desk.json')));
const WORKSPACES = path.resolve(argValue('--workspaces', path.join(ROOT, 'workspaces')));
const bossWorkspace = path.join(WORKSPACES, 'boss_astra');
const subWorkspace = path.join(WORKSPACES, 'sub_opus');

const desk = {
  schemaVersion: 3,
  keys: [
    { id: 'key_astra_1', provider: 'astra', status: 'assigned', assignedToRole: 'boss_astra', nr: 1, port: 20129, masked: '••••••••••' },
    { id: 'key_opus_24', provider: 'opus', status: 'assigned', assignedToRole: 'sub_opus', nr: 24, port: 20152, masked: '••••••••••' },
  ],
  sessionTokens: 0,
  failover: { enabled: false },
  spaces: [],
  roles: [
    {
      id: 'boss_astra',
      name: 'Boss Astra',
      model: 'astra',
      keyId: 'key_astra_1',
      workspace: bossWorkspace,
      relationships: { superiors: [], subordinates: ['sub_opus'], peers: [] },
      tokenBudget: { maxPerTask: 8000, maxPerHour: 50000 },
      status: 'active',
      permissions: { read: [], write: [] },
      usage: { tokens: 0, updatedAt: null },
      profile: { mandate: 'Live-Test-Boss: delegiert an Sub Opus', skills: ['delegation'] },
    },
    {
      id: 'sub_opus',
      name: 'Sub Opus',
      model: 'opus',
      keyId: 'key_opus_24',
      workspace: subWorkspace,
      relationships: { superiors: ['boss_astra'], subordinates: [], peers: [] },
      tokenBudget: { maxPerTask: 8000, maxPerHour: 50000 },
      status: 'active',
      permissions: { read: [], write: [] },
      usage: { tokens: 0, updatedAt: null },
      profile: { mandate: 'Live-Test-Sub: schreibt und führt Python aus', skills: ['tooling'] },
    },
  ],
};

// Validierung mit der echten Migration (wirft bei ungültigem Graph)
const { migrateDesk, isV3 } = require(path.join(ROOT, 'taskqueue', 'desk-migrate'));
const result = migrateDesk(desk, {});
if (!isV3(result.desk)) throw new Error('desk.json ist nach dem Seed nicht v3');

const boss = result.desk.roles.find(r => r.id === 'boss_astra');
const sub = result.desk.roles.find(r => r.id === 'sub_opus');
if (!boss || !sub) throw new Error('Seed: eine der Rollen fehlt');
if (!boss.relationships.subordinates.includes('sub_opus')) throw new Error('Seed: boss_astra hat sub_opus nicht als Untergebenen');
if (!sub.relationships.superiors.includes('boss_astra')) throw new Error('Seed: sub_opus hat boss_astra nicht als Vorgesetzten');

fs.mkdirSync(path.dirname(DESK_FILE), { recursive: true });
fs.writeFileSync(DESK_FILE, JSON.stringify(result.desk, null, 2) + '\n', 'utf8');

// Beide Workspace-Ordner müssen existieren (mkdir recursive)
fs.mkdirSync(bossWorkspace, { recursive: true });
fs.mkdirSync(subWorkspace, { recursive: true });

console.log('[seed] desk.json: ' + DESK_FILE);
console.log('[seed] role-id: ' + boss.id);
console.log('[seed] role-id: ' + sub.id);
console.log('[seed] workspaces: ' + bossWorkspace);
console.log('[seed]             ' + subWorkspace);
