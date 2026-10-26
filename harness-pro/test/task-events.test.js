'use strict';
// Tests der reinen Live-Logik (Timeline + Knoten-Status).

const test = require('node:test');
const assert = require('node:assert');

const TaskEvents = require('../js/task-events');

function evt(overrides) {
  return Object.assign({
    id: 1,
    taskId: 'task-1234567890',
    fromState: 'queued',
    toState: 'claimed',
    roleId: 'dev',
    sourceRole: 'boss',
    timestamp: '2026-10-25T09:00:00.000Z',
    taskState: 'claimed',
  }, overrides || {});
}

test('applyTaskEvent legt einen Timeline-Eintrag an', () => {
  const state = {};
  TaskEvents.applyTaskEvent(state, evt());
  assert.strictEqual(state.taskTimeline.length, 1);
  assert.match(state.taskTimeline[0].text, /dev hat Task task-123/);
  assert.strictEqual(state.taskNodes.dev.taskState, 'claimed');
});

test('Timeline behaelt nur die letzten 5 Events', () => {
  const state = {};
  for (let i = 1; i <= 8; i += 1) {
    TaskEvents.applyTaskEvent(state, evt({ id: i, toState: 'running' }));
  }
  assert.strictEqual(state.taskTimeline.length, TaskEvents.MAX_TIMELINE);
  assert.strictEqual(state.taskTimeline[0].id, 8);
});

test('Failed-Event markiert den Knoten rot', () => {
  const state = {};
  TaskEvents.applyTaskEvent(state, evt({ toState: 'failed', taskState: 'failed' }));
  assert.strictEqual(TaskEvents.nodeStatus(state, 'dev'), 'failed');
  assert.strictEqual(TaskEvents.nodeClass(state, 'dev'), ' failed');
  assert.strictEqual(TaskEvents.nodeStatus(state, 'unbekannt'), '');
});

test('Done-Event setzt Knoten auf done, Timeline-Text passt', () => {
  const state = {};
  TaskEvents.applyTaskEvent(state, evt({ toState: 'done', taskState: 'done' }));
  assert.strictEqual(TaskEvents.nodeStatus(state, 'dev'), 'done');
  assert.match(state.taskTimeline[0].text, /abgeschlossen/);
});

test('timelineText deckt alle relevanten Zustaende ab', () => {
  assert.match(TaskEvents.timelineText(evt({ toState: 'queued', roleId: null, sourceRole: null })), /system/);
  assert.match(TaskEvents.timelineText(evt({ toState: 'running' })), /fuehrt Task/);
  assert.match(TaskEvents.timelineText(evt({ toState: 'failed' })), /fehlgeschlagen/);
  assert.match(TaskEvents.timelineText(evt({ toState: 'cancelled' })), /abgebrochen/);
  assert.match(TaskEvents.timelineText(evt({ toState: 'escalated' })), /eskaliert/);
  assert.match(TaskEvents.timelineText(evt({ toState: 'waiting_on_child' })), /wartet auf Kind/);
});
