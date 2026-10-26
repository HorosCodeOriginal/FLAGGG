'use strict';
// synthesizer.js — Attention Economy: fasst die Ergebnisse der Kind-Tasks eines
// Parents zu einem komprimierten report-Task zusammen, damit der Boss nicht im
// Rauschen untergeht. Jeder Kind-Task wird nur einmal synthetisiert.

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

// Widerspruch: gleiche Aufgabe (title) mit unterschiedlichem Ergebnis
function findContradictions(items) {
  const byTitle = new Map();
  items.forEach(item => {
    const key = item.title || item.id;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(item);
  });
  const out = [];
  byTitle.forEach((group, title) => {
    if (group.length < 2) return;
    const variants = unique(group.map(item => JSON.stringify(item.result === undefined ? null : item.result)));
    if (variants.length > 1) {
      out.push({ title, results: variants.length, ids: group.map(item => item.id) });
    }
  });
  return out;
}

// Payload-Form des Reports: total/done/failed/errors/results_summary
function buildSummary(items) {
  const errors = [];
  items.forEach(item => {
    (item.errors || []).forEach(entry => {
      const text = entry && (entry.error || entry.message);
      if (text) errors.push(String(text));
    });
  });
  return {
    total: items.length,
    done: items.filter(item => item.state === 'done').length,
    failed: items.filter(item => item.state === 'failed' || item.state === 'escalated').length,
    errors: unique(errors).slice(0, 10),
    results_summary: items.map(item => ({
      id: item.id,
      title: item.title,
      state: item.state,
      result: item.result === undefined ? null : item.result,
    })),
    contradictions: findContradictions(items),
  };
}

/**
 * synthesize(queue, parentRoleId) -> report-Task oder null
 * Holt alle erledigten Kind-Tasks (done/failed/escalated) des Parents, die noch
 * nicht synthetisiert wurden, fasst sie zusammen und legt einen report-Task an.
 * Der periodische Aufruf kommt aus dem Orchestrator (alle 30 s, Rollen mit
 * Untergebenen) — das ist der Architektur-Trigger aus dem Auftrag.
 */
async function synthesize(queue, parentRoleId, options) {
  const o = options || {};
  if (!queue || typeof queue.listUnsynthizedChildren !== 'function') {
    throw new Error('synthesize: queue unterstuetzt keine Synthese');
  }
  const rows = await queue.listUnsynthizedChildren(parentRoleId);
  const items = (rows || []).map(row => ({
    id: row.id,
    title: row.title,
    state: row.state,
    result: parseJson(row.result, null),
    errors: parseJson(row.error_history, []),
  }));
  if (!items.length) return null;

  const ids = items.map(item => item.id);
  // CAS zuerst: nur einer von parallelen Synthesizern "gewinnt" die IDs
  const claimed = await queue.markSynthesized(ids);
  if (!claimed) return null;

  const summary = buildSummary(items);
  const stableId = 'synth-' + parentRoleId + '-' + ids.slice().sort().join('_').slice(0, 96);
  const { task } = await queue.enqueue({
    type: 'report',
    title: 'Synthese: ' + parentRoleId,
    description: 'Zusammengefasster Status der Kind-Tasks',
    schema_name: 'synthesizer_report',
    payload: summary,
    source_role: 'system',
    target_role: parentRoleId,
    request_id: o.requestId || stableId,
    priority: 5,
  });

  return task;
}

module.exports = { synthesize, buildSummary, findContradictions };
