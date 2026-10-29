#!/usr/bin/env node
// language: node, file: light-upstream.js, runtime: node >= 18
//
// Offline-Stub fuer den fr-gateway Upstream-Pool (upstream "local-light",
// letzte Failover-Stufe). Kein externes Paket, nur das http-Modul.
//
// OpenAI-kompatibel:
//   POST /v1/chat/completions  -> chat.completion (immer 200)
//   GET  /v1/models             -> Modell-Liste
//   GET  /healthz               -> Health + Request-Zaehler
//
// Start:  node light-upstream.js            (env PORT, Default 20200)
// Konfig: PORT   = Listener-Port (Default 20200)
//         MODEL_ID = Modellname in Antworten (Default "offline-stub")
//
// Logging: jede Anfrage auf stdout; Startzeile zum Verifizieren.

const http = require("http");

const PORT = parseInt(process.env.PORT || "20200", 10);
const MODEL_ID = (process.env.MODEL_ID || "offline-stub").trim();
const SERVICE = "light-upstream";
const ADDR = "0.0.0.0";

const state = {
  requests: 0,
  started_at: new Date().toISOString(),
};

function log(msg) {
  console.log(`[${SERVICE}] ${new Date().toISOString()} ${msg}`);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, type, message) {
  sendJSON(res, status, { error: { type, message } });
}

// OpenAI chat.completion-Antwort. content ist bewusst hilfreich: der Stub
// ist die letzte Stufe und soll signalisieren, dass der Offline-Modus aktiv ist.
function chatCompletion(model, content) {
  const promptTokens = 7;
  const completionTokens = content.length;
  return {
    id: `chatcmpl-${SERVICE}-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: nowSec(),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function modelsList() {
  return {
    object: "list",
    data: [
      {
        id: MODEL_ID,
        object: "model",
        created: nowSec(),
        owned_by: "fr-gateway-tools",
      },
    ],
  };
}

const server = http.createServer(async (req, res) => {
  state.requests += 1;
  let pathname = "/";
  try {
    pathname = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
  } catch {
    /* unparsebar -> 404 unten */
  }
  try {
    if (req.method === "GET" && pathname === "/healthz") {
      sendJSON(res, 200, {
        status: "ok",
        service: SERVICE,
        model: MODEL_ID,
        requests: state.requests,
        started_at: state.started_at,
      });
    } else if (req.method === "GET" && pathname === "/v1/models") {
      sendJSON(res, 200, modelsList());
    } else if (req.method === "POST" && pathname === "/v1/chat/completions") {
      const body = await readBody(req, 1 << 20); // 1 MiB
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        /* nicht-JSON wird toleriert, Modellname bleibt Default */
      }
      const model = typeof payload.model === "string" && payload.model ? payload.model : MODEL_ID;
      const content =
        `${MODEL_ID}: Offline-Modus aktiv, Anfrage empfangen (model=${model}). ` +
        `Dieser Stub ist die letzte Failover-Stufe des fr-gateway; ` +
        `der primäre Router ist nicht erreichbar bzw. hat Quota erreicht.`;
      sendJSON(res, 200, chatCompletion(model, content));
    } else {
      sendError(res, 404, "not_found", "route not found");
    }
  } catch (err) {
    sendError(res, 400, "invalid_request_error", String((err && err.message) || err));
  } finally {
    log(`${req.method} ${pathname} -> ${res.statusCode}`);
  }
});

server.listen(PORT, ADDR, () => {
  log(`listening on ${ADDR}:${PORT} (model=${MODEL_ID})`);
});

function shutdown(signal) {
  log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
