'use strict';
// team-5-scenario.js — deterministischer Transport fuer 5-Agenten Todo-App E2E.
// Simuliert Boss + 4 Spezialisten ohne Live-LLM (429-sicher wie self-heal-script).

const { execFileSync } = require('child_process');
const { buildUserContent } = require('./role-chat');

const APP_PY_BUG = [
  'from flask import Flask, jsonify',
  '',
  'app = Flask(__name__)',
  'todos = []',
  '',
  '@app.route("/todos", methods=["GET"])',
  'def list_todos_wrong():',
  '    return jsonify(todos)',
  '',
  'if __name__ == "__main__":',
  '    app.run(host="127.0.0.1", port=5000)',
  '',
].join('\n');

const APP_PY_FIXED = [
  'from flask import Flask, jsonify',
  '',
  'app = Flask(__name__)',
  'todos = []',
  '',
  '@app.route("/api/todos", methods=["GET"])',
  'def list_todos():',
  '    return jsonify(todos)',
  '',
  'if __name__ == "__main__":',
  '    app.run(host="127.0.0.1", port=5000)',
  '',
].join('\n');

const INDEX_HTML = [
  '<!DOCTYPE html>',
  '<html lang="de">',
  '<head><meta charset="utf-8"><title>Todos</title></head>',
  '<body>',
  '  <h1>Todo-Liste</h1>',
  '  <ul id="list"></ul>',
  '  <script>',
  '    fetch("/api/todos").then(r => r.json()).then(items => {',
  '      document.getElementById("list").innerHTML = items.map(t => "<li>" + t + "</li>").join("");',
  '    });',
  '  </script>',
  '</body>',
  '</html>',
  '',
].join('\n');

const TEST_APP_PY = [
  'import sys',
  'import os',
  'sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))',
  '',
  'import app as todo_app',
  '',
  '',
  'def test_list_todos_route():',
  '    client = todo_app.app.test_client()',
  '    resp = client.get("/api/todos")',
  '    assert resp.status_code == 200',
  '    assert resp.is_json',
  '',
].join('\n');

const README_MD = [
  '# Todo-App (Team Repo)',
  '',
  '## Setup',
  '',
  '```bash',
  'py -3 -m pip install flask pytest',
  'py -3 -m pytest test_app.py',
  'py -3 app.py',
  '```',
  '',
  'Frontend: `index.html` im Browser (API unter `/api/todos`).',
  '',
].join('\n');

let pythonBin = null;
let pythonChecked = false;

function pythonCommand() {
  if (pythonChecked) return pythonBin;
  pythonChecked = true;
  for (const candidate of ['py', 'python', 'python3']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000 });
      pythonBin = candidate === 'py' ? 'py -3' : candidate;
      break;
    } catch (_) { /* next */ }
  }
  return pythonBin;
}

function isFailed(state) {
  return state === 'failed' || state === 'escalated';
}

function callOf(answer) {
  if (!answer || typeof answer !== 'object') return null;
  if (typeof answer.tool === 'string') return answer;
  if (answer.result && typeof answer.result === 'object' && typeof answer.result.tool === 'string') {
    return answer.result;
  }
  return null;
}

function childByTitle(children, title) {
  return (children || []).find(c => String(c.title || '') === title);
}

