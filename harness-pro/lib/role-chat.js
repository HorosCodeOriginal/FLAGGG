'use strict';
// role-chat.js — Chat-Bruecke Orchestrator -> fr-gateway-Container (ein Port je Rolle).
// non-streaming, damit die Runtime ein validierbares result bekommt.

const http = require('http');
const { sendChatWithRetry } = require('./chat-retry');

// Fast-Fail: echte LLM-Calls duerfen bis zu 60s brauchen, aber nicht ewig haengen.
const DEFAULT_TIMEOUT_MS = 60000;

const TOOL_HINT = 'Antworte entweder mit dem finalen JSON oder, wenn du ein Tool brauchst, NUR mit ' +
  '{"tool":"read_file|write_file|execute_shell|web_search|web_fetch|download_file|install_skill|list_skills|uninstall_skill|delegate","args":{...}}. ' +
  'Paketmanager (pip install, npm install, ...) sind ueber execute_shell erlaubt. Neue Faehigkeiten ' +
  'als Skill-Bundle per install_skill({url, sha256?}) laden (ohne Shell). Wenn die Aufgabe endgueltig ' +
  'fehlschlaegt, antworte mit {"ok":false,"error":"<stderr>"}.';

function requestOnce(opts) {
  const o = opts || {};
  const timeoutMs = Number(o.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(o.body || {});
    const req = http.request({
      host: '127.0.0.1',
      port: o.port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (o.key || ''),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const err = new Error('gateway http ' + res.statusCode);
          err.status = res.statusCode;
          err.body = raw.slice(0, 300);
          return reject(err);
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('antwort nicht lesbar: ' + e.message));
        }
      });
    });
    req.on('timeout', () => {
      const err = new Error('TIMEOUT: Agent antwortet nicht innerhalb von ' + timeoutMs + 'ms');
      err.code = 'TIMEOUT';
      req.destroy(err);
    });
    req.on('error', err => reject(err));
    req.write(body);
    req.end();
  });
}

function parseContent(choice) {
  const content = choice && choice.choices && choice.choices[0] &&
    choice.choices[0].message && choice.choices[0].message.content;
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return { text: trimmed };
  }
}

// Kind-Fehler aus child_results ziehen (Fallback, falls die Runtime keinen
// fertigen self_heal-Kontext mitgeschickt hat). Nur ungeloeste Fehler: ist das
// neueste Kind done, wurde der Fehler bereits durch einen Fix-Task behoben.
function stderrOfChild(child) {
  const c = child || {};
  const history = Array.isArray(c.error_history) ? c.error_history : [];
  const withStderr = history.find(e => e && e.stderr);
  if (withStderr) return String(withStderr.stderr);
  const withError = history.find(e => e && e.error);
  if (withError) return String(withError.error);
  if (c.stderr) return String(c.stderr);
  if (c.result && typeof c.result === 'object') {
    return String(c.result.stderr || c.result.error || 'unbekannter Fehler');
  }
  return 'unbekannter Fehler';
}

function failedChildStderr(task) {
  const children = (task && Array.isArray(task.child_results) ? task.child_results : []).filter(Boolean);
  if (!children.length) return null;
  const last = children[children.length - 1];
  if (!last || (last.state !== 'failed' && last.state !== 'escalated')) return null;
  return stderrOfChild(last);
}

// Prompt-Injection fuer den Self-Healing-Loop: der Boss wird gezwungen, den
// stderr zu analysieren und einen Fix-Task zu delegieren.
function selfHealInstruction(task) {
  if (task && task.self_heal && task.self_heal.instruction) return String(task.self_heal.instruction);
  const stderr = failedChildStderr(task);
  if (!stderr) return null;
  return 'Ein vorheriger Task ist fehlgeschlagen. Hier ist der stderr: ' + stderr +
    '. Delegiere einen Fix-Task an den Agenten, um das Problem zu beheben.';
}

// Baut den User-Prompt inkl. Tool-Ergebnis, Kind-Ergebnissen und Self-Healing-Injection.
function buildUserContent(args) {
  const a = args || {};
  const task = a.task || {};
  const payload = task.payload !== undefined ? task.payload : null;
  const prompt = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const toolResult = task.tool_result ? JSON.stringify(task.tool_result, null, 2) : null;
  const childResults = Array.isArray(task.child_results) && task.child_results.length
    ? JSON.stringify(task.child_results, null, 2)
    : null;
  const selfHeal = selfHealInstruction(task);
  return 'Task: ' + (task.title || '') + '\n\nPayload:\n' + prompt +
    (toolResult ? '\n\nLetztes Tool-Ergebnis:\n' + toolResult : '') +
    (childResults ? '\n\nKind-Ergebnisse:\n' + childResults : '') +
    (selfHeal ? '\n\nWICHTIG (Self-Healing):\n' + selfHeal : '') +
    '\n\n' + TOOL_HINT;
}

function buildMessages(args) {
  const a = args || {};
  return [
    { role: 'system', content: 'Du bist Agent "' + (a.roleId || 'role') + '" in einer Task-Queue. Antworte ausschliesslich mit einem JSON-Objekt, das die Aufgabe erfuellt.' },
    { role: 'user', content: buildUserContent(a) },
  ];
}

/**
 * createRoleChat({ maxTokens, timeoutMs, logger })
 * -> chat({ entry, model, task, roleId, candidates })
 *    entry: { port, unique_key }
 */
function createRoleChat(options) {
  const o = options || {};
  const maxTokens = Number(o.maxTokens) || 1024;
  const timeoutMs = Number(o.timeoutMs) || DEFAULT_TIMEOUT_MS;

  return async function chat(args) {
    const a = args || {};
    const entry = a.entry;
    if (!entry || !entry.port) throw new Error('role-chat: kein port fuer die rolle');

    const body = {
      model: a.model || 'gpt-6-astra',
      messages: buildMessages({ roleId: a.roleId, task: a.task }),
      stream: false,
      max_tokens: maxTokens,
    };

    const candidates = Array.isArray(a.candidates) && a.candidates.length
      ? a.candidates
      : [{ port: entry.port, key: entry.unique_key, nr: entry.nr }];

    const outcome = await sendChatWithRetry({
      candidates,
      maxAttempts: 1,
      attempt: candidate => requestOnce({
        port: candidate.port,
        key: candidate.key || candidate.unique_key,
        body,
        timeoutMs,
      }),
    });

    const answer = outcome.result || {};
    const parsed = parseContent(answer);
    return {
      result: parsed,
      usage: answer.usage || null,
      model: answer.model || body.model,
      port: outcome.candidate.port,
      attempts: outcome.history.length + 1,
    };
  };
}

module.exports = {
  createRoleChat,
  requestOnce,
  parseContent,
  buildUserContent,
  buildMessages,
  selfHealInstruction,
  failedChildStderr,
  stderrOfChild,
  DEFAULT_TIMEOUT_MS,
  TOOL_HINT,
};
