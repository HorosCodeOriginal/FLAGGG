#!/usr/bin/env node
// language: node, file: free-model-bridge.js, runtime: node >= 18
//
// Mini-OpenAI-kompatibler Brueckenkopf fuer den fr-gateway Upstream-Pool
// (upstream "free-bridge"). Kein externes Paket, nur http/https.
//
// Verhalten:
//   Ohne UPSTREAM_URL  -> lokaler Fallback (wie light-upstream), zusaetzlich
//                         bridge-Metadata in der Antwort.
//   Mit UPSTREAM_URL   -> Proxy fuer POST /v1/chat/completions und
//                         GET /v1/models an den entfernten Endpunkt; Status-
//                         codes und Body werden unveraendert durchgereicht
//                         (inklusive 401/402/403/429/5xx fuer den nginx-
//                         Failover des fr-gateway).
//
// Konvention (getestet in test-stubs.js):
//   Wenn UPSTREAM_URL gesetzt ist, UPSTREAM_KEY aber LEER ist, antwortet die
//   Bridge mit 429 {error:{type:"bridge_no_key"}}. Begruendung: ohne Token
//   kann die Bridge nicht sicherstellen, dass der entfernte Dienst den Request
//   annimmt; der 429 laesst den fr-gateway-Failover sauber auf die naechste
//   Stufe (local-light) schalten, statt dem Client einen unauthentifizierten
//   Proxyfehler zu zeigen. Fuer einen wirklich keylosen Upstream UPSTREAM_KEY
//   auf einen Dummy-Wert setzen (z.B. "none") - dann wird der Header gesendet,
//   ein " der Endpunkt ignoriert.
//
// Start:  node free-model-bridge.js          (env PORT, Default 20201)
// Konfig: PORT          = Listener-Port (Default 20201)
//         UPSTREAM_URL  = Basis-URL des entfernten Endpunkts, z.B.
//                         "http://host.docker.internal:3456" oder
//                         "http://host:3456/v1" (trailing Slash egal).
//                         Leer = lokaler Fallback.
//         UPSTREAM_KEY  = optionales Token, wird als Authorization: Bearer
//                         an den Upstream gesendet.
//         MODEL_ID      = Modellname im Fallback-Modus (Default "free-model-bridge").
//
// Logging: jede Anfrage auf stdout.

const http = require("http");
const https = require("https");

const PORT = parseInt(process.env.PORT || "20201", 10);
const UPSTREAM_URL = (process.env.UPSTREAM_URL || "").trim();
const UPSTREAM_KEY = (process.env.UPSTREAM_KEY || "").trim();
const MODEL_ID = (process.env.MODEL_ID || "free-model-bridge").trim();
const SERVICE = "free-model-bridge";
const ADDR = "0.0.0.0";
const PROXY_TIMEOUT_MS = 30000;

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

