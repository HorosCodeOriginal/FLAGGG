#!/usr/bin/env node
'use strict';
// seed-team-5.js — desk.json (v3) mit 5 Rollen, gemeinsamer Workspace team_repo.
// Aufruf: node scripts/seed-team-5.js [--out <desk.json>] [--workspaces <dir>]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function buildDesk(options) {
  const opts = options || {};
  const workspaces = path.resolve(opts.workspaces || path.join(ROOT, 'workspaces'));
  const teamRepo = path.join(workspaces, 'team_repo');

  function role(id, name, model, keyId, mandate, relationships) {
    return {
      id,
      name,
      model,
      keyId,
      workspace: teamRepo,
      relationships,
      tokenBudget: { maxPerTask: 8000, maxPerHour: 50000 },
      status: 'active',
      permissions: { read: [], write: [] },
      usage: { tokens: 0, updatedAt: null },
      profile: { mandate, skills: [] },
    };
  }

  const subs = ['dev_backend', 'dev_frontend', 'qa_tester', 'doc_writer'];
  const superiorOnly = { superiors: ['boss_architect'], subordinates: [], peers: [] };
  const backendRels = {
    superiors: ['boss_architect'],
    subordinates: [],
    peers: ['dev_frontend'],
  };
  const frontendRels = {
    superiors: ['boss_architect'],
    subordinates: [],
    peers: ['dev_backend'],
  };

  const desk = {
    schemaVersion: 3,
    keys: [
      { id: 'key_astra_boss', provider: 'astra', status: 'assigned', assignedToRole: 'boss_architect', nr: 1, port: 20129, masked: '••••••••••' },
      { id: 'key_opus_backend', provider: 'opus', status: 'assigned', assignedToRole: 'dev_backend', nr: 24, port: 20152, masked: '••••••••••' },
      { id: 'key_astra_frontend', provider: 'astra', status: 'assigned', assignedToRole: 'dev_frontend', nr: 2, port: 20130, masked: '••••••••••' },
      { id: 'key_opus_qa', provider: 'opus', status: 'assigned', assignedToRole: 'qa_tester', nr: 25, port: 20153, masked: '••••••••••' },
      { id: 'key_astra_doc', provider: 'astra', status: 'assigned', assignedToRole: 'doc_writer', nr: 3, port: 20131, masked: '••••••••••' },
    ],
    sessionTokens: 0,
    failover: { enabled: false },
    spaces: [],
    roles: [
      role('boss_architect', 'Boss Architect', 'astra', 'key_astra_boss',
        'Koordiniert Todo-Team: delegiert, prueft, Fix-Tasks', {
          superiors: [],
          subordinates: subs.slice(),
          peers: [],
        }),
      role('dev_backend', 'Dev Backend', 'opus', 'key_opus_backend',
        'Flask/FastAPI REST-API', backendRels),
      role('dev_frontend', 'Dev Frontend', 'astra', 'key_astra_frontend',
        'HTML/CSS/JS mit Fetch', frontendRels),
      role('qa_tester', 'QA Tester', 'opus', 'key_opus_qa',
        'Pytest schreiben und ausfuehren', superiorOnly),
      role('doc_writer', 'Doc Writer', 'astra', 'key_astra_doc',
        'README und API-Doku', superiorOnly),
    ],
  };

  const { migrateDesk, isV3 } = require(path.join(ROOT, 'taskqueue', 'desk-migrate'));
  const result = migrateDesk(desk, {});
  if (!isV3(result.desk)) throw new Error('desk.json ist nach Seed nicht v3');

  const boss = result.desk.roles.find(r => r.id === 'boss_architect');
  if (!boss || boss.relationships.subordinates.length !== 4) {
    throw new Error('Seed: boss_architect braucht 4 subordinates');
  }
  result.desk.roles.forEach(r => {
    if (r.id === 'boss_architect') return;
    if (path.resolve(r.workspace) !== path.resolve(teamRepo)) {
      throw new Error('Seed: Rolle ' + r.id + ' muss team_repo teilen');
    }
  });

  return { desk: result.desk, teamRepo, migrated: result.migrated };
}

function runCli() {
  const args = process.argv.slice(2);
  function argValue(flag, fallback) {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  }
  const deskFile = path.resolve(argValue('--out', path.join(ROOT, 'data', 'desk.json')));
  const workspaces = path.resolve(argValue('--workspaces', path.join(ROOT, 'workspaces')));
  const { desk, teamRepo } = buildDesk({ workspaces });

  fs.mkdirSync(path.dirname(deskFile), { recursive: true });
  fs.mkdirSync(teamRepo, { recursive: true });
  fs.writeFileSync(deskFile, JSON.stringify(desk, null, 2) + '\n', 'utf8');

  console.log('[seed-team-5] desk.json: ' + deskFile);
  console.log('[seed-team-5] shared workspace: ' + teamRepo);
  console.log('[seed-team-5] rollen: ' + desk.roles.map(r => r.id).join(', '));
}

if (require.main === module) {
  runCli();
}

module.exports = { buildDesk, ROOT };
