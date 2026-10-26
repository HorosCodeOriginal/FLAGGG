'use strict';
// scripted-chat.js — deterministischer Transport fuer den Live-Test.
// Der echte Upstream liefert aktuell 429 (FreeUsageLimitError); damit die Kette
// Boss -> delegate -> Sub -> ToolRunner -> child_result -> Boss trotzdem
// vollstaendig gegen die echte Queue/Runtime laeuft, antwortet dieser Transport
// wie ein Agent es taete. Mit LIVE_TEST_TRANSPORT=real wird er nicht benutzt.

const { execFileSync } = require('child_process');

let pythonBin = null;
let pythonChecked = false;

function python() {
  if (pythonChecked) return pythonBin;
  pythonChecked = true;
  for (const candidate of ['python', 'python3', 'py']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000 });
      pythonBin = candidate;
      break;
    } catch (e) { /* naechster Kandidat */ }
  }
  return pythonBin;
}

function shellRunScriptCommand() {
  const bin = python();
  if (bin) return bin + ' hallo.py';
  return process.platform === 'win32' ? 'type hallo.py' : 'cat hallo.py';
}

function scriptedTransport() {
  return async function chat(args) {
    const a = args || {};
    const role = a.roleId;
    const task = a.task || {};

    if (role === 'boss_astra') {
      // Runde 2: Kind ist fertig -> Boss schliesst ab
      if (Array.isArray(task.child_results) && task.child_results.length) {
        const child = task.child_results[0];
        return {
          result: {
            final: 'Delegiert und abgeschlossen',
            child_state: child.state,
            child_result: child.result,
          },
          usage: { total_tokens: 42 },
        };
      }
      // Runde 1: Aufgabe ist trivial -> an Sub delegieren
      return {
        result: {
          tool: 'delegate',
          args: {
            role: 'sub_opus',
            title: 'Python-Hallo (delegiert)',
            schema_name: 'live_test',
            payload: { instruction: 'Schreibe hallo.py und fuehre es aus.' },
          },
        },
        usage: { total_tokens: 21 },
      };
    }

    if (role === 'sub_opus') {
      // Runde 1: Datei schreiben
      if (!task.tool_result) {
        return {
          result: { tool: 'write_file', args: { path: 'hallo.py', content: 'print("Hallo")\n' } },
          usage: { total_tokens: 11 },
        };
      }
      // Runde 2: Skript ausfuehren
      if (task.tool_result.tool === 'write_file') {
        return {
          result: { tool: 'execute_shell', args: { command: shellRunScriptCommand() } },
          usage: { total_tokens: 9 },
        };
      }
      // Runde 3: Ergebnis an den Boss zurueck
      const output = task.tool_result.output || {};
      return {
        result: {
          ok: true,
          script: 'hallo.py',
          output: String(output.stdout || '').trim(),
          exitCode: output.exitCode,
        },
        usage: { total_tokens: 33 },
      };
    }

    return { result: { ok: true, note: 'kein Skript fuer Rolle ' + role } };
  };
}

module.exports = { scriptedTransport };