// ---------------------------------------------------------------------------
// Fallback-Modus (wie light-upstream, plus bridge-Metadata)
// ---------------------------------------------------------------------------

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
    bridge: {
      mode: "local-fallback",
      service: SERVICE,
      upstream_url: null,
      key_configured: false,
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

// ---------------------------------------------------------------------------
// Proxy-Modus
// ---------------------------------------------------------------------------

// Basis-Pfad des Upstreams mit dem eingehenden Pfad zusammenfuehren.
// Ist UPSTREAM_URL z.B. "http://host:3456/v1" und der Request kommt auf
// "/v1/chat/completions", wird "/v1" nicht doppelt angehaengt.
function joinPath(basePath, reqPath) {
  const b = basePath.replace(/\/+$/, "");
  let p = reqPath;
  if (b.endsWith("/v1") && p.startsWith("/v1")) {
    p = p.slice(4) || "/";
  }
  return b + p;
}

function proxy(method, reqPath, body, res) {
  let upstream;
  try {
    upstream = new URL(UPSTREAM_URL);
  } catch {
    sendError(res, 500, "bridge_config_error", "UPSTREAM_URL ist keine gueltige URL");
    return;
  }

  const fwdPath = joinPath(upstream.pathname, reqPath);
  const fwdUrl = `${upstream.protocol}//${upstream.host}${fwdPath}`;
  const mod = upstream.protocol === "https:" ? https : http;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (UPSTREAM_KEY) {
    headers.Authorization = `Bearer ${UPSTREAM_KEY}`;
  }

  const req = mod.request(
    fwdUrl,
    {
      method,
      headers,
      timeout: PROXY_TIMEOUT_MS,
    },
    (upRes) => {
      const status = upRes.statusCode || 502;
      res.writeHead(status, {
        "Content-Type": upRes.headers["content-type"] || "application/json",
      });
      upRes.pipe(res);
    }
  );

  req.on("timeout", () => {
    req.destroy(new Error("upstream timeout"));
  });
  req.on("error", (err) => {
    log(`proxy error ${method} ${fwdUrl}: ${err.message}`);
    if (!res.headersSent) {
      sendError(res, 502, "bad_gateway", `upstream unreachable: ${err.message}`);
    } else {
      res.end();
    }
  });

  req.write(body);
  req.end();
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  state.requests += 1;
  let pathname = "/";
  try {
    pathname = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
  } catch {
    /* unparsebar -> 404 unten */
  }

  const isChat = req.method === "POST" && pathname === "/v1/chat/completions";
  const isModels = req.method === "GET" && pathname === "/v1/models";
  const isHealth = req.method === "GET" && pathname === "/healthz";

  try {
    if (isHealth) {
      sendJSON(res, 200, {
        status: "ok",
        service: SERVICE,
        mode: UPSTREAM_URL ? "proxy" : "local-fallback",
        upstream_url: UPSTREAM_URL || null,
        key_configured: Boolean(UPSTREAM_KEY),
        requests: state.requests,
        started_at: state.started_at,
      });
    } else if (!UPSTREAM_URL) {
      // Lokaler Fallback
      if (isModels) {
        sendJSON(res, 200, modelsList());
      } else if (isChat) {
        const body = await readBody(req, 1 << 20);
        let payload = {};
        try {
          payload = JSON.parse(body);
        } catch {
          /* s. light-upstream.js */
        }
        const model = typeof payload.model === "string" && payload.model ? payload.model : MODEL_ID;
        const content =
          `${MODEL_ID}: keine UPSTREAM_URL konfiguriert, Fallback-Modus. ` +
          `Anfrage empfangen (model=${model}). Dieser Brueckenkopf gibt ` +
          `Bridge-Metadata in jeder Antwort mit.`;
        sendJSON(res, 200, chatCompletion(model, content));
      } else {
        sendError(res, 404, "not_found", "route not found");
      }
    } else if (!UPSTREAM_KEY) {
      // Konvention: Proxy ohne Token verweigern -> 429 fuer nginx-Failover
      sendError(
        res,
        429,
        "bridge_no_key",
        "UPSTREAM_KEY fehlt; Proxy verweigert (Konvention, siehe README)"
      );
    } else if (isModels || isChat) {
      const body = await readBody(req, 1 << 20);
      proxy(req.method, pathname, body, res);
    } else {
      sendError(res, 404, "not_found", "route not found");
    }
  } catch (err) {
    if (!res.headersSent) {
      sendError(res, 400, "invalid_request_error", String((err && err.message) || err));
    }
  } finally {
    log(`${req.method} ${pathname} -> ${res.statusCode} (mode=${UPSTREAM_URL ? "proxy" : "local-fallback"})`);
  }
});

server.listen(PORT, ADDR, () => {
  log(
    `listening on ${ADDR}:${PORT} (mode=${UPSTREAM_URL ? "proxy: " + UPSTREAM_URL : "local-fallback"}, ` +
      `key=${UPSTREAM_KEY ? "configured" : "none"})`
  );
});

function shutdown(signal) {
  log(`received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
