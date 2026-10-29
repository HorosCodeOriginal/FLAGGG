# InMemoryKV

Ein kleines Node.js-Modul (nur Standardmodule: `node:events`, `node:timers`)
für einen In-Memory-Key-Value-Store mit optionaler TTL.

## Verwendung

```js
const { InMemoryKV } = require('./index');

const kv = new InMemoryKV();

kv.set('a', 1);               // ohne TTL -> bleibt dauerhaft
kv.set('b', 2, 100);           // mit TTL 100 ms

kv.get('a');                   // 1
kv.get('unbekannt');           // undefined

kv.del('a');                   // true (wurde gelöscht)
kv.del('a');                   // false (gab es nicht mehr)

kv.size();                     // Anzahl aktueller Einträge

// Event, wenn ein Eintrag durch TTL-Ablauf entfernt wird:
kv.on('expired', (key) => console.log('abgelaufen:', key));
```

## API

| Methode | Beschreibung |
| --- | --- |
| `set(key, value, ttlMs?)` | Setzt einen Wert; optional `ttlMs` in Millisekunden. Nach Ablauf wird der Eintrag entfernt und `'expired'` mit dem Key emittiert. |
| `get(key)` | Gibt den Wert zurück oder `undefined`, wenn fehlend/abgelaufen. |
| `del(key)` | Löscht den Eintrag; `true`, wenn er vorhanden war. |
| `size()` | Anzahl aktueller Einträge. |
| `on` / `off` | Geerbt von `EventEmitter`. |

## Tests

```sh
node --test test-kv.js
```
