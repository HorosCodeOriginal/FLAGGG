'use strict';
// Tests des Synthesizers (DoD 4): Kind-Ergebnisse -> ein Report an den Parent.
// Synthetisiert werden done-, failed- und escalated-Kinder, jeweils genau einmal.

const test = require('node:test');
const assert = require('node:assert');

const { TaskQueue } = require('../taskqueue/taskqueue');
const { synthesize, buildSummary, findContradictions } = require('../taskqueue/synthesizer');

async function child(queue, targetRole, parentId, title, result, requestId, options) {
  const o = options || {};
  const { task } = await queue.enqueue({
    type: 'request',
    title,
    schema_name: 's1',
    payload: { q: 1 },
    source_role: 'system',
    target_role: targetRole,
    request_id: requestId || 'c-' + Math.random().toString(36).slice(2, 9),
    parent_id: parentId,
  });
  await queue.claimNextTask(targetRole);
  await queue.updateState(task.id, 'running', { message: 'test' });
  if (o.fail) {
    await queue.updateState(task.id, 'failed', { error: o.fail, code: 'E_RUNTIME' });
  } else {
    await queue.updateState(task.id, 'done', { result });
  }
  return task.id;
}

test('synthesize erzeugt einen Report-Task mit korrekter Zusammenfassung (DoD 4)', async () => {
  const queue = new TaskQueue(':memory:');
  await child(queue, 'dev1', 'boss', 'SQL optimieren', { rows: 1 });
  await child(queue, 'dev2', 'boss', 'Index pruefen', { rows: 2 });

  const report = await synthesize(queue, 'boss', { requestId: 'synth-1' });
  assert.ok(report, 'Report muss entstehen');
  assert.strictEqual(report.type, 'report');
  assert.strictEqual(report.target_role, 'boss');
  assert.strictEqual(report.source_role, 'system');

  const payload = typeof report.payload === 'string' ? JSON.parse(report.payload) : report.payload;
  assert.strictEqual(payload.total, 2);
  assert.strictEqual(payload.done, 2);
  assert.strictEqual(payload.failed, 0);
  assert.deepStrictEqual(payload.errors, []);
  assert.strictEqual(payload.results_summary.length, 2);
  assert.ok(payload.results_summary.every(item => item.state === 'done'));
  assert.deepStrictEqual(payload.contradictions, []);

  // Tasks sind als synthetisiert markiert -> zweiter Lauf erzeugt nichts Neues
  assert.strictEqual(await synthesize(queue, 'boss'), null);
  queue.close();
});

test('failed/escalated-Kinder werden mitgezaehlt und ihre Fehler gesammelt', async () => {
  const queue = new TaskQueue(':memory:');
  await child(queue, 'dev1', 'boss', 'Job A', { ok: true });
  await child(queue, 'dev2', 'boss', 'Job B', { ok: false }, null, { fail: 'timeout beim Upstream' });

  const report = await synthesize(queue, 'boss', { requestId: 'synth-2' });
  const payload = typeof report.payload === 'string' ? JSON.parse(report.payload) : report.payload;
  assert.strictEqual(payload.total, 2);
  assert.strictEqual(payload.done, 1);
  assert.strictEqual(payload.failed, 1);
  assert.deepStrictEqual(payload.errors, ['timeout beim Upstream']);
  queue.close();
});

test('Widerspruch: gleiche Aufgabe, unterschiedliche Ergebnisse wird markiert', async () => {
  const queue = new TaskQueue(':memory:');
  await child(queue, 'dev1', 'boss', 'Antwort bestimmen', { answer: 'A' });
  await child(queue, 'dev2', 'boss', 'Antwort bestimmen', { answer: 'B' });

  const report = await synthesize(queue, 'boss', { requestId: 'synth-3' });
  const payload = typeof report.payload === 'string' ? JSON.parse(report.payload) : report.payload;
  assert.strictEqual(payload.contradictions.length, 1);
  assert.strictEqual(payload.contradictions[0].title, 'Antwort bestimmen');
  assert.strictEqual(payload.contradictions[0].results, 2);
  queue.close();
});

test('buildSummary liefert die Spec-Felder', () => {
  const summary = buildSummary([
    { id: 't1', title: 'X', state: 'failed', result: null, errors: [{ error: 'timeout' }, { error: 'timeout' }] },
    { id: 't2', title: 'Y', state: 'done', result: { ok: 1 }, errors: [] },
    { id: 't3', title: 'Z', state: 'escalated', result: null, errors: [{ error: 'max_attempts' }] },
  ]);
  assert.strictEqual(summary.total, 3);
  assert.strictEqual(summary.done, 1);
  assert.strictEqual(summary.failed, 2);
  assert.deepStrictEqual(summary.errors, ['timeout', 'max_attempts']);
  assert.strictEqual(summary.results_summary.length, 3);
  assert.strictEqual(summary.results_summary[1].state, 'done');
});

test('findContradictions erkennt nur echte Abweichungen', () => {
  const same = findContradictions([
    { id: '1', title: 'A', result: { v: 1 } },
    { id: '2', title: 'A', result: { v: 1 } },
  ]);
  assert.deepStrictEqual(same, []);
  const diff = findContradictions([
    { id: '1', title: 'A', result: { v: 1 } },
    { id: '2', title: 'A', result: { v: 2 } },
  ]);
  assert.strictEqual(diff.length, 1);
});
