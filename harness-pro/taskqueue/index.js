'use strict';
// index.js — oeffentliche API der Task-Queue.

const path = require('path');
const os = require('os');

const { TaskQueue, TaskValidationError, TaskAuthorizationError } = require('./taskqueue');
const { AgentRuntime } = require('./runtime');
const { Orchestrator, createRole, maskKey, roleIdFromName } = require('./orchestrator');
const { createPolicy, SYSTEM_ROLE } = require('./policy');
const fsm = require('./fsm');
const migrate = require('./desk-migrate');

function defaultDbPath(userDataDir) {
  return path.join(userDataDir || os.tmpdir(), 'astra-tasks.sqlite');
}

function openQueue(dbFile, options) {
  return new TaskQueue(dbFile || defaultDbPath(), options);
}

module.exports = Object.assign(
  { TaskQueue, TaskValidationError, TaskAuthorizationError, AgentRuntime, Orchestrator, createRole, createPolicy, SYSTEM_ROLE, maskKey, roleIdFromName, openQueue, defaultDbPath },
  fsm,
  migrate
);
