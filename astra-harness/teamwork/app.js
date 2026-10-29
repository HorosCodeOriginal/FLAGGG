/* ============================================================
 * MiniVault – Frontend (vanilla JS, kein Framework, kein CDN)
 * Backend-API von Agent A: http://127.0.0.1:9871
 * ============================================================ */

'use strict';

// ------------------------------------------------------------------
// API-Schicht – jede API-Interaktion hat eine eigene Funktion.
// Die vier Kernfunktionen (listVaults, createVault, openVault,
// addEntry) werden vom Integrationstest statisch geprüft.
// ------------------------------------------------------------------

const API_BASE_URL = 'http://127.0.0.1:9871';

/** Gemeinsamer fetch-Wrapper: JSON-Header, saubere Fehlermeldungen. */
async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(API_BASE_URL + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (networkError) {
    throw new Error('Server nicht erreichbar (' + API_BASE_URL + '): ' + networkError.message);
  }

  if (!res.ok) {
    let detail = res.status + ' ' + res.statusText;
    try {
      const body = await res.json();
      if (body && (body.error || body.message)) detail = body.error || body.message;
    } catch (_) { /* Antwort war kein JSON – Status genügt */ }
    throw new Error('API-Fehler ' + detail);
  }

  return res.json();
}

/** GET /api/vaults → Liste aller Tresore */
async function listVaults() {
  const data = await apiFetch('/api/vaults');
  return normalizeVaultList(data);
}

/** POST /api/vaults {name} → neuer Tresor */
async function createVault(name) {
  const data = await apiFetch('/api/vaults', {
    method: 'POST',
    body: JSON.stringify({ name: String(name).trim() }),
  });
  return data;
}

/** GET /api/vaults/:id → Tresor mit Einträgen */
async function openVault(id) {
  const data = await apiFetch('/api/vaults/' + encodeURIComponent(id));
  return normalizeVaultDetail(data, id);
}

/** POST /api/vaults/:id/entries {title, username, secret} → neuer Eintrag */
async function addEntry(vaultId, entry) {
  const data = await apiFetch('/api/vaults/' + encodeURIComponent(vaultId) + '/entries', {
    method: 'POST',
    body: JSON.stringify({
      title: String(entry.title || '').trim(),
      username: String(entry.username || '').trim(),
      secret: String(entry.secret || ''),
    }),
  });
  return data;
}

// ------------------------------------------------------------------
// Normalisierung der Antwortformen (tolerant gegenüber Backend-Varianten)
// ------------------------------------------------------------------

function normalizeVaultList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.vaults)) return data.vaults;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function normalizeVaultDetail(data, id) {
  const vault = (data && data.vault) || data || {};
  const entries = vault.entries || data.entries || vault.items || [];
  return { id: String(vault.id ?? id), name: vault.name || 'Tresor', entries: entries };
}

// ------------------------------------------------------------------
// UI-Zustand & DOM-Referenzen
// ------------------------------------------------------------------

const state = {
  vaults: [],
  currentVault: null,   // { id, name, entries }
  currentVaultId: null,
  secrets: new Map(),    // entryId -> Secret (nur im Speicher, nie im DOM)
  shownSecrets: new Set(),
};

const els = {
  errorBanner: document.getElementById('error-banner'),
  errorText: document.getElementById('error-text'),
  errorClose: document.getElementById('error-close'),
  vaultsSection: document.getElementById('vaults-section'),
  vaultsList: document.getElementById('vaults-list'),
  vaultsStatus: document.getElementById('vaults-status'),
  createForm: document.getElementById('create-vault-form'),
  newVaultName: document.getElementById('new-vault-name'),
  detailSection: document.getElementById('detail-section'),
  detailHeading: document.getElementById('detail-heading'),
  backBtn: document.getElementById('back-btn'),
  entryForm: document.getElementById('add-entry-form'),
  entryTitle: document.getElementById('entry-title'),
  entryUsername: document.getElementById('entry-username'),
  entrySecret: document.getElementById('entry-secret'),
  entriesList: document.getElementById('entries-list'),
  entriesStatus: document.getElementById('entries-status'),
};

// ------------------------------------------------------------------
// Fehler & Status
// ------------------------------------------------------------------

function showError(message) {
  els.errorText.textContent = message;
  els.errorBanner.hidden = false;
  window.clearTimeout(showError._timer);
  showError._timer = window.setTimeout(() => { els.errorBanner.hidden = true; }, 8000);
}

function setStatus(el, text, isError) {
  if (!text) { el.hidden = true; el.textContent = ''; return; }
  el.textContent = text;
  el.classList.toggle('error', Boolean(isError));
  el.hidden = false;
}

// ------------------------------------------------------------------
// Rendern: Tresor-Liste
// ------------------------------------------------------------------

