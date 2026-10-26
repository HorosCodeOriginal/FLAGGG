'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { buildDesk } = require('../scripts/seed-team-5');
const { createPolicy } = require('../taskqueue/policy');

test('seed-team-5: 5 rollen, shared team_repo, boss graph', () => {
  const { desk, teamRepo } = buildDesk();
  assert.strictEqual(desk.roles.length, 5);
  const boss = desk.roles.find(r => r.id === 'boss_architect');
  assert.ok(boss);
  assert.deepStrictEqual(boss.relationships.subordinates.sort(), [
    'dev_backend', 'dev_frontend', 'doc_writer', 'qa_tester',
  ].sort());
  desk.roles.forEach(r => {
    if (r.id !== 'boss_architect') {
      assert.strictEqual(path.resolve(r.workspace), path.resolve(teamRepo));
      assert.ok(r.relationships.superiors.includes('boss_architect'));
    }
  });
  const policy = createPolicy(desk.roles);
  assert.strictEqual(policy.canSend('boss_architect', 'dev_backend'), true);
  assert.strictEqual(policy.canSend('dev_backend', 'dev_frontend'), true, 'peer');
  assert.strictEqual(policy.canSend('dev_backend', 'doc_writer'), false);
});
