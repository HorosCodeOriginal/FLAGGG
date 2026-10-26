// CDP-Bedienung der laufenden Harness-App: Chat-Nachricht senden, Canvas pruefen,
// Screenshots aufnehmen. System-Node (kein natives Modul), CDP auf 127.0.0.1:9222.
const fs = require('fs');
const path = require('path');
const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getJson('http://127.0.0.1:9222/json/list');
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('kein page-target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const send = (m, params) => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method: m, params: params || {} }));
    });
  };
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.text || ''));
    return r.result && r.result.value;
  };
  const shot = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const out = path.join(__dirname, name);
    fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
    console.log('screenshot:', out);
  };

  await send('Runtime.enable');
  await send('Page.enable');

  // 1) Chat-Tab oeffnen
  await evaluate(`(function(){
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Chat');
    if (btn) btn.click();
    return location.hash;
  })()`);
  await new Promise(r => setTimeout(r, 900));

  // 2) Nachricht in den Composer schreiben (React-kompatibel)
  const message = 'Hallo aus dem Live-Betrieb! Antworte bitte kurz: funktionieren Gateway und UI?';
  const typed = await evaluate(`(function(){
    const input = document.querySelector('input[placeholder="Nachricht an Coding Agent …"]') || document.querySelector('input[type="text"]');
    if (!input) return 'kein eingabefeld';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(message)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);
  console.log('eingetippt:', typed);

  // 3) Senden
  const sent = await evaluate(`(function(){
    for (const sel of ['[data-act="send"]', 'button.send', '.composer button:last-of-type']) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return 'clicked ' + sel; }
    }
    const input = document.querySelector('input[type="text"]');
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return 'Enter';
    }
    return 'kein send-weg';
  })()`);
  console.log('senden:', sent);

  await new Promise(r => setTimeout(r, 7000));
  const after = await evaluate(`(function(){
    const msgs = [...document.querySelectorAll('article')].map(m => (m.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 220));
    return { hash: location.hash, messages: msgs.slice(-3), inputCleared: (document.querySelector('input[type="text"]') || {}).value };
  })()`);
  console.log('letzte nachrichten:', JSON.stringify(after.messages));
  await shot('app-chat.png');

  // 4) Orchestration-Canvas
  await evaluate(`(function(){
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').trim() === 'Orchestration');
    if (btn) btn.click();
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 1200));
  const canvas = await evaluate(`(function(){
    return {
      nodes: [...document.querySelectorAll('.net-node')].map(n => n.textContent.trim()),
      edges: [...document.querySelectorAll('.net-edge')].map(e => e.getAttribute('class')),
      timeline: [...document.querySelectorAll('.live-tl .tl li')].map(l => (l.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80)).slice(0, 4)
    };
  })()`);
  console.log('knoten:', JSON.stringify(canvas.nodes));
  console.log('kanten:', JSON.stringify(canvas.edges));
  console.log('timeline:', JSON.stringify(canvas.timeline));
  await shot('app-orchestration.png');

  ws.close();
  process.exit(0);
})().catch(err => { console.error('FEHLER:', err.message); process.exit(1); });
