// Maximaler UI-Klick-Test harness-pro (Web-Modus, http://127.0.0.1:4173)
// Lauf: node test/ui-playwright.spec.js
// Enthält: (1) portierte Checks aus ui-test.js (data-act-Semantik),
//          (2) Discovery: ALLE [data-act]/[data-q]-Elemente anklicken,
//              Console-/JS-Fehler, leere Views, Crashs dokumentieren,
//          (3) Screenshot-Report nach test/shots/ und test/ui-test-report.md.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.UI_BASE || 'http://127.0.0.1:4173';
const SHOTS_DIR = path.join(__dirname, 'shots');
const REPORT_PATH = path.join(__dirname, 'ui-test-report.md');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const results = [];
const bugs = [];
let consoleErrors = [];
let pageErrors = [];
let failedRequests = [];
let clickCount = 0;
let discoveredKeys = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page, browser, ctx;

async function shot(name) {
  const p = path.join(SHOTS_DIR, name + '.png');
  try {
    await page.screenshot({ path: p, fullPage: true });
    return p;
  } catch (e) {
    return null;
  }
}

function recordBug(level, msg, shotPath) {
  bugs.push({ level, msg, shot: shotPath || null });
  console.log('[BUG ' + level + '] ' + msg + (shotPath ? '  shot=' + shotPath : ''));
}

function check(label, fn) {
  return (async () => {
    const t0 = Date.now();
    try {
      await fn();
      results.push({ label, ok: true, ms: Date.now() - t0 });
      console.log('ok    ' + label);
    } catch (e) {
      const sp = await shot('fail-' + String(results.length).padStart(3, '0') + '-' + label.replace(/[^a-z0-9]+/gi, '-').slice(0, 60));
      recordBug('medium', label + ' → ' + (e && e.message ? e.message : String(e)), sp);
      results.push({ label, ok: false, err: e && e.message ? e.message : String(e), ms: Date.now() - t0 });
      console.log('FAIL  ' + label + ' :: ' + (e && e.message ? e.message : String(e)));
    }
  })();
}

async function appText() {
  return page.evaluate(() => (document.getElementById('app') || { innerText: '' }).innerText);
}
async function clickSel(sel) {
  await page.locator(sel).first().click({ timeout: 4000 });
}
async function expectToast(pattern, label) {
  const start = Date.now();
  while (Date.now() - start < 1800) {
    const txt = await page.evaluate(() => {
      const el = document.getElementById('toast');
      return el && !el.hidden ? el.textContent || '' : '';
    });
    if (txt && pattern.test(txt)) return txt;
    await sleep(40);
  }
  const got = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  throw new Error('toast missing ' + pattern + ' got "' + got + '"');
}
async function hasOn(sel) {
  return page.evaluate((s) => !!document.querySelector(s), sel);
}
async function rawText(sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.innerText : '';
  }, sel);
}
async function markEmpty(view) {
  const n = (await appText()).trim().length;
  if (n < 40) throw new Error('rendered empty (innerText len=' + n + ')');
}

