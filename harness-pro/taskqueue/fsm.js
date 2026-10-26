'use strict';
// fsm.js — Zustandsmaschine des Task-Lifecycles.
// Reine Regeltabelle ohne Datenbank: die TaskQueue prueft damit jeden Uebergang.

const STATES = [
  'queued',
  'claimed',
  'running',
  'waiting_on_child',
  'done',
  'failed',
  'cancelled',
  'escalated',
];

// erlaubte Uebergaenge laut Spezifikation
// queued->cancelled: Abbrechen vor dem Claim
// waiting_on_child->failed/cancelled: der Watchdog muss haengende Eltern-Tasks beenden koennen
const TRANSITIONS = {
  queued: ['claimed', 'cancelled'],
  // claimed->failed: Berechtigungspruefung kann einen Task nach dem Claim ablehnen
  claimed: ['running', 'failed', 'cancelled'],
  running: ['done', 'failed', 'waiting_on_child', 'cancelled'],
  // waiting_on_child->queued: nach dem letzten Kind wird der Eltern-Task wieder
  // claimbar, damit die Runtime den Parent mit den Kind-Ergebnissen fortsetzt
  waiting_on_child: ['queued', 'running', 'failed', 'cancelled'],
  failed: ['queued', 'escalated'],
  escalated: ['queued', 'cancelled'],
  done: [],
  cancelled: [],
};

class FsmError extends Error {
  constructor(from, to, detail) {
    super('FSM: Uebergang ' + from + ' -> ' + to + ' ist nicht erlaubt' + (detail ? ' (' + detail + ')' : ''));
    this.name = 'FsmError';
    this.code = 'FSM_INVALID_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

function isState(value) {
  return STATES.indexOf(value) !== -1;
}

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.indexOf(to) !== -1;
}

function assertTransition(from, to) {
  if (!isState(from)) throw new FsmError(from, to, 'unbekannter Ausgangszustand');
  if (!isState(to)) throw new FsmError(from, to, 'unbekannter Zielzustand');
  if (!canTransition(from, to)) throw new FsmError(from, to);
  return true;
}

// Endzustaende: keine automatische Weiterverarbeitung
function isTerminal(state) {
  return state === 'done' || state === 'cancelled';
}

module.exports = { STATES, TRANSITIONS, FsmError, isState, canTransition, assertTransition, isTerminal };
