'use strict';

// HTTP-Reverse-Proxy - nur Standardmodule (node:http, node:url).
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_PORT = 8099;
const DEFAULT_TARGET = 'http://127.0.0.1:9000';
const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10000;

function parseEnvNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Sliding-Window-Rate-Limiter pro Client-IP.
 * Erlaubte Requests werden registriert und zurueckgegeben:
 *   { limited: false }
 * Ueberschreitet ein Request das Limit, wird er abgelehnt:
 *   { limited: true, retryAfterSeconds }
 */
function createRateLimiter(maxRequests, windowMs) {
  const hitsByIp = new Map();

  return function check(ip, now = Date.now()) {
    let hits = hitsByIp.get(ip);
    if (!hits) {
      hits = [];
      hitsByIp.set(ip, hits);
    }
    // Eintraege ausserhalb des Fensters entfernen.
    while (hits.length > 0 && hits[0] <= now - windowMs) {
      hits.shift();
    }
    if (hits.length >= maxRequests) {
      const retryAfterMs = hits[0] + windowMs - now;
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    hits.push(now);
    return { limited: false };
  };
}

function createProxy(options = {}) {
  const port = options.port ?? parseEnvNumber(process.env.PORT, DEFAULT_PORT);
  const targetUrl = new URL(options.target ?? process.env.TARGET ?? DEFAULT_TARGET);
  const apiKey = options.apiKey ?? process.env.API_KEY ?? '';
  const maxRequests = options.maxRequests ?? parseEnvNumber(process.env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
  const windowMs = options.windowMs ?? parseEnvNumber(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS);

  const rateLimit = createRateLimiter(maxRequests, windowMs);

  const server = http.createServer((req, res) => {
    const ip = req.socket.remoteAddress || 'unknown';

    // 1) Rate-Limit (pro Client-IP, Sliding Window)
    const rl = rateLimit(ip);
    if (rl.limited) {
      res.writeHead(429, { 'Retry-After': String(rl.retryAfterSeconds) });
      res.end('Too Many Requests');
      return;
    }

    // 2) Auth: x-api-key muss API_KEY entsprechen
    if (apiKey && req.headers['x-api-key'] !== apiKey) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    // 3) Weiterleitung an TARGET
    const targetPort = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80);
    const headers = { ...req.headers, host: targetUrl.host };
    delete headers.connection;

    const upstream = http.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );

    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
      } else {
        res.destroy();
      }
    });

    req.pipe(upstream);
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      });
    },
  };
}

if (require.main === module) {
  const app = createProxy();
  app
    .listen()
    .then((actualPort) => {
      console.error(`[proxy] lauscht auf Port ${actualPort}, Ziel: ${process.env.TARGET ?? DEFAULT_TARGET}`);
    })
    .catch((err) => {
      console.error('[proxy] Start fehlgeschlagen:', err.message);
      process.exit(1);
    });
}

module.exports = { createProxy, createRateLimiter };