// ---------- Pass 1: portierte Referenz-Checks (ui-test.js) ----------
async function referencePass() {
  // Boot: kein IDE-View-Rest
  await check('boot: no removed IDE view', async () => {
    const hasIde = await page.evaluate(() => !!document.querySelector('[data-view="workspace"]') || !!document.querySelector('.workspace'));
    if (hasIde) throw new Error('removed IDE view is still present');
  });

  for (const view of ['chat', 'orchestration', 'overview', 'market']) {
    await check('nav → ' + view, async () => {
      await clickSel('[data-act="nav"][data-view="' + view + '"]');
      await sleep(60);
      await markEmpty(view);
      if (!(await hasOn('[data-act="nav"][data-view="' + view + '"].on'))) throw new Error('nav not active');
    });
  }

  await check('layouts thread/phases/code/studio', async () => {
    await clickSel('[data-act="nav"][data-view="chat"]');
    await sleep(40);
    for (const layout of ['thread', 'phases', 'code', 'studio']) {
      await clickSel('[data-act="layout"][data-layout="' + layout + '"]');
      await sleep(30);
      if (!(await hasOn('[data-layout="' + layout + '"].on'))) throw new Error('layout ' + layout + ' not active');
    }
  });

  await check('panes tasks/memory/knowledge/agents/settings/chat', async () => {
    for (const pane of ['tasks', 'memory', 'knowledge', 'agents', 'settings', 'chat']) {
      await clickSel('[data-act="cpane"][data-pane="' + pane + '"]');
      await sleep(30);
      if (!(await hasOn('[data-pane="' + pane + '"].on'))) throw new Error('pane ' + pane + ' not active');
    }
    if (!(await page.$('#composer'))) throw new Error('composer missing on chat');
  });

  await check('step toggle updates progress', async () => {
    await clickSel('[data-act="step"]');
    await sleep(40);
    if (!/20%/.test(await appText())) throw new Error('step toggle did not update progress');
  });

  await check('plan toggle keeps tasks pane (früherer FAIL)', async () => {
    await clickSel('[data-act="cpane"][data-pane="tasks"]');
    await sleep(30);
    await clickSel('[data-act="plan"]');
    await sleep(40);
    if (!/Tasks/.test(await appText())) throw new Error('plan toggle left tasks');
  });

  await check('reasoning expands', async () => {
    await clickSel('[data-act="cpane"][data-pane="chat"]');
    await clickSel('[data-act="layout"][data-layout="phases"]');
    await sleep(30);
    await clickSel('[data-act="reason"]');
    await sleep(40);
    if (!/session cookies|reset handler|login route/.test(await appText())) throw new Error('reasoning did not expand');
  });

  await check('like sticks', async () => {
    await clickSel('[data-act="layout"][data-layout="studio"]');
    await sleep(30);
    await clickSel('[data-act="like"][data-vote="up"]');
    await sleep(40);
    if (!(await hasOn('[data-vote="up"].on'))) throw new Error('like did not stick');
  });

  await check('copy toasts', async () => {
    await clickSel('[data-act="layout"][data-layout="code"]');
    await sleep(30);
    await clickSel('[data-act="copy"]');
    await expectToast(/Copied|Kopiert/, 'copy');
  });

  await check('session switch toasts BUG-187', async () => {
    await clickSel('[data-act="layout"][data-layout="studio"]');
    await clickSel('[data-act="session"][data-id="bug187"]');
    await expectToast(/BUG-187/, 'session');
  });

  await check('blank composer does not change thread', async () => {
    const before = await appText();
    await page.fill('#composer', '   ');
    await page.evaluate(() => document.getElementById('composerForm').requestSubmit());
    await sleep(120);
    if ((await appText()) !== before) throw new Error('blank message changed the thread');
  });

  await check('pause blocks sends / resume works', async () => {
    await clickSel('[data-q="pause"]');
    await expectToast(/paused|pausiert/, 'pause');
    await page.fill('#composer', 'this must not send while paused');
    await page.evaluate(() => document.getElementById('composerForm').requestSubmit());
    await sleep(140);
    if (/this must not send while paused/.test(await appText())) throw new Error('paused agent still accepted a message');
    await clickSel('[data-q="pause"]');
    await expectToast(/resumed|fortgesetzt/, 'resume');
  });

  await check('agent reply arrives', async () => {
    await page.fill('#composer', 'Add tests for the payment flow');
    await page.evaluate(() => document.getElementById('composerForm').requestSubmit());
    await sleep(1000);
    if (!/unit tests/i.test(await appText())) throw new Error('agent reply missing');
  });

  await check('tests quick action', async () => {
    await clickSel('[data-q="tests"]');
    await expectToast(/20 passed|20 bestanden/, 'tests');
  });
  await check('stop quick action', async () => {
    await clickSel('[data-q="stop"]');
    await expectToast(/stopped|gestoppt/, 'stop');
  });

  await check('openfile preview', async () => {
    await clickSel('[data-act="openfile"]');
    await sleep(50);
    if (!/class PaymentService/.test(await appText())) throw new Error('file preview missing');
  });

  await check('bell popover open/close', async () => {
    await clickSel('[data-act="bell"]');
    await sleep(40);
    const pop = await rawText('#bellpop');
    if (!pop || !/Activity/.test(pop)) throw new Error('bell popover missing');
    await clickSel('[data-act="bell"]');
    await sleep(40);
    if (await page.$('#bellpop')) throw new Error('bell popover stayed open');
  });

  await check('market categories', async () => {
    await clickSel('[data-act="nav"][data-view="market"]');
    await sleep(50);
    for (const cat of ['Tools', 'Skills', 'UI', 'Memory', 'Workflow']) {
      await clickSel('[data-act="cat"][data-cat="' + cat + '"]');
      await sleep(30);
      const hasGrid = await page.evaluate(() => !!document.querySelector('#marketGrid article, #marketGrid .empty'));
      if (!hasGrid) throw new Error('category ' + cat + ' has no grid');
    }
  });

  await check('market search empty result', async () => {
    await page.fill('#marketSearch', 'no-such-plugin-xyz');
    await page.keyboard.press('Enter');
    await sleep(40);
    if (!/No plugins match/.test(await appText())) throw new Error('empty search failed');
    await page.fill('#marketSearch', '');
    await sleep(40);
  });

  await check('market install/uninstall', async () => {
    await clickSel('[data-act="cat"][data-cat="Tools"]');
    await clickSel('[data-act="install"]');
    await expectToast(/installed|installiert/, 'install');
    await clickSel('[data-act="mside"][data-side="installed"]');
    await sleep(40);
    if (!/Installed/.test(await appText())) throw new Error('installed page missing');
    await clickSel('[data-act="uninstall"]');
    await expectToast(/removed|entfernt/, 'uninstall');
  });

  await check('market updates → already current', async () => {
    await clickSel('[data-act="mside"][data-side="updates"]');
    await sleep(40);
    await clickSel('[data-act="toast"]');
    await expectToast(/already current|bereits aktuell/, 'updates');
  });

  await check('market settings model menu/pick', async () => {
    await clickSel('[data-act="mside"][data-side="settings"]');
    await sleep(40);
    await clickSel('[data-act="modelmenu"]');
    await sleep(40);
    if (!(await page.$('#modelmenu'))) throw new Error('model menu missing');
    await clickSel('[data-act="modelpick"]');
    await expectToast(/Model set to|Modell auf/, 'modelpick');
    if (await page.$('#modelmenu')) throw new Error('model menu stayed open');
  });

  await check('orchestration node/collapse', async () => {
    await clickSel('[data-act="nav"][data-view="orchestration"]');
    await sleep(50);
    await clickSel('[data-act="node"][data-id="qa"]');
    await sleep(40);
    if (!(await hasOn('[data-id="qa"].on'))) throw new Error('node selection missing');
    await clickSel('[data-act="collapse"]');
    await sleep(40);
    if (!/Expand All/.test(await appText())) throw new Error('collapse failed');
    if (await page.$('.nodes')) throw new Error('layers stayed expanded');
    await clickSel('[data-act="collapse"]');
    await sleep(40);
    if (!(await page.$('.nodes'))) throw new Error('expand failed');
  });

  await check('orchestration model menu no placeholders', async () => {
    await clickSel('[data-act="modelmenu"]');
    await sleep(40);
    if (!(await page.$('#modelmenu'))) throw new Error('orchestration model menu missing');
    const menu = await rawText('#modelmenu');
    if (/DeepSeek-V4-Pro|Claude 3\.5 Sonnet/.test(menu)) throw new Error('placeholder models still listed');
    await clickSel('[data-act="modelpick"]');
    await expectToast(/gpt-6-astra|Model set to|Modell auf/, 'orch modelpick');
  });

  await check('overview sections + session goal', async () => {
    await clickSel('[data-act="nav"][data-view="overview"]');
    await sleep(50);
    const t = await appText();
    if (!/Mission Timeline/.test(t) || !/Goal Progress/.test(t) || !/Activity Feed/.test(t)) throw new Error('overview sections missing');
    if (!/Auth Token Expiry|Expire access tokens/.test(t)) throw new Error('session goal did not follow to overview');
  });

  await check('clear chat removes thread + brand home', async () => {
    await clickSel('[data-act="nav"][data-view="chat"]');
    await clickSel('[data-act="cpane"][data-pane="settings"]');
    await sleep(40);
    await clickSel('[data-act="clearchat"]');
    await expectToast(/cleared|gelöscht/, 'clearchat');
    await clickSel('[data-act="cpane"][data-pane="chat"]');
    await sleep(40);
    if (/Improve payment flow resilience/.test(await appText())) throw new Error('clear did not remove the thread');
    await clickSel('.brand');
    await sleep(40);
    if (!(await hasOn('[data-view="chat"].on'))) throw new Error('brand did not return to chat');
  });
}