function renderVaultList() {
  els.vaultsList.textContent = '';

  if (state.vaults.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Noch keine Tresore vorhanden. Lege den ersten an!';
    li.style.gridColumn = '1 / -1';
    els.vaultsList.appendChild(li);
    return;
  }

  for (const vault of state.vaults) {
    const id = String(vault.id ?? '');
    const name = vault.name || 'Ohne Namen';

    const li = document.createElement('li');
    li.className = 'vault-card';

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'vault-name';
    nameEl.textContent = name;
    const metaEl = document.createElement('div');
    metaEl.className = 'vault-meta';
    const count = vault.entryCount ?? vault.entries?.length;
    metaEl.textContent = count != null ? count + ' Eintrag/Einträge'.replace('Eintrag/Einträge', count === 1 ? 'Eintrag' : 'Einträge') : 'ID ' + id;

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn-ghost';
    openBtn.textContent = 'Öffnen';
    openBtn.addEventListener('click', () => onOpenVault(id));

    info.appendChild(nameEl);
    info.appendChild(metaEl);
    li.appendChild(info);
    li.appendChild(openBtn);
    els.vaultsList.appendChild(li);
  }
}

// ------------------------------------------------------------------
// Rendern: Detailansicht mit Einträgen
// ------------------------------------------------------------------

function renderVaultDetail() {
  const vault = state.currentVault;
  els.detailHeading.textContent = vault.name;
  els.entriesList.textContent = '';
  setStatus(els.entriesStatus, '');

  if (vault.entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'Dieser Tresor ist noch leer. Füge den ersten Eintrag hinzu.';
    els.entriesList.appendChild(li);
    return;
  }

  for (const entry of vault.entries) {
    const entryId = String(entry.id ?? Math.random().toString(36).slice(2));
    const title = entry.title || 'Ohne Titel';
    const username = entry.username || '';
    const secret = entry.secret != null ? String(entry.secret) : '';

    state.secrets.set(entryId, secret);

    const li = document.createElement('li');
    li.className = 'entry-row';

    const titleEl = document.createElement('div');
    titleEl.className = 'entry-title';
    titleEl.textContent = title;

    const usernameEl = document.createElement('div');
    usernameEl.className = 'entry-username';
    usernameEl.textContent = username ? 'Benutzername: ' + username : '';

    const secretLine = document.createElement('div');
    secretLine.className = 'secret-line';

    const secretValue = document.createElement('span');
    secretValue.className = 'secret-value';
    secretValue.textContent = '••••••••';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn-secret';
    toggleBtn.textContent = 'zeigen';
    toggleBtn.setAttribute('aria-pressed', 'false');

    toggleBtn.addEventListener('click', () => {
      const nowShown = state.shownSecrets.has(entryId);
      if (nowShown) {
        state.shownSecrets.delete(entryId);
        secretValue.textContent = '••••••••';
        toggleBtn.textContent = 'zeigen';
        toggleBtn.setAttribute('aria-pressed', 'false');
      } else {
        state.shownSecrets.add(entryId);
        secretValue.textContent = state.secrets.get(entryId) || '';
        toggleBtn.textContent = 'verbergen';
        toggleBtn.setAttribute('aria-pressed', 'true');
      }
    });

    secretLine.appendChild(secretValue);
    secretLine.appendChild(toggleBtn);

    li.appendChild(titleEl);
    li.appendChild(usernameEl);
    li.appendChild(secretLine);
    els.entriesList.appendChild(li);
  }
}

// ------------------------------------------------------------------
// Ereignisse & Abläufe
// ------------------------------------------------------------------

function showDetailView() {
  els.vaultsSection.hidden = true;
  els.detailSection.hidden = false;
}

function showOverviewView() {
  els.detailSection.hidden = true;
  els.vaultsSection.hidden = false;
}

function onOpenVault(id) {
  setStatus(els.vaultsStatus, '');
  state.currentVaultId = id;

  openVault(id)
    .then((vault) => {
      state.currentVault = vault;
      state.shownSecrets.clear();
      state.secrets.clear();
      renderVaultDetail();
      showDetailView();
    })
    .catch((err) => {
      showError(err.message);
      showOverviewView();
    });
}

function refreshVaults() {
  setStatus(els.vaultsStatus, 'Lade Tresore …');
  listVaults()
    .then((vaults) => {
      state.vaults = vaults;
      setStatus(els.vaultsStatus, '');
      renderVaultList();
    })
    .catch((err) => {
      setStatus(els.vaultsStatus, 'Tresore konnten nicht geladen werden.', true);
      showError(err.message);
    });
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------

function init() {
  els.errorClose.addEventListener('click', () => { els.errorBanner.hidden = true; });

  els.createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = els.newVaultName.value.trim();
    if (!name) return;

    const submitBtn = els.createForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    createVault(name)
      .then(() => {
        els.newVaultName.value = '';
        refreshVaults();
      })
      .catch((err) => showError(err.message))
      .finally(() => { submitBtn.disabled = false; });
  });

  els.backBtn.addEventListener('click', () => {
    state.currentVault = null;
    state.currentVaultId = null;
    state.shownSecrets.clear();
    state.secrets.clear();
    refreshVaults();
    showOverviewView();
  });

  els.entryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.currentVaultId) return;

    const title = els.entryTitle.value.trim();
    const secret = els.entrySecret.value;
    if (!title || !secret) return;

    const submitBtn = els.entryForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    addEntry(state.currentVaultId, {
      title: title,
      username: els.entryUsername.value.trim(),
      secret: secret,
    })
      .then(() => {
        els.entryForm.reset();
        return onOpenVault(state.currentVaultId);
      })
      .catch((err) => showError(err.message))
      .finally(() => { submitBtn.disabled = false; });
  });

  refreshVaults();
}

document.addEventListener('DOMContentLoaded', init);
