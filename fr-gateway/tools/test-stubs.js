#!/usr/bin/env node
// language: node, file: test-stubs.js, runtime: node >= 18
//
// Integrationstest fuer light-upstream.js und free-model-bridge.js.
//
// Startet beide Stubs auf zufaelligen Ports und prueft:
//   - GET  /v1/models            (200, OpenAI-Liste-Schema)
//   - POST /v1/chat/completions  (200, chat.completion-Schema inkl. usage)
//   - GET  /healthz              (200, Request-Zaehler)
//   - bridge-Fallback: bridge-Metadata vorhanden
//   - bridge-Prox ohne Key -> 429 {error:{type:"bridge_no_key"}} (Konvention)
//   - bridge-Prox mit Key -> Antwort des Ziel-Upstreams kommt durch (200)
//
// Ausfuehren: node test-stubs.js   (Exit 0 = alles gruen)

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const assert = require("assert");

const DIR = __dirname;
const LIGHT = path.join(DIR, "light-upstream.js");
const BRIDGE = path.join(DIR, "free-model-bridge.js");

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function api(base, method, p, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, base);
    const req = http.request(
      url,
      { method, headers: { "Content-Type": "application/json" }, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* kein JSON */
          }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitHealthy(child, base, out) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`stub exited early (code=${child.exitCode}): ${out()}`);
    }
    try {
      const r = await api(base, "GET", "/healthz");
      if (r.status === 200) return;
    } catch {
      /* noch nicht bereit */
    }
    await sleep(150);
  }
  throw new Error(`stub failed to become healthy: ${out()}`);
}

async function startStub(file, extraEnv) {
  const port = await freePort();
  const child = spawn(process.execPath, [file], {
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logText = "";
  child.stdout.on("data", (d) => { logText += d; });
  child.stderr.on("data", (d) => { logText += d; });
  const base = `http://127.0.0.1:${port}`;
  await waitHealthy(child, base, () => logText);
  return { child, base, log: () => logText };
}

const chatReq = (model) => ({
  model: model || "test-model",
  messages: [{ role: "user", content: "Hallo, funktioniert der Stub?" }],
});

function assertChatCompletion(r, label) {
  check(`${label}: Status 200`, r.status === 200, `status=${r.status}`);
  const j = r.json;
  check(`${label}: object=chat.completion`, j && j.object === "chat.completion", j && j.object);
  check(`${label}: id ist String`, j && typeof j.id === "string");
  check(`${label}: model ist String`, j && typeof j.model === "string" && j.model.length > 0);
  const ch = j && j.choices && j.choices[0];
  check(`${label}: choices[0].message.role=assistant`, ch && ch.message && ch.message.role === "assistant");
  check(`${label}: choices[0].message.content non-empty`, ch && ch.message && typeof ch.message.content === "string" && ch.message.content.length > 0);
  check(`${label}: finish_reason=stop`, ch && ch.finish_reason === "stop");
  const u = j && j.usage;
  check(
    `${label}: usage-Zahlen`,
    u && [u.prompt_tokens, u.completion_tokens, u.total_tokens].every((n) => typeof n === "number" && n >= 0)
  );
}

function assertModelsList(r, label) {
  check(`${label}: Status 200`, r.status === 200, `status=${r.status}`);
  const j = r.json;
  check(`${label}: object=list`, j && j.object === "list");
  check(`${label}: data ist Array mit id`, Array.isArray(j && j.data) && j.data.length > 0 && typeof j.data[0].id === "string");
}

async function main() {
  // ---- 1. light-upstream ----
  const light = await startStub(LIGHT);
  console.log(`\n[light-upstream] bereit auf ${light.base}\n`);

  const lm = await api(light.base, "GET", "/v1/models");
  assertModelsList(lm, "light /v1/models");

  const lc = await api(light.base, "POST", "/v1/chat/completions", chatReq());
  assertChatCompletion(lc, "light chat/completions");
  check("light: Modellname wird uebernommen", lc.json && lc.json.model === "test-model");

  const lh1 = await api(light.base, "GET", "/healthz");
  check("light /healthz: requests>=2", lh1.json && lh1.json.requests >= 2, `requests=${lh1.json && lh1.json.requests}`);

  // ---- 2. bridge Fallback (ohne UPSTREAM_URL) ----
  const bridgeFallback = await startStub(BRIDGE);
  console.log(`\n[bridge fallback] bereit auf ${bridgeFallback.base}\n`);

  const bm = await api(bridgeFallback.base, "GET", "/v1/models");
  assertModelsList(bm, "bridge(fallback) /v1/models");

  const bc = await api(bridgeFallback.base, "POST", "/v1/chat/completions", chatReq());
  assertChatCompletion(bc, "bridge(fallback) chat/completions");
  check(
    "bridge(fallback): bridge-Metadata vorhanden",
    bc.json && bc.json.bridge && bc.json.bridge.mode === "local-fallback",
    JSON.stringify(bc.json && bc.json.bridge)
  );

  // ---- 3. bridge Proxy ohne Key -> 429 bridge_no_key (Konvention) ----
  const bridgeNoKey = await startStub(BRIDGE, { UPSTREAM_URL: light.base });
  console.log(`\n[bridge proxy ohne key] bereit auf ${bridgeNoKey.base}\n`);

  const bn1 = await api(bridgeNoKey.base, "POST", "/v1/chat/completions", chatReq());
  check("bridge(proxy,keylos): 429", bn1.status === 429, `status=${bn1.status}`);
  check("bridge(proxy,keylos): error.type=bridge_no_key", bn1.json && bn1.json.error && bn1.json.error.type === "bridge_no_key", JSON.stringify(bn1.json));

  const bn2 = await api(bridgeNoKey.base, "GET", "/v1/models");
  check("bridge(proxy,keylos): models auch 429", bn2.status === 429, `status=${bn2.status}`);

  // ---- 4. bridge Proxy mit Key -> Passthrough an light ----
  const bridgeKey = await startStub(BRIDGE, { UPSTREAM_URL: light.base, UPSTREAM_KEY: "test-token" });
  console.log(`\n[bridge proxy mit key] bereit auf ${bridgeKey.base}\n`);

  const pk = await api(bridgeKey.base, "POST", "/v1/chat/completions", chatReq());
  check("bridge(proxy,key): Status 200 (durchgereicht)", pk.status === 200, `status=${pk.status}`);
  assertChatCompletion(pk, "bridge(proxy,key) chat/completions");
  check(
    "bridge(proxy,key): Antwort stammt vom Ziel-upstream (offline-stub-Text)",
    pk.json && pk.json.model === "test-model" && /offline-stub/.test(pk.json.choices[0].message.content),
    `model=${pk.json && pk.json.model}`
  );
  check("bridge(proxy,key): keine Bridge-Metadata im Passthrough", !(pk.json && pk.json.bridge));

  const pm = await api(bridgeKey.base, "GET", "/v1/models");
  check("bridge(proxy,key): /v1/models durchgereicht", pm.status === 200 && pm.json && pm.json.object === "list", `status=${pm.status}`);

  // ---- Aufraeumen ----
  for (const t of [light, bridgeFallback, bridgeNoKey, bridgeKey]) {
    try { t.child.kill(); } catch { /* ignore */ }
  }
  await sleep(300);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} Tests bestanden`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST-SCRIPT-FEHLER:", err);
  process.exit(2);
});
