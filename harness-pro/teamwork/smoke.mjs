// Smoke-Test für MiniVault (Agent A, Backend/API)
// Erwartet einen laufenden Server auf http://127.0.0.1:9871 (env PORT überschreibbar).
// Exit 0, wenn alle 6 Checks grün sind; sonst Exit 1.

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:9871';

let passed = 0;
const results = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    results.push(`PASS  ${name}`);
  } catch (err) {
    results.push(`FAIL  ${name}: ${err.message}`);
  }
}

function call(method, pathname, body) {
  return fetch(BASE + pathname, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

let vaultId = null;

const checks = [
  ['1. healthz → 200', async () => {
    const r = await call('GET', '/healthz');
    const j = await r.json();
    if (r.status !== 200 || j.ok !== true) {
      throw new Error(`status=${r.status}, body=${JSON.stringify(j)}`);
    }
  }],

  ['2. Vault anlegen → 201', async () => {
    const r = await call('POST', '/api/vaults', { name: 'Smoke Vault' });
    const j = await r.json();
    if (r.status !== 201 || !j.id || !j.createdAt || j.name !== 'Smoke Vault') {
      throw new Error(`status=${r.status}, body=${JSON.stringify(j)}`);
    }
    vaultId = j.id;
  }],

  ['3. Vault-Liste → 200', async () => {
    const r = await call('GET', '/api/vaults');
    const j = await r.json();
    if (r.status !== 200 || !Array.isArray(j.vaults) || !j.vaults.some((v) => v.id === vaultId)) {
      throw new Error(`status=${r.status}, body=${JSON.stringify(j)}`);
    }
  }],

  ['4. Eintrag anlegen → 201', async () => {
    const r = await call('POST', `/api/vaults/${vaultId}/entries`, {
      title: 'E-Mail', username: 'a@b.de', secret: 'geheim123',
    });
    const j = await r.json();
    if (r.status !== 201 || !j.id || !j.createdAt || j.title !== 'E-Mail' || j.secret !== 'geheim123') {
      throw new Error(`status=${r.status}, body=${JSON.stringify(j)}`);
    }
  }],

  ['5. Unbekannter Vault → 404', async () => {
    const r = await call('GET', '/api/vaults/existiert-nicht');
    if (r.status !== 404) throw new Error(`status=${r.status}`);
  }],

  ['6. Fehlender name → 400', async () => {
    const r = await call('POST', '/api/vaults', {});
    if (r.status !== 400) throw new Error(`status=${r.status}`);
  }],
];

for (const [name, fn] of checks) {
  await check(name, fn);
}

console.log(results.join('\n'));
console.log(`\nErgebnis: ${passed}/${checks.length} bestanden`);
process.exit(passed === checks.length ? 0 : 1);
