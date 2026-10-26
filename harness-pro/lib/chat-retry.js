'use strict';
// chat-retry.js — 429/5xx-Retry fuer Chat-Anfragen.
// Reine Logik ohne Electron: der Aufrufer liefert die Kandidaten und eine
// attempt-Funktion, die pro Kandidat ein Promise zurueckgibt.
//
// Quota-Sonderfall: wenn ALLE Kandidaten mit 429/Quota antworten, hilft ein
// sofortiger Kandidatenwechsel nicht. Mit opts.maxRounds > 1 wartet der Retry
// stattdessen opts.cooldownMs und versucht es erneut (das Kontingent beim
// Anbieter ist zeitgebunden, nicht instanzgebunden).

function statusOf(err) {
  if (!err) return 0;
  return Number(err.status || err.statusCode || err.code) || 0;
}

function isQuotaError(err) {
  if (!err) return false;
  if (statusOf(err) === 429) return true;
  const text = String((err && (err.message || err.body)) || '') + ' ' + String((err && err.code) || '');
  return /429|quota|free\s*usage\s*limit|rate.?limit/i.test(text);
}

function isRetryable(err) {
  if (err && err.retryable === false) return false;
  const status = statusOf(err);
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  // Netzwerkfehler ohne Status
  if (status === 0 && err && /ECONN|ETIMEDOUT|ENOTFOUND|socket hang up|timeout/i.test(String(err.message || ''))) {
    return true;
  }
  return false;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/**
 * sendChatWithRetry({ candidates, attempt, onRoute, maxAttempts, maxRounds, cooldownMs, sleep, onCooldown })
 * - candidates: geordnete Liste (primary zuerst, dann failover nach Prioritaet)
 * - attempt(candidate, index): Promise; rejectt mit err.status bei 429/5xx
 * - maxRounds: wie oft die ganze Kandidatenliste versucht wird (Default 1)
 * - cooldownMs: Wartezeit zwischen den Runden bei Quota-Erschoepfung (Default 20000)
 * - sleep(ms): injizierbar fuer Tests
 * - onCooldown({round, waitMs, error}): Callback fuer UI/Logging
 */
async function sendChatWithRetry(options) {
  const opts = options || {};
  const candidates = Array.isArray(opts.candidates) ? opts.candidates.filter(Boolean) : [];
  const attempt = opts.attempt;
  if (!candidates.length) throw new Error('kein upstream-kandidat verfuegbar');
  if (typeof attempt !== 'function') throw new Error('attempt-funktion fehlt');

  const limit = Math.max(1, Math.min(candidates.length, Number(opts.maxAttempts) || candidates.length));
  const rounds = Math.max(1, Number(opts.maxRounds) || 1);
  const cooldownMs = opts.cooldownMs === undefined ? 20000 : Math.max(0, Number(opts.cooldownMs));
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : wait;
  const history = [];
  let lastError = null;

  for (let round = 1; round <= rounds; round += 1) {
    for (let i = 0; i < limit; i += 1) {
      const candidate = candidates[i];
      if (typeof opts.onRoute === 'function') opts.onRoute(candidate, i);
      try {
        const result = await attempt(candidate, i);
        return { ok: true, candidate, index: i, result, history, rounds: round };
      } catch (err) {
        lastError = err;
        history.push({ round, index: i, nr: candidate && candidate.nr, status: statusOf(err), message: err && err.message });
        if (!isRetryable(err)) break;
      }
    }

    const isQuota = isQuotaError(lastError);
    if (isQuota && round < rounds) {
      if (typeof opts.onCooldown === 'function') {
        opts.onCooldown({ round, waitMs: cooldownMs, error: lastError });
      }
      await sleep(cooldownMs);
      continue;
    }
    break;
  }

  const error = lastError || new Error('alle kandidaten fehlgeschlagen');
  error.history = history;
  throw error;
}

module.exports = { sendChatWithRetry, isRetryable, isQuotaError, statusOf };
