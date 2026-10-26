(async function () {
  window.__UITEST = true;
  if (window.api && window.api.astra) {
    const info = await window.api.astra.info();
    if (!info || !info.ok || info.family !== 'astra') throw new Error('astra token missing');
    if (!info.masked || info.masked.indexOf('…') < 0) throw new Error('astra token was not masked');
    if (info.unique_key || info.raw_key) throw new Error('astra secret leaked to the app');
    const envs = await window.api.dashboard.listEnvs();
    if (envs && envs.length) throw new Error('app received more than one api');
    const fleet = await window.api.dashboard.getFleet();
    if (!fleet || !fleet.error) throw new Error('fleet api leaked into the app');
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('missing ' + sel);
    el.click();
  };
  const text = () => document.getElementById('app').innerText;
  const toastEl = () => document.getElementById('toast');
  const expectToast = async (pattern) => {
    const start = Date.now();
    while (Date.now() - start < 1200) {
      const el = toastEl();
      if (el && !el.hidden && pattern.test(el.textContent || '')) return el.textContent;
      await sleep(40);
    }
    throw new Error('toast missing ' + pattern + ' got ' + (toastEl() && toastEl().textContent));
  };

  await sleep(350);
  if (document.querySelector('[data-view="workspace"]') || document.querySelector('.workspace')) {
    throw new Error('removed IDE view is still present');
  }

  const views = ['chat', 'orchestration', 'overview', 'market'];
  for (const view of views) {
    click('[data-act="nav"][data-view="' + view + '"]');
    await sleep(30);
    if (text().length < 40) throw new Error(view + ' rendered empty');
    if (!document.querySelector('[data-act="nav"][data-view="' + view + '"].on')) throw new Error(view + ' nav not active');
  }

  click('[data-act="nav"][data-view="chat"]');
  await sleep(20);
  for (const layout of ['thread', 'phases', 'code', 'studio']) {
    click('[data-act="layout"][data-layout="' + layout + '"]');
    await sleep(20);
    if (!document.querySelector('[data-layout="' + layout + '"].on')) throw new Error('layout ' + layout + ' not active');
  }
  for (const pane of ['tasks', 'memory', 'knowledge', 'agents', 'settings', 'chat']) {
    click('[data-act="cpane"][data-pane="' + pane + '"]');
    await sleep(20);
    if (!document.querySelector('[data-pane="' + pane + '"].on')) throw new Error('pane ' + pane + ' not active');
  }
  if (!document.getElementById('composer')) throw new Error('composer missing on chat');

  click('[data-act="step"]');
  await sleep(20);
  if (!/20%/.test(text())) throw new Error('step toggle did not update progress');

  click('[data-act="cpane"][data-pane="tasks"]');
  await sleep(20);
  click('[data-act="plan"]');
  if (!/Tasks/.test(text())) throw new Error('plan toggle left tasks');

  click('[data-act="cpane"][data-pane="chat"]');
  click('[data-act="layout"][data-layout="phases"]');
  await sleep(20);
  click('[data-act="reason"]');
  await sleep(20);
  if (!/session cookies|reset handler|login route/.test(text())) throw new Error('reasoning did not expand');

  click('[data-act="layout"][data-layout="studio"]');
  await sleep(20);
  click('[data-act="like"][data-vote="up"]');
  await sleep(20);
  if (!document.querySelector('[data-vote="up"].on')) throw new Error('like did not stick');

  click('[data-act="layout"][data-layout="code"]');
  await sleep(20);
  click('[data-act="copy"]');
  await expectToast(/Copied/);

  click('[data-act="layout"][data-layout="studio"]');
  click('[data-act="session"][data-id="bug187"]');
  await expectToast(/BUG-187/);

  const composer = () => document.getElementById('composer');
  const beforeBlank = text();
  composer().value = '   ';
  document.getElementById('composerForm').requestSubmit();
  await sleep(80);
  if (text() !== beforeBlank) throw new Error('blank message changed the thread');

  click('[data-q="pause"]');
  await expectToast(/paused/);
  composer().value = 'this must not send while paused';
  document.getElementById('composerForm').requestSubmit();
  await sleep(80);
  if (/this must not send while paused/.test(text())) throw new Error('paused agent still accepted a message');
  click('[data-q="pause"]');
  await expectToast(/resumed/);

  composer().value = 'Add tests for the payment flow';
  document.getElementById('composerForm').requestSubmit();
  await sleep(900);
  if (!/unit tests/i.test(text())) throw new Error('agent reply missing');

  click('[data-q="tests"]');
  await expectToast(/20 passed/);
  click('[data-q="stop"]');
  await expectToast(/stopped/);

  click('[data-act="openfile"]');
  await sleep(30);
  if (!/class PaymentService/.test(text())) throw new Error('file preview missing');

  click('[data-act="bell"]');
  await sleep(20);
  if (!document.getElementById('bellpop') || !/Activity/.test(document.getElementById('bellpop').innerText)) throw new Error('bell popover missing');
  click('[data-act="bell"]');
  await sleep(20);
  if (document.getElementById('bellpop')) throw new Error('bell popover stayed open');

  click('[data-act="nav"][data-view="market"]');
  await sleep(30);
  for (const cat of ['Tools', 'Skills', 'UI', 'Memory', 'Workflow']) {
    click('[data-act="cat"][data-cat="' + cat + '"]');
    await sleep(20);
    if (!document.querySelector('#marketGrid article, #marketGrid .empty')) throw new Error('category ' + cat + ' has no grid');
  }
  const search = document.getElementById('marketSearch');
  search.value = 'no-such-plugin-xyz';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(20);
  if (!/No plugins match/.test(text())) throw new Error('empty search failed');
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(20);
  click('[data-act="cat"][data-cat="Tools"]');
  click('[data-act="install"]');
  await expectToast(/installed/);
  click('[data-act="mside"][data-side="installed"]');
  await sleep(20);
  if (!/Installed/.test(text())) throw new Error('installed page missing');
  click('[data-act="uninstall"]');
  await expectToast(/removed/);
  click('[data-act="mside"][data-side="updates"]');
  await sleep(20);
  click('[data-act="toast"]');
  await expectToast(/already current/);
  click('[data-act="mside"][data-side="settings"]');
  await sleep(20);
  click('[data-act="modelmenu"]');
  await sleep(20);
  if (!document.getElementById('modelmenu')) throw new Error('model menu missing');
  click('[data-act="modelpick"]');
  await expectToast(/Model set to/);
  if (document.getElementById('modelmenu')) throw new Error('model menu stayed open');

  click('[data-act="nav"][data-view="orchestration"]');
  await sleep(30);
  click('[data-act="node"][data-id="qa"]');
  await sleep(20);
  if (!document.querySelector('[data-id="qa"].on')) throw new Error('node selection missing');
  click('[data-act="collapse"]');
  await sleep(20);
  if (!/Expand All/.test(text())) throw new Error('collapse failed');
  if (document.querySelector('.nodes')) throw new Error('layers stayed expanded');
  click('[data-act="collapse"]');
  await sleep(20);
  if (!document.querySelector('.nodes')) throw new Error('expand failed');
  click('[data-act="modelmenu"]');
  await sleep(20);
  if (!document.getElementById('modelmenu')) throw new Error('orchestration model menu missing');
  if (/DeepSeek-V4-Pro|Claude 3\.5 Sonnet/.test(document.getElementById('modelmenu').innerText)) throw new Error('placeholder models still listed');
  click('[data-act="modelpick"]');
  await expectToast(/gpt-6-astra|Model set to/);

  click('[data-act="nav"][data-view="overview"]');
  await sleep(30);
  if (!/Mission Timeline/.test(text()) || !/Goal Progress/.test(text()) || !/Activity Feed/.test(text())) {
    throw new Error('overview sections missing');
  }
  if (!/Auth Token Expiry|Expire access tokens/.test(text())) throw new Error('session goal did not follow to overview');

  click('[data-act="nav"][data-view="chat"]');
  click('[data-act="cpane"][data-pane="settings"]');
  await sleep(20);
  click('[data-act="clearchat"]');
  await expectToast(/cleared/);
  click('[data-act="cpane"][data-pane="chat"]');
  await sleep(20);
  if (/Improve payment flow resilience/.test(text())) throw new Error('clear did not remove the thread');
  click('[data-act="brand"], .brand');
  await sleep(20);
  if (!document.querySelector('[data-view="chat"].on')) throw new Error('brand did not return to chat');

  return 'loop views, layouts, panes, chat, market, orchestration, overview ok';
})()
