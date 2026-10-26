# language: python3, file: app.py, runtime: fastapi + uvicorn + docker-py
# fr-panel — FastAPI-backend: fleet-status, websocket-push, keys add/revoke, limit-set, logs.
import asyncio
import datetime
import hashlib
import hmac
import http.client
import json
import os
import re
from pathlib import Path

import docker
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE = Path("/app")
SECRETS = BASE / "secrets"
KEYS_FILE = BASE / "keys_raw.txt"
REGISTRY_FILE = SECRETS / "registry.json"
LOG_ROOT = BASE / "logs" / "gateways"
DATA_ROOT = BASE / "data"
NETWORK_NAME = os.environ.get("NETWORK_NAME", "fr-gateway_default")
GATEWAY_IMAGE = os.environ.get("GATEWAY_IMAGE", "fr-gateway:latest")
PORT_START = int(os.environ.get("PORT_START", "20129"))
DEFAULT_LIMIT = int(os.environ.get("DEFAULT_LIMIT", "2000000"))
UPSTREAMS_FILE = Path(os.environ.get("UPSTREAMS_FILE", "/app/upstreams.json"))
ASTRA_COUNT = int(os.environ.get("ASTRA_COUNT", "22"))
DOMAIN = b"fkl/key/"

app = FastAPI(title="fr-panel")
client = docker.from_env()
app.mount("/static", StaticFiles(directory="/app/static"), name="static")

PANEL_TOKEN = os.environ.get("PANEL_TOKEN", "")
PANEL_ORIGINS = [o.strip() for o in os.environ.get(
    "PANEL_ORIGINS",
    "http://127.0.0.1:8090,http://localhost:8090",
).split(",") if o.strip()]
CONTAINER_RE = re.compile(r"^fr-key-[0-9a-f]{12}$")
PORT_SPAN = 128

# CORS nur fuer die App-Shell (Loopback). Kein "*": sonst kann jede Webseite
# im Browser die Panel-API lesen/aufrufen.
app.add_middleware(
    CORSMiddleware,
    allow_origins=PANEL_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "x-panel-token"],
)


def mask_key(key) -> str:
    value = str(key or "")
    if not value:
        return ""
    if len(value) < 10:
        return "•••"
    return value[:6] + "••••" + value[-4:]


def _supplied_token(request: Request) -> str:
    return (request.headers.get("x-panel-token")
            or request.cookies.get("panel_token")
            or request.query_params.get("token", "")
            or "")