// ---------- Pass 2: Discovery — jedes [data-act]/[data-q] anklicken ----------
async function collectDescs() {
  return page.evaluate(() => {
    const out = [];
    const els = document.querySelectorAll('[data-act], [data-q]');
    const sigCount = {};
    els.forEach((el) => {
      const d = el.dataset;
      let sig = d.act ? 'act=' + d.act : 'q=' + d.q;
      for (const k of ['view', 'layout', 'pane', 'id', 'q', 'model', 'side', 'cat', 'vote', 'i', 'kit', 'nr', 'path', 'msg', 'field']) {
        if (d[k] !== undefined) sig += '|' + k + '=' + d[k];
      }
      sigCount[sig] = (sigCount[sig] || 0) + 1;
    });
    els.forEach((el, idx) => {
      const d = el.dataset;
      let sig = d.act ? 'act=' + d.act : 'q=' + d.q;
      for (const k of ['view', 'layout', 'pane', 'id', 'q', 'model', 'side', 'cat', 'vote', 'i', 'kit', 'nr', 'path', 'msg', 'field']) {
        if (d[k] !== undefined) sig += '|' + k + '=' + d[k];
      }
      const key = sigCount[sig] > 1 ? sig + '#i=' + idx : sig;
      out.push({ idx, sig, key });
    });
    return out;
  });
}

