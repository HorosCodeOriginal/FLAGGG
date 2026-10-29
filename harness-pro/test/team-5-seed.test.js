'use strict';
// Team-5 Desk: Graph-Kanten Boss/Architekt + Devs + QA + Docs.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { buildDesk } = require('../scripts/seed-team-5');
const { createPolicy } = require('../taskqueue/policy');

test('seed-team-5: 5 rollen, shared team_repo, boss graph', () => {
  const { desk, teamRepo } = buildDesk();
  assert.strictEqual(desk.roles.length, 5);
  const boss = desk.roles.find((r) => r.id === 'boss_architect');
  assert.ok(boss);
  assert.deepStrictEqual(boss.relationships.subordinates.sort(), [
    'dev_backend',
    'dev_frontend',
    'doc_writer',
    'qa_tester',
  ].sort());
  desk.roles.forEach((r) => {
    if (r.id !== 'boss_architect') {
      assert.strictEqual(path.resolve(r.workspace), path.resolve(teamRepo));
      assert.ok(r.relationships.superiors.includes('boss_architect'));
    }
  });
});

test('seed-team-5: Policy-Matrix (superiors / peers / blocked)', () => {
  const { desk } = buildDesk();
  const policy = createPolicy(desk.roles);

  // Boss -> alle Spezialisten
  ['dev_backend', 'dev_frontend', 'qa_tester', 'doc_writer'].forEach((id) => {
    assert.strictEqual(policy.canSend('boss_architect', id), true, 'boss -> ' + id);
  });

  // Dev-Peers
  assert.strictEqual(policy.canSend('dev_backend', 'dev_frontend'), true, 'backend peer frontend');
  assert.strictEqual(policy.canSend('dev_frontend', 'dev_backend'), true, 'frontend peer backend');

  // QA <-> Docs Peers
  assert.strictEqual(policy.canSend('qa_tester', 'doc_writer'), true, 'qa peer docs');
  assert.strictEqual(policy.canSend('doc_writer', 'qa_tester'), true, 'docs peer qa');

  // Cross-team ohne Kante
  assert.strictEqual(policy.canSend('dev_backend', 'doc_writer'), false);
  assert.strictEqual(policy.canSend('dev_backend', 'qa_tester'), false);
  assert.strictEqual(policy.canSend('qa_tester', 'dev_backend'), false);
  assert.strictEqual(policy.canSend('doc_writer', 'dev_frontend'), false);

  // Spezialist darf nicht an Boss senden (kein superior-Pfad rueckwaerts)
  assert.strictEqual(policy.canSend('dev_backend', 'boss_architect'), false);
});

test('seed-team-5: Anzeigenamen markieren Team-Rollen', () => {
  const { desk } = buildDesk();
  const byId = Object.fromEntries(desk.roles.map((r) => [r.id, r]));
  assert.match(byId.boss_architect.name, /Boss|Architekt/i);
  assert.match(byId.qa_tester.name, /QA/i);
  assert.match(byId.doc_writer.name, /Doc/i);
});
