'use strict';

const { EventEmitter } = require('node:events');

/**
 * Einfacher In-Memory-Key-Value-Store mit optionaler TTL.
 * Nur Standardmodule (node:events, node:timers).
 */
class InMemoryKV extends EventEmitter {
  constructor() {
    super();
    this._entries = new Map();
  }

  /**
   * Setzt einen Wert. Bei ttlMs wird der Eintrag nach Ablauf entfernt
   * und das Event 'expired' mit dem Key emittiert.
   */
  set(key, value, ttlMs) {
    this._remove(key);

    const entry = { value, timer: null, expiryAt: null };

    if (ttlMs !== undefined && ttlMs !== null) {
      entry.expiryAt = Date.now() + ttlMs;
      entry.timer = setTimeout(() => {
        // Nur entfernen, wenn der Eintrag noch unverändert existiert.
        if (this._entries.get(key) === entry) {
          this._expire(key, entry);
        }
      }, ttlMs);
      // Timer soll den Prozess nicht am Beenden hindern.
      entry.timer.unref();
    }

    this._entries.set(key, entry);
    return this;
  }

  /**
   * Gibt den Wert zurück oder undefined, wenn fehlend/abgelaufen.
   */
  get(key) {
    const entry = this._entries.get(key);
    if (!entry) return undefined;

    // Lazy-Expiry: Falls der Timer noch nicht gefeuert hat, aber die
    // TTL bereits abgelaufen ist, hier bereinigen.
    if (entry.expiryAt !== null && Date.now() >= entry.expiryAt) {
      this._expire(key, entry);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Löscht einen Eintrag. Gibt true zurück, wenn er existierte.
   */
  del(key) {
    return this._remove(key);
  }

  /**
   * Anzahl der aktuell vorhandenen Einträge.
   */
  size() {
    return this._entries.size;
  }

  _remove(key) {
    const entry = this._entries.get(key);
    if (!entry) return false;
    this._entries.delete(key);
    if (entry.timer) clearTimeout(entry.timer);
    return true;
  }

  _expire(key, entry) {
    this._entries.delete(key);
    if (entry.timer) clearTimeout(entry.timer);
    this.emit('expired', key);
  }
}

module.exports = { InMemoryKV };
