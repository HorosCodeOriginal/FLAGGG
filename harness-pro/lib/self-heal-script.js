'use strict';
// self-heal-script.js — deterministischer Transport fuer den Self-Healing-E2E.
//
// Die echten LLM-Upstreams liefern aktuell 429 (FreeUsageLimitError). Damit die
// Kette Master-Goal -> Boss delegiert -> Sub scheitert (fehlendes Modul) ->
// Runtime loggt stderr -> Boss delegiert Fix-Task -> Sub installiert Paket und
// scrapt HN -> hn_titles.json trotzdem vollstaendig gegen die ECHTE Queue,
// Runtime, ToolRunner und den ECHTEN Self-Healing-Kontext laeuft, antwortet
// dieser Transport deterministisch wie ein Agent es taete.
//
// Bewusst KEIN Fake der Runtime: der Transport bekommt genau die Task-Kontexte
// (child_results, error_history, self_heal) und prueft, dass die
// Prompt-Injection im Boss-Prompt tatsaechlich ankommt.

const { execFileSync } = require('child_process');
const { buildUserContent } = require('./role-chat');

const SCRAPER_PY = [
  'import json',
  'import os',
  'import sys',
  '',
  '# Self-Healing: nachgeladene Pakete liegen im vendor-Ordner des Workspace',
  "sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor'))",
  '',
  'import requests',
  'from bs4 import BeautifulSoup',
  '',
  'HN_URL = "https://news.ycombinator.com"',
  '',
  'def scrape_titles(url=HN_URL):',
  '    response = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})',
  '    response.raise_for_status()',
  '    soup = BeautifulSoup(response.text, "html.parser")',
  '    titles = [a.get_text(strip=True) for a in soup.select(".titleline > a")]',
  '    titles = [t for t in titles if t]',
  '    if not titles:',
  '        titles = [a.get_text(strip=True) for a in soup.select("a.storylink")]',
  '    with open("hn_titles.json", "w", encoding="utf-8") as fh:',
  '        json.dump(titles, fh, ensure_ascii=False, indent=2)',
  '    print("hn_titles.json geschrieben:", len(titles), "titel")',
  '    return titles',
  '',
  'if __name__ == "__main__":',
  '    scrape_titles()',
  '',
].join('\n');

let pythonBin = null;
let pythonChecked = false;

// Windows hat oft keinen "python"-Shim, aber den "py"-Launcher.
function pythonCommand() {
  if (pythonChecked) return pythonBin;
  pythonChecked = true;
  for (const candidate of ['py', 'python', 'python3']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000 });
      pythonBin = candidate === 'py' ? 'py -3' : candidate;
      break;
    } catch (e) { /* naechster Kandidat */ }
  }
  return pythonBin;
}

function isFailed(state) {
  return state === 'failed' || state === 'escalated';
}

// Die Runtime bekommt vom Orchestrator bereits das entpackte Tool-Call-Objekt
// ({tool,args}), waehrend der Transport selbst {result:{tool,args}} liefert.
// Beide Formen akzeptieren.
function callOf(answer) {
  if (!answer || typeof answer !== 'object') return null;
  if (typeof answer.tool === 'string') return answer;
  if (answer.result && typeof answer.result === 'object' && typeof answer.result.tool === 'string') {
    return answer.result;
  }
  return null;
}

/**
 * selfHealTransport({ onEvent })
 * Simuliert Boss Astra (delegiert, analysiert stderr, delegiert Fix-Task) und
 * Sub Opus (schreibt scraper.py, scheitert am fehlenden Modul, installiert
 * per pip nach, scrapt HN und schreibt hn_titles.json).
 */
