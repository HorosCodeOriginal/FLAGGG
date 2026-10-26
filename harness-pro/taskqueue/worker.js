'use strict';
// worker.js — eigener Node-Prozess fuer die SQLite-Task-Queue.
// Grund: better-sqlite3 (nativ) crasht im Electron-33-Renderer/Main-Prozess,
// laeuft unter normalem Node aber stabil. Protokoll: JSON-Zeilen ueber stdio.
//
// Aufruf: node taskqueue/worker.js <db-file>

const readline = require('readline');
const { TaskQueue } = require('./taskqueue');
const { createPolicy } = require('./policy');
const { synthesize } = require('./synthesizer');

const dbFile = process.argv[2];
if (!dbFile) {
  process.stderr.write('db-file fehlt\n');
  process.exit(2);
}

let queue;
try {
  queue = new TaskQueue(dbFile);
  // Timeout-Watchdog: haengende Tasks alle 10s auf failed setzen
  queue.startWatchdog(10000);
} catch (err) {
  process.stderr.write('db open fehlgeschlagen: ' + err.message + '\n');
  process.exit(3);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

// serialize async synthesize so parallel synth RPCs cannot double-report
let synthChain = Promise.resolve();

function reply(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function handle(msg) {
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};
  if (method === 'synthesize') {
    synthChain = synthChain
      .then(() => synthesize(queue, params.parentRoleId, { requestId: params.requestId }))
      .then(report => reply({ id, ok: true, result: { report } }))
      .catch(err => reply({ id, ok: false, error: { message: err.message, code: err.code || 'SYNTH_FAILED' } }));
    synthChain = synthChain.catch(() => {});
    return;
  }
  try {
    let result;
    switch (method) {
      case 'enqueue':
        result = queue.enqueue(params.task);
        break;
      case 'claim':
        result = { task: queue.claimNextTask(params.roleId) };
        break;
      case 'updateState':
        result = { task: queue.updateState(params.taskId, params.state, params) };
        break;
      case 'get':
        result = { task: queue.getTask(params.taskId) };
        break;
      case 'list':
        result = { tasks: queue.listTasks(params.filter) };
        break;
      case 'checkChildren':
        result = { parent: queue.checkChildrenStatus(params.parentId) };
        break;
      case 'children':
        result = { children: queue.listChildren(params.parentId) };
        break;
      case 'events':
        result = { events: queue.events(params.taskId) };
        break;
      case 'eventsSince':
        result = { events: queue.eventsSince(params.afterId, params.limit) };
        break;
      case 'stats':
        result = { counts: queue.countByState() };
        break;
      case 'setPolicy':
        queue.policy = createPolicy(Array.isArray(params.roles) ? params.roles : []);
        result = { roles: (Array.isArray(params.roles) ? params.roles.length : 0) };
        break;
      case 'ping':
        result = { pong: true };
        break;
      case 'close':
        reply({ id, ok: true, result: {} });
        queue.close();
        process.exit(0);
        return;
      default:
        reply({ id, ok: false, error: { message: 'unbekannte methode: ' + method, code: 'RPC_UNKNOWN' } });
        return;
    }
    reply({ id, ok: true, result });
  } catch (err) {
    reply({ id, ok: false, error: { message: err.message, code: err.code || 'TASK_ERROR' } });
  }
}

rl.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (err) {
    process.stderr.write('ungueltiges JSON: ' + line.slice(0, 120) + '\n');
    return;
  }
  handle(msg);
});

rl.on('close', () => {
  try { queue.close(); } catch (e) { /* egal */ }
  process.exit(0);
});
