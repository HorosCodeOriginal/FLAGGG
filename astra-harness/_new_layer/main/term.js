// term.js — node-pty-wrappern: spawn(shell, cwd), data in/out, resize, kill, run-oneline.
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { envWorkspace } = require('./files');

let pty = null;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('[term] node-pty nicht ladbar:', e.message);
}

function shellFor() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function spawnTerminal(nr, onData, onExit) {
  const cwd = envWorkspace(nr);
  if (!pty) {
    onData && onData('[node-pty nicht verfügbar – terminal deaktiviert]\r\n');
    return { dead: true, cwd };
  }
  const shell = shellFor();
  const term = pty.spawn(shell, [], { name: 'xterm-color', cols: 100, rows: 30, cwd, env: process.env });
  term.onData(d => onData && onData(d));
  term.onExit(({ exitCode }) => onExit && onExit(exitCode));
  return { term, cwd, shell };
}

// run: einmaliger code in cwd, stdout/stderr getrennt, exit-code.
function runCode(nr, code, runtime) {
  return new Promise(resolve => {
    const cwd = envWorkspace(nr);
    let cmd, args;
    if (runtime === 'node') { cmd = process.execPath; args = ['-e', code]; }
    else if (runtime === 'python') { cmd = 'python'; args = ['-c', code]; }
    else if (runtime === 'shell') {
      if (process.platform === 'win32') { cmd = process.env.ComSpec || 'cmd.exe'; args = ['/d', '/s', '/c', code]; }
      else { cmd = '/bin/sh'; args = ['-c', code]; }
    } else {
      cmd = process.execPath; args = ['-e', code];
    }
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); stderr += '\n[runner timeout nach 60s]'; }, 60000);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timeout); resolve({ stdout, stderr: stderr + '\n' + e.message, code: -1 }); });
    child.on('close', code => { clearTimeout(timeout); resolve({ stdout, stderr, code }); });
  });
}

module.exports = { spawnTerminal, runCode, shellFor };