function team5Transport(options) {
  const o = options || {};
  const log = typeof o.onEvent === 'function' ? o.onEvent : () => {};
  const py = pythonCommand();
  if (!py) throw new Error('team-5-scenario: kein Python (py/python/python3)');

  const pipDeps = py + ' -m pip install --quiet --target vendor flask pytest';
  const pytestCmd = process.platform === 'win32'
    ? 'set PYTHONPATH=vendor&& ' + py + ' -m pytest -q test_app.py'
    : 'PYTHONPATH=vendor ' + py + ' -m pytest -q test_app.py';

  function tool(toolName, args) {
    return { result: { tool: toolName, args } };
  }
  function final(payload) {
    return { result: payload };
  }

  return async function chat(args) {
    const role = args && args.roleId;
    const task = (args && args.task) || {};
    const title = String(task.title || '');
    const children = Array.isArray(task.child_results) ? task.child_results : [];
    const prevCall = callOf(task.previous_answer);

    if (role === 'boss_architect') {
      const backend = childByTitle(children, 'Backend REST API');
      const frontend = childByTitle(children, 'Frontend UI');
      const qa = childByTitle(children, 'QA Pytest');
      const qaRetry = childByTitle(children, 'QA Pytest erneut');
      const doc = childByTitle(children, 'Dokumentation README');
      const fix = childByTitle(children, 'Backend-Fix QA');

      if (!backend) {
        log('[team-5] Boss delegiert Backend an dev_backend');
        return tool('delegate', {
          role: 'dev_backend',
          title: 'Backend REST API',
          schema_name: 'team_todo',
          payload: { phase: 'backend' },
        });
      }
      if (backend.state !== 'done') {
        return final({ ok: false, error: 'Backend noch nicht fertig: ' + backend.state });
      }
      if (!frontend) {
        log('[team-5] Boss delegiert Frontend an dev_frontend');
        return tool('delegate', {
          role: 'dev_frontend',
          title: 'Frontend UI',
          schema_name: 'team_todo',
          payload: { phase: 'frontend' },
        });
      }
      if (frontend.state !== 'done') {
        return final({ ok: false, error: 'Frontend noch nicht fertig' });
      }
      if (!qa) {
        log('[team-5] Boss delegiert QA an qa_tester');
        return tool('delegate', {
          role: 'qa_tester',
          title: 'QA Pytest',
          schema_name: 'team_todo',
          payload: { phase: 'qa' },
        });
      }
      if (isFailed(qa.state) && !fix) {
        const prompt = buildUserContent({ roleId: role, task });
        if (!/Delegiere einen Fix-Task/.test(prompt)) {
          throw new Error('Boss-Prompt ohne Fix-Task-Anweisung nach QA-Fail');
        }
        log('[team-5] Boss delegiert Backend-Fix nach QA-Fail');
        return tool('delegate', {
          role: 'dev_backend',
          title: 'Backend-Fix QA',
          schema_name: 'team_todo',
          payload: { phase: 'backend_fix' },
        });
      }
      if (fix && isFailed(fix.state)) {
        return final({ ok: false, error: 'Backend-Fix fehlgeschlagen' });
      }
      if (fix && fix.state === 'done' && !qaRetry) {
        log('[team-5] Boss delegiert QA-Retry');
        return tool('delegate', {
          role: 'qa_tester',
          title: 'QA Pytest erneut',
          schema_name: 'team_todo',
          payload: { phase: 'qa_retry' },
        });
      }
      const qaOk = (qa.state === 'done') || (qaRetry && qaRetry.state === 'done');
      if (!qaOk && !isFailed(qa.state)) {
        return final({ ok: false, error: 'QA laeuft noch' });
      }
      if (!qaOk) {
        return final({ ok: false, error: 'QA nicht gruen' });
      }
      if (!doc) {
        log('[team-5] Boss delegiert Docs an doc_writer');
        return tool('delegate', {
          role: 'doc_writer',
          title: 'Dokumentation README',
          schema_name: 'team_todo',
          payload: { phase: 'doc' },
        });
      }
      if (doc.state !== 'done') {
        return final({ ok: false, error: 'Doku noch nicht fertig' });
      }
      log('[team-5] Boss: alle Spezialisten done -> Master done');
      return final({
        ok: true,
        message: 'Todo-App Team-Goal erreicht',
        artifacts: ['app.py', 'index.html', 'test_app.py', 'README.md'],
      });
    }

    if (role === 'dev_backend') {
      const content = /Fix/i.test(title) ? APP_PY_FIXED : APP_PY_BUG;
      if (!task.tool_result) {
        log('[team-5] dev_backend: schreibt app.py' + (/Fix/i.test(title) ? ' (Fix)' : ' (Bug-Route)'));
        return tool('write_file', { path: 'app.py', content });
      }
      if (prevCall && prevCall.tool === 'write_file') {
        return final({ ok: true, file: 'app.py' });
      }
      return final({ ok: true, file: 'app.py' });
    }

    if (role === 'dev_frontend') {
      if (!task.tool_result) {
        log('[team-5] dev_frontend: index.html');
        return tool('write_file', { path: 'index.html', content: INDEX_HTML });
      }
      return final({ ok: true, file: 'index.html' });
    }

    if (role === 'qa_tester') {
      if (/erneut/i.test(title)) {
        if (!task.tool_result) {
          log('[team-5] qa_tester: pytest Retry');
          return tool('execute_shell', { command: pytestCmd, timeout_ms: 120000 });
        }
        if (!task.tool_result.ok) {
          return final({ ok: false, error: String(task.tool_result.stderr || task.tool_result.error) });
        }
        return final({ ok: true, tests: 'pytest green' });
      }
      if (!task.tool_result) {
        log('[team-5] qa_tester: test_app.py');
        return tool('write_file', { path: 'test_app.py', content: TEST_APP_PY });
      }
      if (prevCall && prevCall.tool === 'write_file') {
        log('[team-5] qa_tester: pip install flask+pytest');
        return tool('execute_shell', { command: pipDeps, timeout_ms: 240000 });
      }
      if (prevCall && prevCall.args && /pip/i.test(String(prevCall.args.command || ''))) {
        if (!task.tool_result.ok) {
          return final({ ok: false, error: String(task.tool_result.stderr || 'pip failed') });
        }
        log('[team-5] qa_tester: pytest (erwartet Fail wegen Bug-Route)');
        return tool('execute_shell', { command: pytestCmd, timeout_ms: 120000 });
      }
      if (!task.tool_result.ok) {
        const stderr = String(task.tool_result.stderr || task.tool_result.error || 'pytest failed');
        log('[team-5] qa_tester: pytest rot -> meldet an Boss');
        return final({ ok: false, error: stderr });
      }
      return final({ ok: true, tests: 'pytest' });
    }

    if (role === 'doc_writer') {
      if (!task.tool_result) {
        log('[team-5] doc_writer: README.md');
        return tool('write_file', { path: 'README.md', content: README_MD });
      }
      return final({ ok: true, file: 'README.md' });
    }

    return final({ ok: true, note: 'kein Szenario fuer ' + role });
  };
}

module.exports = {
  team5Transport,
  APP_PY_BUG,
  APP_PY_FIXED,
  INDEX_HTML,
  TEST_APP_PY,
  README_MD,
  pythonCommand,
};
