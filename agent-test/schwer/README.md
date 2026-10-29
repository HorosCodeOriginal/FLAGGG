# HTTP-Reverse-Proxy (Node.js)

Ein kleiner, funktionierender HTTP-Reverse-Proxy in reinem Node.js – **ohne externe Abhängigkeiten**, nur Standardmodule (`node:http`, `node:url`).

## Architektur

```
Client ──► Proxy (Port 8099) ──► TARGET (z. B. 127.0.0.1:9000)
              │
              ├─ 1. Rate-Limit  (Sliding Window, pro Client-IP: 10 Requests / 10 s)
              ├─ 2. Auth        (Header x-api-key muss API_KEY entsprechen)
              └─ 3. Weiterleitung (Request wird 1:1 an TARGET geschickt)
```

Der Proxy durchläuft pro Anfrage drei Stufen:

1. **Rate-Limit** – Pro Client-IP (`req.socket.remoteAddress`) wird ein Sliding-Window-Zähler geführt.
   Sind mehr als `RATE_LIMIT_MAX` Requests innerhalb `RATE_LIMIT_WINDOW_MS` eingegangen, antwortet der Proxy mit **429** und dem Header `Retry-After` (Sekunden bis zum Ablauf des ältesten Eintrags).
2. **Auth** – Stimmt der Header `x-api-key` nicht mit `API_KEY` überein, antwortet der Proxy mit **401**.
3. **Weiterleitung** – Die Anfrage wird mit Methode, Pfad und Headern (außer `Host`/`Connection`, die neu gesetzt werden) an `TARGET` weitergeleitet. Die Antwort des Ziels wird unverändert zurückgespielt. Ist das Ziel nicht erreichbar (z. B. Port geschlossen), antwortet der Proxy mit **502**.

## Starten

```bash
# Standardkonfiguration
node proxy.js

# Mit eigenen Umgebungsvariablen
PORT=8099 TARGET=http://127.0.0.1:9000 API_KEY=geheim node proxy.js
```

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
| --- | --- | --- |
| `PORT` | `8099` | Port, auf dem der Proxy lauscht. |
| `TARGET` | `http://127.0.0.1:9000` | Ziel-URL (Schema + Host + Port), an die weitergeleitet wird. |
| `API_KEY` | *(leer)* | Erwarteter Wert des `x-api-key`-Headers. Ist sie leer, ist Auth deaktiviert. |
| `RATE_LIMIT_MAX` | `10` | Maximale Anzahl Requests pro Client-IP im Fenster. |
| `RATE_LIMIT_WINDOW_MS` | `10000` | Länge des Sliding-Window-Fensters in Millisekunden. |

## Tests

```bash
node --test test-proxy.js
```

Das Testskript (auf Basis von `node:test`) setzt einen Zielserver auf Port 9000 auf, startet den Proxy und prüft:

1. Zielserver auf Port 9000 wird aufgesetzt.
2. Proxy wird gestartet.
3. **401** ohne `x-api-key`.
4. **200** mit korrektem `x-api-key` (inkl. korrekt weitergeleiteter Antwort).
5. **429** nach 11 schnellen Requests (11. Request) inkl. `Retry-After`-Header.
6. **502**, wenn `TARGET` auf einen geschlossenen Port zeigt.
