'use strict';
// Tests fuer den Quota-Cooldown im Chat-Retry.

const test = require('node:test');
const assert = require('node:assert');

const { sendChatWithRetry, isQuotaError } = require('../lib/chat-retry');

function quotaError() {
  return Object.assign(new Error('gateway http 429'), { status: 429 });
}

test('alle Kandidaten 429 -> Cooldown, zweite Runde erfolgreich', async () => {
  const waits = [];
  let calls = 0;
  const outcome = await sendChatWithRetry({
    candidates: [{ nr: 1 }, { nr: 2 }],
    maxRounds: 2,
    cooldownMs: 5000,
    sleep: async ms => { waits.push(ms); },
    onCooldown: info => waits.push('cb:' + info.round),
    attempt: async candidate => {
      calls += 1;
      if (calls <= 2) throw quotaError();
      return { for: candidate.nr, text: 'hallo' };
    },
  });

  assert.strictEqual(outcome.result.text, 'hallo');
  assert.deepStrictEqual(waits, ['cb:1', 5000], 'erst Callback, dann Wartezeit');
  assert.strictEqual(calls, 3, 'zwei Kandidaten in Runde 1, dann Erfolg in Runde 2');
});

test('Quota: alle Kandidaten werden probiert, dann Cooldown', async () => {
  const seen = [];
  const waits = [];
  await assert.rejects(
    sendChatWithRetry({
      candidates: [{ nr: 1 }, { nr: 2 }, { nr: 3 }],
      maxRounds: 2,
      cooldownMs: 1000,
      sleep: async ms => { waits.push(ms); },
      attempt: async candidate => {
        seen.push(candidate.nr);
        throw quotaError();
      },
    }),
  );
  assert.deepStrictEqual(seen, [1, 2, 3, 1, 2, 3], 'zwei Runden ueber alle Kandidaten');
  assert.deepStrictEqual(waits, [1000]);
});

test('isQuotaError erkennt Status und Text', () => {
  assert.strictEqual(isQuotaError(quotaError()), true);
  assert.strictEqual(isQuotaError(Object.assign(new Error('boom'), { status: 500 })), false);
  assert.strictEqual(isQuotaError(new Error('Free usage limit reached')), true);
  assert.strictEqual(isQuotaError(Object.assign(new Error('x'), { code: 'QUOTA_EXCEEDED' })), true);
});

test('5xx rotiert weiterhin sofort durch die Kandidaten', async () => {
  const seen = [];
  const waits = [];
  await assert.rejects(
    sendChatWithRetry({
      candidates: [{ nr: 1 }, { nr: 2 }],
      maxRounds: 2,
      cooldownMs: 1000,
      sleep: async ms => { waits.push(ms); },
      attempt: async candidate => {
        seen.push(candidate.nr);
        throw Object.assign(new Error('bad gateway'), { status: 502 });
      },
    }),
  );
  assert.deepStrictEqual(seen, [1, 2], 'kein Cooldown bei 5xx');
  assert.deepStrictEqual(waits, []);
});