async function postClickCheck(key) {
  await sleep(90);
  // leerer View?
  const len = await page.evaluate(() => {
    const el = document.getElementById('app');
    return el ? el.innerText.trim().length : -1;
  });
  if (len >= 0 && len < 40) {
    const sp = await shot('discover-empty-' + String(bugs.length).padStart(3, '0'));
    recordBug('high', 'empty view after click on ' + key + ' (innerText len=' + len + ')', sp);
  }
  // Seite noch am Leben?
  try {
    await page.evaluate(() => 1);
  } catch (e) {
    const sp = await shot('discover-crash-' + String(bugs.length).padStart(3, '0'));
    recordBug('high', 'page crashed / unresponsive after click on ' + key + ' → ' + String(e), sp);
  }
  // JS-Fehler seit letztem Klick
  if (pageErrors.length) {
    const errs = pageErrors.splice(0);
    const sp = await shot('discover-js-' + String(bugs.length).padStart(3, '0'));
    recordBug('high', 'JS error after click on ' + key + ' → ' + errs[0], sp);
  }
}

async function discoveryPass() {
  console.log('— Discovery-Pass startet —');
  for (let round = 1; round <= 6; round++) {
    const descs = await collectDescs();
    let clickedThisRound = 0;
    for (const d of descs) {
      if (discoveredKeys.has(d.key)) continue;
      discoveredKeys.add(d.key);
      // Element per Snapshot-Index klicken; wenn Signatur nicht mehr passt, überspringen
      const ok = await page.evaluate((d) => {
        const el = document.querySelectorAll('[data-act], [data-q]')[d.idx];
        if (!el) return false;
        const dd = el.dataset;
        let sig = dd.act ? 'act=' + dd.act : 'q=' + dd.q;
        for (const k of ['view', 'layout', 'pane', 'id', 'q', 'model', 'side', 'cat', 'vote', 'i', 'kit', 'nr', 'path', 'msg', 'field']) {
          if (dd[k] !== undefined) sig += '|' + k + '=' + dd[k];
        }
        if (sig !== d.sig) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }, d);
      if (!ok) continue;
      clickedThisRound++;
      clickCount++;
      await postClickCheck(d.key);
    }
    console.log('round ' + round + ': ' + clickedThisRound + ' neue Klicks (gesamt ' + clickCount + ')');
    if (clickedThisRound === 0) break;
  }
}

