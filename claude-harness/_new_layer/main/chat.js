// chat.js — SSE-gateway-client: POST http://localhost:<port>/v1/chat/completions
// bearer=<unique_key>, stream:true → parse data-zeilen → deltas über callback.
const http = require('http');

const DEFAULT_MODEL = null; // aus /v1/models befüllt

function models(port, key) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/v1/models',
      method: 'GET',
      headers: { Authorization: 'Bearer ' + key },
      timeout: 8000,
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error('GET /v1/models -> ' + res.statusCode + ' ' + body.slice(0, 200)));
        }
        try {
          const j = JSON.parse(body);
          const list = (j.data || []).map(m => m.id);
          resolve(list);
        } catch (e) {
          reject(new Error('models-parse fehler: ' + e.message));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('models timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * streamChat({port, key, messages, model, params, onDelta, onDone, onError})
 * - onDelta(deltaText)
 * - onDone({usage, model, elapsedMs})
 * - onError({status, message})
 * Rückgabe: stop()-funktion.
 */
function streamChat(opts) {
  const { port, key, messages, model, params = {} } = opts;
  const body = {
    messages,
    stream: true,
  };
  if (model) body.model = model;
  if (typeof params.temperature === 'number') body.temperature = params.temperature;
  if (typeof params.top_p === 'number') body.top_p = params.top_p;
  if (typeof params.max_tokens === 'number') body.max_tokens = params.max_tokens;

  const started = Date.now();
  const controller = new AbortController();

  const req = http.request({
    host: '127.0.0.1',
    port,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    signal: controller.signal,
    timeout: 300000,
  }, res => {
    if (res.statusCode !== 200) {
      let errBody = '';
      res.on('data', c => { errBody += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(errBody); } catch (e) { /* rohtext */ }
        const errObj = parsed && parsed.error ? parsed.error : { message: errBody.slice(0, 300) };
        opts.onError && opts.onError({ status: res.statusCode, ...errObj });
      });
      return;
    }

    let buf = '';
    let lastUsage = null;
    let lastModel = model || null;
    let done = false;

    res.setEncoding('utf-8');
    res.on('data', chunk => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          done = true;
          continue;
        }
        try {
          const j = JSON.parse(payload);
          lastModel = j.model || lastModel;
          if (j.usage) lastUsage = j.usage;
          const delta = j.choices && j.choices[0] && j.choices[0].delta;
          if (delta) {
            const t = delta.content || (delta.reasoning_content || '');
            if (t) opts.onDelta && opts.onDelta(t);
          }
        } catch (e) {
          // chunk unvollständig/kommentar — ignorieren
        }
      }
    });

    res.on('end', () => {
      if (!done) {
        // restlicher buffer ggf. noch ein event
        try {
          const line = buf.trim();
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload !== '[DONE]') {
              const j = JSON.parse(payload);
              if (j.usage) lastUsage = j.usage;
            }
          }
        } catch (e) { /* ignore */ }
      }
      opts.onDone && opts.onDone({
        usage: lastUsage,
        model: lastModel,
        elapsedMs: Date.now() - started,
      });
    });

    res.on('error', err => {
      opts.onError && opts.onError({ status: 0, message: err.message });
    });
  });

  req.on('timeout', () => {
    req.destroy(new Error('stream timeout'));
    opts.onError && opts.onError({ status: 0, message: 'stream timeout' });
  });
  req.on('error', err => {
    if (err.name === 'AbortError') return; // stop() — still
    opts.onError && opts.onError({ status: 0, message: err.message });
  });
  req.write(JSON.stringify(body));
  req.end();

  return () => controller.abort();
}

module.exports = { models, streamChat, DEFAULT_MODEL };
