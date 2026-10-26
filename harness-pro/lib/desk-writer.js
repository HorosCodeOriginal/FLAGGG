'use strict';
// desk-writer.js — einziger Schreiber für desk.json.
// Serialisiert alle Schreibvorgänge (Promise-Chain) und schreibt atomar
// (tmp + rename), damit parallele Usage-/Failover-Updates nichts überschreiben.

const fs = require('fs');
const path = require('path');

function writeJsonAtomic(fsApi, file, data) {
  return (async () => {
    const dir = path.dirname(file);
    await fsApi.promises.mkdir(dir, { recursive: true });
    const tmp = file + '.tmp.' + process.pid + '.' + Date.now();
    await fsApi.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsApi.promises.rename(tmp, file);
    return data;
  })();
}

function createDeskWriter(options) {
  const o = options || {};
  if (!o.file) throw new Error('createDeskWriter: file fehlt');
  const fsApi = o.fs || fs;
  const logger = o.logger || console;
  let chain = Promise.resolve();

  function load() {
    try {
      return JSON.parse(fsApi.readFileSync(o.file, 'utf8'));
    } catch (err) {
      return {};
    }
  }

  // alle Schreibvorgänge hintereinander ausführen
  function enqueue(task) {
    const next = chain.then(task);
    chain = next.catch(err => {
      logger.error('[desk] schreibfehler: ' + (err && err.message));
    });
    return next;
  }

  // ganzes Objekt schreiben
  function save(data) {
    return enqueue(() => writeJsonAtomic(fsApi, o.file, data));
  }

  // load -> mutieren -> atomar schreiben; fn bekommt immer den neuesten Stand.
  // Geschrieben wird das mutierte Objekt, nicht der Rueckgabewert von fn --
  // fn darf z.B. true/false als Erfolgsmeldung zurueckgeben (trackUsage).
  function mutate(fn) {
    return enqueue(async () => {
      const current = load();
      const returned = typeof fn === 'function' ? fn(current) : undefined;
      const next = returned && typeof returned === 'object' && !Array.isArray(returned)
        ? returned
        : current;
      await writeJsonAtomic(fsApi, o.file, next);
      return next;
    });
  }

  return { file: o.file, load, save, mutate };
}

module.exports = { createDeskWriter, writeJsonAtomic };