def require_token(request: Request) -> None:
    """Shared-Secret-Schutz fuer /api/*. Ohne PANEL_TOKEN bleibt das Panel offen
    (Dev-Modus) - der Stack setzt den Token in docker-compose, sobald vorhanden."""
    if not PANEL_TOKEN:
        return
    supplied = _supplied_token(request)
    if not supplied or not hmac.compare_digest(supplied, PANEL_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.middleware("http")
async def panel_token_cookie(request: Request, call_next):
    response = await call_next(request)
    if PANEL_TOKEN and request.query_params.get("token"):
        supplied = _supplied_token(request)
        if supplied and hmac.compare_digest(supplied, PANEL_TOKEN):
            response.set_cookie("panel_token", supplied, httponly=True, samesite="strict")
    return response


def entry_by_port(reg, port):
    return next((e for e in reg if e.get("port") == int(port)), None)


def fleet_entry(port):
    """Nur Ports im Fleet-Bereich UND mit Registry-Eintrag (kein SSRF auf fremde
    Loopback-Dienste)."""
    try:
        p = int(port)
    except Exception:
        return None
    if p < PORT_START or p >= PORT_START + PORT_SPAN:
        return None
    return entry_by_port(load_registry(), p)


def gw_conn(port):
    # gateway-container liegen auf host-ports; vom panel-container aus über host.docker.internal,
    # fallback loopback.
    for host in ("host.docker.internal", "127.0.0.1"):
        try:
            conn = http.client.HTTPConnection(host, int(port), timeout=8)
            conn.connect()
            return conn, host
        except Exception:
            continue
    return None, None


class AddKeysBody(BaseModel):
    keys: list[str]


class ChatProxyBody(BaseModel):
    port: int
    messages: list
    model: str | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None


class RevokeBody(BaseModel):
    key_hash: str


class LimitBody(BaseModel):
    port: int
    limit: int


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def log(msg, level="info"):
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    line = "[%s] [%s] %s" % (ts, level, msg)
    print(line, flush=True)
    try:
        lp = Path("/var/log/fr-gateway/panel.log")
        lp.parent.mkdir(parents=True, exist_ok=True)
        with lp.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def read_keys():
    if not KEYS_FILE.exists():
        return []
    out = []
    for ln in KEYS_FILE.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            out.append(ln)
    return out


def write_keys(keys):
    KEYS_FILE.write_text("\n".join(keys) + "\n", encoding="utf-8")


def key_hash(key):
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def container_name(key):
    return "fr-key-" + key_hash(key)[:12]


def load_secret():
    p = SECRETS / ".secret"
    if p.exists():
        b = p.read_bytes()[:32]
        if len(b) == 32:
            return b
    s = os.urandom(32)
    SECRETS.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(s)
    return s


def derive(secret, raw):
    d = hmac.new(secret, DOMAIN + raw.encode(), hashlib.sha256).digest()
    import base64
    return "vkd-" + base64.urlsafe_b64encode(d).rstrip(b"=").decode("ascii")


def load_registry():
    if not REGISTRY_FILE.exists():
        return []
    try:
        data = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception as e:
        log("registry defekt: %s" % e, "error")
    return []


def save_registry(reg):
    SECRETS.mkdir(parents=True, exist_ok=True)
    tmp = REGISTRY_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(reg, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(str(tmp), str(REGISTRY_FILE))


def get_container(name):
    try:
        return client.containers.get(name)
    except docker.errors.NotFound:
        return None
    except Exception:
        return None


def _status(name):
    c = get_container(name)
    if c is None:
        return "absent"
    if c.status == "running":
        return "running"
    return "stopped"


def read_usage(name):
    c = get_container(name)
    if c is None:
        return 0
    try:
        rc, out = c.exec_run("cat /var/lib/fr-gateway-counter/counter.json")
        if rc == 0:
            return int(json.loads(out.decode("utf-8")).get("tokens", 0))
    except Exception:
        pass
    return 0


def write_counter_file(name, payload):
    c = get_container(name)
    if c is None:
        return False
    import base64
    b64 = base64.b64encode(payload.encode("utf-8")).decode("ascii")
    try:
        rc, _ = c.exec_run(["sh", "-c",
                            "echo %s | base64 -d > /var/lib/fr-gateway-counter/counter.json" % b64])
        return rc == 0
    except Exception:
        return False


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def reset_at_iso():
    now = datetime.datetime.now(datetime.timezone.utc)
    return (now + datetime.timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    ).isoformat()


def uptime_seconds(name):
    c = get_container(name)
    if c is None:
        return 0
    try:
        started = c.attrs["State"]["StartedAt"]
        st = datetime.datetime.fromisoformat(started.replace("Z", "+00:00"))
        return max(0, int((datetime.datetime.now(datetime.timezone.utc) - st).total_seconds()))
    except Exception:
        return 0


def next_free_port(reg):
    used = {e.get("port") for e in reg if e.get("port")}
    try:
        for c in client.containers.list(all=False):
            for _, bindings in (c.attrs.get("NetworkSettings", {}) or {}).get("Ports", {}).items():
                for b in bindings or []:
                    try:
                        used.add(int(b.get("HostPort")))
                    except Exception:
                        pass
    except Exception:
        pass
    for p in range(PORT_START, PORT_START + 128):
        if p not in used:
            return p
    return None


# ---------------------------------------------------------------------------
# fleet aggregation
# ---------------------------------------------------------------------------

def aggregate_fleet():
    reg = load_registry()
    keys = read_keys()
    pos_of = {key_hash(k): i + 1 for i, k in enumerate(keys)}

    entries = []
    for e in reg:
        cont = e.get("container", "")
        state = _status(cont)
        if state == "running":
            st = "running"
        elif state == "stopped":
            st = "stopped"
        elif e.get("state") == "removed":
            st = "removed"
        else:
            st = "absent"
        entries.append({
            "nr": pos_of.get(e["key_hash"], "-"),
            "port": e.get("port"),
            "container": cont,
            "name": mask_key(e.get("raw_key", "")),
            "raw_key_present": bool(e.get("raw_key")),
            "family": e.get("model_family", "?"),
            "state": st,
            "tokens": read_usage(cont),
            "limit": e.get("limit_override") or DEFAULT_LIMIT,
            "reset_at": reset_at_iso(),
            "uptime": uptime_seconds(cont),
            "unique_key": e.get("unique_key", ""),
        })
    entries.sort(key=lambda x: (x["nr"] == "-", x["nr"] if isinstance(x["nr"], int) else 10 ** 9))
    return entries


def aggregate_stats(entries):
    running = [e for e in entries if e["state"] == "running"]
    total_tokens = sum(e["tokens"] for e in running)
    n = len(running)
    return {
        "total_containers": len(entries),
        "active": len(running),
        "astra": sum(1 for e in entries if e["family"] == "astra" and e["state"] == "running"),
        "opus": sum(1 for e in entries if e["family"] == "opus" and e["state"] == "running"),
        "total_tokens_today": total_tokens,
        "avg_tokens_per_container": (total_tokens // n) if n else 0,
        "uptime_seconds": (max((e["uptime"] for e in running), default=0)) if running else 0,
    }


# ---------------------------------------------------------------------------
# http endpoints
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index():
    return (Path("/app/static/index.html")).read_text(encoding="utf-8")


@app.get("/api/fleet", dependencies=[Depends(require_token)])
async def api_fleet():
    return aggregate_fleet()


@app.get("/api/stats", dependencies=[Depends(require_token)])
async def api_stats():
    return aggregate_stats(aggregate_fleet())


@app.post("/api/keys/add", dependencies=[Depends(require_token)])
async def api_add(body: AddKeysBody):
    keys = read_keys()
    reg = load_registry()
    secret = load_secret()
    added = []
    ports = []
    uniqs = []
    for raw in body.keys:
        raw = raw.strip()
        if not raw or raw in keys:
            continue
        keys.append(raw)
        added.append(raw)
        uniqs.append(derive(secret, raw))
        p = next_free_port(reg)
        ports.append(p)
    if not added:
        return JSONResponse({"added": 0, "ports": [], "unique_keys": []})
    write_keys(keys)
    log("keys add: %d angehaengt" % len(added))
    return {
        "added": len(added),
        "ports": ports,
        "unique_keys": uniqs,
    }


def extract_hash(h):
    reg = load_registry()
    for e in reg:
        if e["key_hash"].startswith(h.lower()):
            return e
    return None


@app.post("/api/keys/revoke", dependencies=[Depends(require_token)])
async def api_revoke(body: RevokeBody):
    entry = extract_hash(body.key_hash)
    if entry is None:
        return JSONResponse({"error": "key nicht gefunden"}, status_code=404)
    keys = read_keys()
    keys = [k for k in keys if key_hash(k) != entry["key_hash"]]
    write_keys(keys)
    c = get_container(entry["container"])
    stopped = ""
    if c is not None:
        try:
            c.stop(timeout=10)
            c.remove()
            stopped = entry["container"]
        except Exception as e:
            log("revoke remove fehlgeschlagen: %s" % e, "error")
    reg = [e for e in load_registry() if e["key_hash"] != entry["key_hash"]]
    save_registry(reg)
    return {"revoked": entry["key_hash"], "container": stopped or entry["container"]}


@app.post("/api/limit/set", dependencies=[Depends(require_token)])
async def api_limit(body: LimitBody):
    reg = load_registry()
    for e in reg:
        if e.get("port") == body.port:
            old = e.get("limit_override") or DEFAULT_LIMIT
            e["limit_override"] = body.limit
            save_registry(reg)
            c = get_container(e["container"])
            if c is not None:
                try:
                    c.stop(timeout=10)
                    c.remove()
                except Exception as ex:
                    log("limit set stop/remove fehlgeschlagen: %s" % ex, "error")
                # container wird vom naechsten manager-watch mit neuem limit neu erstellt
            return {"port": body.port, "old_limit": old, "new_limit": body.limit}
    return JSONResponse({"error": "port nicht in registry"}, status_code=404)


@app.post("/api/limit/reset", dependencies=[Depends(require_token)])
async def api_limit_reset(body: RevokeBody):
    entry = extract_hash(body.key_hash)
    if entry is None:
        return JSONResponse({"error": "key nicht gefunden"}, status_code=404)
    payload = json.dumps({
        "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "tokens": 0,
        "updated_at": now_iso(),
    })
    ok = write_counter_file(entry["container"], payload)
    return {"reset": entry["container"], "ok": ok}


# ---------------------------------------------------------------------------
# upstream-pool (failover): konfiguration + health je eintrag
# ---------------------------------------------------------------------------

def load_upstreams():
    """upstreams.json lesen (Reihenfolge = Prioritaet)."""
    try:
        data = json.loads(UPSTREAMS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    ups = data.get("upstreams") if isinstance(data, dict) else data
    if not isinstance(ups, list):
        return []
    return [u for u in ups if isinstance(u, dict) and u.get("url")]


def probe_upstream(url, key):
    """GET <url>/models: (ok, http-status, fehlertext). https wird per TLS geprueft."""
    try:
        import urllib.parse
        p = urllib.parse.urlparse(url)
        path = (p.path or "").rstrip("/") + "/models"
        headers = {}
        if key:
            headers["Authorization"] = "Bearer " + key
        if p.scheme == "https":
            conn = http.client.HTTPSConnection(p.hostname, p.port or 443, timeout=6)
        else:
            conn = http.client.HTTPConnection(p.hostname, p.port or 80, timeout=6)
        conn.request("GET", path, headers=headers)
        r = conn.getresponse()
        body = r.read().decode("utf-8", "replace")
        conn.close()
        if r.status == 200:
            return True, r.status, ""
        return False, r.status, body[:120]
    except Exception as ex:
        return False, 0, str(ex)[:120]


@app.get("/api/upstreams", dependencies=[Depends(require_token)])
async def api_upstreams():
    reg = load_registry()
    key = reg[0]["unique_key"] if reg else ""
    out = []
    for u in load_upstreams():
        health, status, error = await asyncio.to_thread(probe_upstream, u["url"], u.get("key") or key)
        out.append({
            "name": u.get("name") or u["url"],
            "url": u["url"],
            "enabled": u.get("enabled", True) is not False,
            "healthy": health,
            "status": status,
            "error": error,
        })
    return {"upstreams": out}


# ---------------------------------------------------------------------------
# gateway-proxy (für browser-basierte mockups ohne CORS-probleme)
# ---------------------------------------------------------------------------

@app.get("/api/gateway/models", dependencies=[Depends(require_token)])
async def gw_models(port: int):
    e = fleet_entry(port)
    if e is None:
        return JSONResponse({"error": "port nicht im fleet-bereich/registry"}, status_code=404)
    conn, host = gw_conn(port)
    if conn is None:
        return JSONResponse({"error": "gateway nicht erreichbar (host-gateway)"}, status_code=502)
    try:
        conn.request("GET", "/v1/models", headers={"Authorization": "Bearer " + e["unique_key"]})
        r = conn.getresponse()
        body = r.read().decode("utf-8", "replace")
        conn.close()
        if r.status != 200:
            return JSONResponse({"error": body[:200]}, status_code=r.status)
        data = json.loads(body).get("data", [])
        return {"models": [m["id"] for m in data if isinstance(m, dict) and m.get("id")]}
    except Exception as ex:
        return JSONResponse({"error": str(ex)}, status_code=502)


@app.post("/api/gateway/chat", dependencies=[Depends(require_token)])
async def gw_chat(req: ChatProxyBody):
    e = fleet_entry(req.port)
    if e is None:
        return JSONResponse({"error": "port nicht im fleet-bereich/registry"}, status_code=404)
    payload = {"messages": req.messages, "stream": True}
    if req.model:
        payload["model"] = req.model
    if req.temperature is not None:
        payload["temperature"] = req.temperature
    if req.top_p is not None:
        payload["top_p"] = req.top_p
    if req.max_tokens is not None:
        payload["max_tokens"] = req.max_tokens

    conn, host = gw_conn(e["port"])
    if conn is None:
        return JSONResponse({"error": "gateway nicht erreichbar (host-gateway)"}, status_code=502)
    try:
        conn.request(
            "POST", "/v1/chat/completions",
            body=json.dumps(payload),
            headers={"Authorization": "Bearer " + e["unique_key"], "Content-Type": "application/json"},
        )
        resp = conn.getresponse()
    except Exception as ex:
        return JSONResponse({"error": "gateway nicht erreichbar: " + str(ex)}, status_code=502)

    async def gen():
        try:
            if resp.status != 200:
                b = resp.read().decode("utf-8", "replace")
                yield json.dumps({"type": "error", "status": resp.status, "message": b[:300]})
                return
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                yield chunk.decode("utf-8", "replace")
        finally:
            conn.close()

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/logs/{container}", dependencies=[Depends(require_token)])
async def api_logs(container: str):
    # nur echte Fleet-Containernamen: verhindert Pfad-Traversal ueber ../..
    if not CONTAINER_RE.match(container or ""):
        return JSONResponse({"error": "ungueltiger container-name"}, status_code=400)
    lines = []
    for fn in ("error.log", "nginx.log"):
        p = LOG_ROOT / container / fn
        if p.exists():
            lines.extend(p.read_text(encoding="utf-8", errors="replace").splitlines()[-200:])
    return {"container": container, "lines": lines}


# ---------------------------------------------------------------------------
# websocket
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    # gleiche Token-Pruefung wie /api/* (Query, Cookie oder Header)
    if PANEL_TOKEN:
        supplied = (ws.query_params.get("token")
                    or ws.cookies.get("panel_token")
                    or ws.headers.get("x-panel-token", "")
                    or "")
        if not supplied or not hmac.compare_digest(supplied, PANEL_TOKEN):
            await ws.close(code=1008)
            return
    await ws.accept()
    try:
        while True:
            entries = aggregate_fleet()
            stats = aggregate_stats(entries)
            await ws.send_text(json.dumps({
                "type": "fleet",
                "data": entries,
                "stats": stats,
                "ts": now_iso(),
            }))
            await asyncio.sleep(3)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
