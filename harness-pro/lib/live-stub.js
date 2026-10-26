'use strict';
// live-stub.js — deterministischer Stub-Transport fuer den LIVE-Betrieb der App.
//
// Warum: Der echte Upstream haengt aktuell im 429-Limit (der Gateway antwortet
// dann mit dem lokalen Light-Upstream, der keine Tool-Calls/JSON-Agenten liefert).
// Damit Queue, Orchestration-Canvas, ToolRunner und Self-Healing live bedienbar
// sind (seed-goal -> Boss delegiert -> Sub scheitert -> Fix -> hn_titles.json),
// laeuft der Agent-Graph im Stub-Modus deterministisch.
//
// Echtes LLM: App mit ASTRA_TRANSPORT=real starten.
//
// Der Stub versteht:
//   - Master-Goal "Hacker News Scraper" (schema master_goal / payload.goal):
//     delegiert an scraper-Szenario aus lib/self-heal-script.js
//   - beliebige andere Queue-Tasks: Boss delegiert, Sub schreibt aufgabe.py,
//     fuehrt es aus und meldet stdout zurueck (Demo fuer manuelle Tasks).

const { selfHealTransport, pythonCommand } = require('./self-heal-script');

function isScraperTask(task) {
  const t = task || {};
  if (t.schema_name === 'master_goal') return true;
  const payload = t.payload && typeof t.payload === 'object' ? t.payload : {};
  const goal = typeof t.payload === 'string' ? t.payload : String(payload.goal || '');
  return /hacker\s*news|hn_titles|scraper/i.test(goal + ' ' + String(t.title || ''));
}

function isFailedState(state) {
  return state === 'failed' || state === 'escalated';
}

function genericSubScript(instruction) {
  const safe = String(instruction || 'Demo-Aufgabe').replace(/\r?\n/g, ' ');
  return [
    'import datetime',
    '',
    'INSTRUCTION = ' + JSON.stringify(safe),
    '',
    'def main():',
    '    print("Aufgabe:", INSTRUCTION)',
    '    print("Ausgefuehrt am:", datetime.datetime.now().isoformat(timespec="seconds"))',
    '    print("OK: Agent hat die Aufgabe im Workspace ausgefuehrt.")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n');
}

/**
 * liveStubTransport({ log, roles })
 * roles: Array oder Provider-Funktion -> desk.roles (fuer Boss->Sub-Delegation)
 */
function liveStubTransport(options) {
  const o = options || {};
  const log = typeof o.log === 'function' ? o.log : () => {};
  let scraper = null;

  function roles() {
    const value = typeof o.roles === 'function' ? o.roles() : o.roles;
    return Array.isArray(value) ? value : [];
  }

  function subordinateOf(roleId) {
    const role = roles().find(r => r && r.id === roleId);
    const subs = role && role.relationships && Array.isArray(role.relationships.subordinates)
      ? role.relationships.subordinates
      : [];
    return subs[0] || null;
  }

  function scraperChat(args) {
    if (!scraper) scraper = selfHealTransport({ onEvent: log });
    return scraper(args);
  }

  return async function chat(args) {
    const a = args || {};
    const roleId = a.roleId;
    const task = a.task || {};

    if (isScraperTask(task)) return scraperChat(a);

    // ---- generischer Stub fuer alle anderen Queue-Tasks (manuelle Demo) ----
    const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
    const instruction = String(payload.instruction || payload.goal || task.description || task.title || 'Demo-Aufgabe');
    const children = Array.isArray(task.child_results) ? task.child_results : [];
    const target = subordinateOf(roleId);

    if (target) {
      if (!children.length) {
        log('[stub] Boss ' + roleId + ' delegiert Aufgabe an ' + target);
        return { result: { tool: 'delegate', args: {
          role: target,
          title: 'Aufgabe ausfuehren',
          schema_name: 'stub_task',
          payload: { instruction },
        } } };
      }
      const last = children[children.length - 1];
      if (last && (last.state === 'failed' || last.state === 'escalated')) {
        log('[stub] Boss ' + roleId + ' delegiert Fix-Task');
        return { result: { tool: 'delegate', args: {
          role: target,
          title: 'Aufgabe reparieren',
          schema_name: 'stub_task',
          payload: { instruction, fix: true },
        } } };
      }
      log('[stub] Boss ' + roleId + ' schliesst Task ab');
      return { result: { ok: true, message: 'Aufgabe ausgefuehrt', children: children.map(c => ({ id: c.id, state: c.state })) } };
    }

    // Sub (oder Einzelrolle): Datei schreiben, ausfuehren, Ergebnis melden
    const py = pythonCommand();
    if (!py) return { result: { ok: false, error: 'kein Python gefunden (py/python/python3)' } };
    const prev = task.previous_answer;
    const prevCall = prev && typeof prev === 'object'
      ? (typeof prev.tool === 'string' ? prev : (prev.result && typeof prev.result.tool === 'string' ? prev.result : null))
      : null;
    if (!task.tool_result) {
      log('[stub] Sub ' + roleId + ' schreibt aufgabe.py');
      return { result: { tool: 'write_file', args: { path: 'aufgabe.py', content: genericSubScript(instruction) } } };
    }
    if (prevCall && prevCall.tool === 'write_file') {
      log('[stub] Sub ' + roleId + ' fuehrt aufgabe.py aus');
      return { result: { tool: 'execute_shell', args: { command: py + ' aufgabe.py', timeout_ms: 60000 } } };
    }
    if (!task.tool_result.ok) {
      return { result: { ok: false, error: String(task.tool_result.stderr || task.tool_result.error || 'Ausfuehrung fehlgeschlagen') } };
    }
    const stdout = String((task.tool_result.output && task.tool_result.output.stdout) || '').trim();
    log('[stub] Sub ' + roleId + ' fertig');
    return { result: { ok: true, file: 'aufgabe.py', output: stdout } };
  };
}

module.exports = { liveStubTransport, isScraperTask };