function selfHealTransport(options) {
  const o = options || {};
  const log = typeof o.onEvent === 'function' ? o.onEvent : () => {};
  const py = pythonCommand();
  if (!py) throw new Error('self-heal-scenario: kein Python gefunden (py/python/python3)');
  const pipCommand = py + ' -m pip install --target vendor requests beautifulsoup4';
  const runCommand = py + ' scraper.py';

  function tool(toolName, args) {
    return { result: { tool: toolName, args } };
  }
  function final(payload) {
    return { result: payload };
  }

  return async function chat(args) {
    const a = args || {};
    const role = a.roleId;
    const task = a.task || {};

    // ------------------------------------------------------------------ Boss
    if (role === 'boss_astra') {
      const children = Array.isArray(task.child_results) ? task.child_results : [];
      if (!children.length) {
        log('[scenario] Boss: delegiert "Scraper schreiben" an sub_opus');
        return tool('delegate', {
          role: 'sub_opus',
          title: 'Scraper schreiben',
          schema_name: 'master_goal',
          payload: { task: 'write_scraper' },
        });
      }

      const failed = children.filter(c => isFailed(c.state));
      const last = children[children.length - 1];
      if (failed.length && last && isFailed(last.state)) {
        // Prompt-Injection beweisen: der echte Boss-Prompt muss den stderr und
        // die Fix-Task-Anweisung enthalten.
        const prompt = buildUserContent({ roleId: role, task });
        const stderr = (task.self_heal && task.self_heal.stderr) || '';
        if (!/Ein vorheriger Task ist fehlgeschlagen/.test(prompt) ||
            !/Delegiere einen Fix-Task/.test(prompt) || (stderr && prompt.indexOf(stderr) < 0)) {
          throw new Error('Self-Healing-Prompt-Injection fehlt im Boss-Prompt');
        }
        log('[scenario] Boss: liest stderr (' + (failed[0].error_history || []).length +
          ' error-history-eintraege) und delegiert Fix-Task "pip install"');
        return tool('delegate', {
          role: 'sub_opus',
          title: 'Scraper reparieren',
          schema_name: 'master_goal',
          payload: {
            task: 'fix_scraper',
            fix: 'Fehlendes Python-Modul per pip installieren und scraper.py erneut ausfuehren',
            stderr: (task.self_heal && task.self_heal.stderr) || '',
          },
        });
      }

      log('[scenario] Boss: alle Kinder erfolgreich -> Master-Task done');
      return final({
        ok: true,
        message: 'Master-Goal erreicht: scraper.py laeuft, hn_titles.json geschrieben',
        children: children.map(c => ({ id: c.id, title: c.title, state: c.state })),
      });
    }

    // ------------------------------------------------------------------- Sub
    if (role === 'sub_opus') {
      const title = String(task.title || '');
      const prev = task.previous_answer;
      const prevCall = callOf(prev);
      const prevCommand = prevCall && prevCall.args ? String(prevCall.args.command || '') : '';

      if (/reparieren/i.test(title)) {
        // Fix-Task: 1) pip install --target vendor, 2) scraper.py erneut ausfuehren
        if (!task.tool_result) {
          log('[scenario] Sub: Fix startet -> ' + pipCommand);
          return tool('execute_shell', { command: pipCommand, timeout_ms: 240000 });
        }
        if (!prevCommand) return tool('execute_shell', { command: pipCommand, timeout_ms: 240000 });
        if (/pip/i.test(prevCommand)) {
          if (!task.tool_result.ok) {
            log('[scenario] Sub: pip install fehlgeschlagen -> Agent meldet Fehlschlag');
            return final({ ok: false, error: String(task.tool_result.stderr || task.tool_result.error || 'pip install fehlgeschlagen') });
          }
          log('[scenario] Sub: Pakete installiert -> scraper.py erneut ausfuehren');
          return tool('execute_shell', { command: runCommand, timeout_ms: 120000 });
        }
        // letzter Schritt: scraper.py erneut ausfuehren
        if (!task.tool_result.ok) {
          return final({ ok: false, error: String(task.tool_result.stderr || task.tool_result.error || 'scraper fehlgeschlagen') });
        }
        const stdout = String((task.tool_result.output && task.tool_result.output.stdout) || '').trim();
        log('[scenario] Sub: scraper.py erfolgreich -> ' + (stdout || '(kein stdout)'));
        return final({ ok: true, file: 'hn_titles.json', output: stdout });
      }

      // Haupt-Task: scraper.py schreiben und ausfuehren
      if (!task.tool_result) {
        log('[scenario] Sub: schreibt scraper.py (requests + bs4)');
        return tool('write_file', { path: 'scraper.py', content: SCRAPER_PY });
      }
      if (prevCall && prevCall.tool === 'write_file') {
        log('[scenario] Sub: fuehrt scraper.py aus -> erwartet ModuleNotFoundError');
        return tool('execute_shell', { command: runCommand, timeout_ms: 120000 });
      }
      // Ausfuehrung ist gescheitert -> expliziter Fehlschlag mit stderr an den Boss
      const stderr = String(task.tool_result.stderr || task.tool_result.error || 'scraper.py fehlgeschlagen');
      log('[scenario] Sub: scraper.py gescheitert -> meldet Fehlschlag an Runtime');
      return final({ ok: false, error: stderr });
    }

    return final({ ok: true, note: 'kein Skript fuer Rolle ' + role });
  };
}

module.exports = { selfHealTransport, pythonCommand, SCRAPER_PY };