async function writeReport() {
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  const high = bugs.filter((b) => b.level === 'high').length;
  const medium = bugs.filter((b) => b.level === 'medium').length;
  const low = bugs.filter((b) => b.level === 'low').length;
  const overall = fail === 0 && high === 0 && medium === 0 ? 'PASS' : 'FAIL';

  let md = '# UI-Test-Report harness-pro (Web-Modus)\n\n';
  md += '**Datum:** ' + new Date().toISOString() + '  \n';
  md += '**Basis-URL:** ' + BASE + '  \n';
  md += '**Ergebnis:** ' + overall + '  \n';
  md += '**Referenz-Checks:** ' + pass + '/' + results.length + ' bestanden  \n';
  md += '**Discovery-Klicks:** ' + clickCount + ' (einzigartige Element-Schlüssel: ' + discoveredKeys.size + ')  \n';
  md += '**Bugs:** ' + bugs.length + ' (high=' + high + ', medium=' + medium + ', low=' + low + ')  \n\n';

  md += '## Bugs\n\n';
  if (!bugs.length) md += 'Keine Bugs gefunden.  \n';
  bugs.forEach((b, i) => {
    md += (i + 1) + '. **[' + b.level.toUpperCase() + ']** ' + b.msg + '  \n';
    if (b.shot) md += '   Screenshot: `' + b.shot + '`  \n';
  });

  md += '\n## Referenz-Checks\n\n| Check | Status | Detail |\n|---|---|---|\n';
  results.forEach((r) => {
    md += '| ' + r.label.replace(/\|/g, '/') + ' | ' + (r.ok ? '✅ PASS' : '❌ FAIL') + ' | ' + ((r.err || '').replace(/\n/g, ' ').replace(/\|/g, '/')) + ' |\n';
  });

  md += '\n## Konsole / Netzwerk (roh)\n\n';
  if (consoleErrors.length) {
    md += 'Konsole-Errors (' + consoleErrors.length + '):  \n';
    [...new Set(consoleErrors)].forEach((e) => { md += '- `' + e.slice(0, 200) + '`  \n'; });
  } else md += 'Keine Console-Errors.  \n';
  if (failedRequests.length) {
    md += '\nFehlgeschlagene Requests (' + failedRequests.length + '):  \n';
    [...new Set(failedRequests)].slice(0, 20).forEach((e) => { md += '- `' + e.slice(0, 200) + '`  \n'; });
  } else md += '\nKeine fehlgeschlagenen Requests.  \n';

  fs.writeFileSync(REPORT_PATH, md, 'utf8');
  console.log('\nReport geschrieben: ' + REPORT_PATH);
  console.log('ERGEBNIS: ' + overall + ' | Checks ' + pass + '/' + results.length + ' | Klicks ' + clickCount + ' | Bugs ' + bugs.length + ' (high=' + high + ' medium=' + medium + ' low=' + low + ')');
  return { overall, pass, fail, clicks: clickCount, bugs, checks: results };
}

(async () => {
  browser = await chromium.launch({ headless: true });
  ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => failedRequests.push(r.url() + ' :: ' + ((r.failure() && r.failure().errorText) || '?')));

  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('[data-act="nav"]', { timeout: 15000 });
  await sleep(500);

  await check('boot: app renders with content', async () => markEmpty('boot'));
  await check('boot: no JS errors during load', async () => {
    if (pageErrors.length) throw new Error('pageerror during boot: ' + pageErrors[0]);
  });

  await referencePass();
  await discoveryPass();

  const summary = await writeReport();
  await shot('final-full');
  await browser.close();
  // Ergebnis für Team Lead
  const bugList = summary.bugs.map((b) => '[' + b.level + '] ' + b.msg).join('\n');
  console.log('=== LEA-DUMP ===');
  console.log(JSON.stringify({ overall: summary.overall, clicks: summary.clicks, checks: summary.pass + '/' + summary.checks.length, bugs: bugList }, null, 2));
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
