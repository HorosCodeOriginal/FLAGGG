#!/usr/bin/env python3
# language: python3, file: manager.py, runtime: python:3.12-slim + docker-py
# fr-gateway v3 manager — startet 44+ gateway-container via docker-api, kein systemd.
import argparse
import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import secrets as pysecrets
import socket
import sys
import time

import docker

KEYS_FILE = os.environ.get("KEYS_FILE", "/app/keys_raw.txt")
REGISTRY_FILE = os.environ.get("REGISTRY_FILE", "/app/secrets/registry.json")
SECRETS_DIR = os.environ.get("SECRETS_DIR", "/app/secrets")
PORT_START = int(os.environ.get("PORT_START", "20129"))
PORT_SPAN = 128
DEFAULT_LIMIT = int(os.environ.get("DEFAULT_LIMIT", "2000000"))
RESET_TZ = os.environ.get("RESET_TZ", "UTC")
WATCH_INTERVAL = int(os.environ.get("WATCH_INTERVAL", "30"))
UPSTREAM_URL = os.environ.get("UPSTREAM_URL", "http://host.docker.internal:20128/v1")
UPSTREAMS_FILE = os.environ.get("UPSTREAMS_FILE", "/app/upstreams.json")
NETWORK_NAME = os.environ.get("NETWORK_NAME", "fr-gateway_default")
GATEWAY_IMAGE = os.environ.get("GATEWAY_IMAGE", "fr-gateway:latest")
GATEWAY_BUILD_CONTEXT = os.environ.get("GATEWAY_BUILD_CONTEXT", "/app/gateway")
DATA_ROOT = os.environ.get("DATA_ROOT", "/var/lib/gateways")
LOG_ROOT = os.environ.get("LOG_ROOT", "/var/log/gateways")
MANAGER_LOG = "/var/log/fr-gateway/manager.log"
DOMAIN = b"fkl/key/"

client = docker.from_env()


def log(msg, level="info"):
    ts = datetime.datetime.now(datetime.timezone.utc).isoformat()
    line = "[%s] [%s] %s" % (ts, level, msg)
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(MANAGER_LOG), exist_ok=True)
        with open(MANAGER_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# keys / keycloak
# ---------------------------------------------------------------------------

def read_keys():
    if not os.path.exists(KEYS_FILE):
        return []
    out = []
    with open(KEYS_FILE, "r", encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                out.append(ln)
    return out


def write_keys(keys):
    with open(KEYS_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(keys) + "\n")


def key_hash(key):
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def container_name(key):
    return "fr-key-" + key_hash(key)[:12]


# ---------------------------------------------------------------------------
# upstream-pool (failover)
# ---------------------------------------------------------------------------

def load_upstreams():
    """upstreams.json lesen: geordnete Liste, Reihenfolge = Prioritaet."""
    try:
        with open(UPSTREAMS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        log("upstreams nicht lesbar (%s): %s" % (UPSTREAMS_FILE, e), "warn")
        return []
    ups = data.get("upstreams") if isinstance(data, dict) else data
    if not isinstance(ups, list):
        return []
    out = []
    for u in ups:
        if isinstance(u, dict) and u.get("url") and u.get("enabled", True):
            out.append({
                "name": u.get("name") or u["url"],
                "url": u["url"],
                "enabled": True,
                "key": u.get("key") or "",
            })
    return out


def upstreams_json(ups):
    return json.dumps(ups, separators=(",", ":"), sort_keys=True)


def upstreams_hash(ups):
    return hashlib.sha256(upstreams_json(ups).encode("utf-8")).hexdigest()[:16]


def upstream_endpoints(ups):
    """erste drei aktive upstreams als host:port (index 0 = primary)."""
    eps = []
    for u in ups:
        m = re.match(r"^https?://([^/]+)", u.get("url", ""))
        if m:
            eps.append(m.group(1))
    if not eps:
        eps = [UPSTREAM_URL.split("://", 1)[-1].split("/", 1)[0]]
    while len(eps) < 3:
        eps.append(eps[-1])
    return eps[:3]


def upstream_keys(ups, fallback):
    """erste drei upstream-keys (index 0 = primary); fallback = key des containers."""
    keys = [u.get("key") or fallback for u in ups if u.get("url")]
    if not keys:
        keys = [fallback]
    while len(keys) < 3:
        keys.append(keys[-1])
    return keys[:3]


def load_secret():
    p = os.path.join(SECRETS_DIR, ".secret")
    if os.path.exists(p):
        with open(p, "rb") as f:
            b = f.read(32)
        if len(b) == 32:
            return b
    s = pysecrets.token_bytes(32)
    os.makedirs(SECRETS_DIR, exist_ok=True)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(s)
    return s


def derive(secret, raw):
    d = hmac.new(secret, DOMAIN + raw.encode(), hashlib.sha256).digest()
    return "vkd-" + base64.urlsafe_b64encode(d).rstrip(b"=").decode("ascii")


def write_keycloak_outputs(secret, keys):
    out = {}
    toks = []
    for k in keys:
        t = derive(secret, k)
        out[t] = k
        toks.append(t)
    os.makedirs(SECRETS_DIR, exist_ok=True)
    with open(os.path.join(SECRETS_DIR, "keys_unique.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(toks) + "\n")
    with open(os.path.join(SECRETS_DIR, "keys.map.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    return toks


# ---------------------------------------------------------------------------
# registry
# ---------------------------------------------------------------------------

def load_registry():
    if not os.path.exists(REGISTRY_FILE):
        return []
    try:
        with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except Exception as e:
        log("registry defekt: %s" % e, "error")
    return []


def save_registry(reg):
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    tmp = REGISTRY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, REGISTRY_FILE)


# ---------------------------------------------------------------------------
# docker
# ---------------------------------------------------------------------------

def _exists(name):
    try:
        client.containers.get(name)
        return True
    except docker.errors.NotFound:
        return False
    except Exception:
        return False


def _running(name):
    try:
        return client.containers.get(name).status == "running"
    except Exception:
        return False


def next_free_port(reg):
    used = set()
    for e in reg:
        if e.get("port"):
            used.add(e["port"])
    try:
        for c in client.containers.list(all=False):
            ports = (c.attrs.get("NetworkSettings", {}) or {}).get("Ports") or {}
            for _, bindings in ports.items():
                if bindings:
                    for b in bindings:
                        try:
                            used.add(int(b.get("HostPort")))
                        except Exception:
                            pass
    except Exception:
        pass
    for p in range(PORT_START, PORT_START + PORT_SPAN):
        if p not in used:
            return p
    return None


def ensure_gateway_image():
    try:
        client.images.get(GATEWAY_IMAGE)
        return True
    except docker.errors.ImageNotFound:
        pass
    log("baue image %s aus %s" % (GATEWAY_IMAGE, GATEWAY_BUILD_CONTEXT))
    try:
        client.images.build(path=GATEWAY_BUILD_CONTEXT, tag=GATEWAY_IMAGE, rm=True)
        return True
    except Exception as e:
        log("image build fehlgeschlagen: %s" % e, "error")
        return False


def start_container(entry, raw_key):
    name = entry["container"]
    logroot = os.path.join(LOG_ROOT, name)
    dataroot = os.path.join(DATA_ROOT, name)
    os.makedirs(logroot, exist_ok=True)
    os.makedirs(dataroot, exist_ok=True)

    eps = upstream_endpoints(load_upstreams())
    keys = upstream_keys(load_upstreams(), raw_key)
    env = {
        "UPSTREAM_URL": UPSTREAM_URL,
        "UPSTREAM_API_KEY": raw_key,
        "CLIENT_API_KEY": entry.get("unique_key", ""),
        "DAILY_TOKEN_LIMIT": str(entry.get("limit_override") or DEFAULT_LIMIT),
        "RESET_TZ": RESET_TZ,
        "MODEL_FAMILY": entry.get("model_family", "?"),
        "UPSTREAM_PRIMARY_HOSTPORT": eps[0],
        "UPSTREAM_BACKUP1_HOSTPORT": eps[1],
        "UPSTREAM_BACKUP2_HOSTPORT": eps[2],
        "UPSTREAM_KEY_PRIMARY": keys[0],
        "UPSTREAM_KEY_BACKUP1": keys[1],
        "UPSTREAM_KEY_BACKUP2": keys[2],
    }

    if _exists(name):
        try:
            c = client.containers.get(name)
            if c.status != "running":
                c.start()
                log("container %s wieder gestartet" % name)
            return True
        except Exception as e:
            log("start fehlgeschlagen (%s): %s" % (name, e), "error")
            return False

    # benannte volumes: unabhängig vom host-bind-mount des managers, ueberleben restarts
    data_vol = "fr-data-" + name
    log_vol = "fr-logs-" + name
    try:
        client.containers.run(
            image=GATEWAY_IMAGE,
            name=name,
            detach=True,
            ports={"80/tcp": entry["port"]},
            environment=env,
            volumes={
                data_vol: {"bind": "/var/lib/fr-gateway-counter", "mode": "rw"},
                log_vol: {"bind": "/var/log/nginx", "mode": "rw"},
            },
            network=NETWORK_NAME,
            restart_policy={"Name": "unless-stopped"},
        )
        log("container %s gestartet auf :%d (family=%s)" % (
            name, entry["port"], entry.get("model_family", "?")))
        return True
    except docker.errors.APIError as e:
        low = str(e).lower()
        if "address already in use" in low or "port is already allocated" in low:
            newp = next_free_port([])
            if newp is not None:
                log("port %d belegt, nehme %d" % (entry["port"], newp), "warn")
                entry["port"] = newp
                return start_container(entry, raw_key)
        log("start fehlgeschlagen (%s): %s" % (name, e), "error")
        return False


def stop_remove(name):
    try:
        c = client.containers.get(name)
        c.stop(timeout=10)
        c.remove()
        log("container %s gestoppt und entfernt" % name)
        return True
    except docker.errors.NotFound:
        return True
    except Exception as e:
        log("remove fehlgeschlagen (%s): %s" % (name, e), "error")
        return False


# ---------------------------------------------------------------------------
# watch
# ---------------------------------------------------------------------------

def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def astra_count_for(keys):
    """Familien-Grenze: ASTRA_COUNT (env) oder erste Haelfte der Keys.
    Deployte Fleet nutzt 22 astra (Keys 1-22), Rest opus."""
    override = os.environ.get("ASTRA_COUNT", "").strip()
    if override.isdigit():
        return int(override)
    return len(keys) // 2


def watch_once():
    keys = read_keys()
    reg = load_registry()
    by_hash = {e["key_hash"]: e for e in reg}
    secret = load_secret()
    toks = write_keycloak_outputs(secret, keys)
    uniq_for = dict(zip(keys, toks))

    astra_count = astra_count_for(keys)
    ups_hash = upstreams_hash(load_upstreams())
    changed = False

    for pos, raw in enumerate(keys, 1):
        h = key_hash(raw)
        fam = "astra" if pos <= astra_count else "opus"
        if h not in by_hash:
            entry = {
                "nr": pos,
                "key_hash": h,
                "port": None,
                "container": container_name(raw),
                "raw_key": raw,
                "unique_key": uniq_for[raw],
                "model_family": fam,
                "created": now_iso(),
                "limit_override": None,
                "state": "new",
                "upstreams_hash": ups_hash,
            }
            p = next_free_port(reg)
            if p is None:
                log("kein freier port fuer %s" % h, "error")
                continue
            entry["port"] = p
            if start_container(entry, raw):
                entry["state"] = "running"
                reg.append(entry)
                by_hash[h] = entry
                changed = True
        else:
            e = by_hash[h]
            e["nr"] = pos
            e["unique_key"] = uniq_for[raw]
            e["model_family"] = fam
            if e.get("upstreams_hash") != ups_hash:
                # upstream-pool geaendert: container mit neuer config neu erstellen
                log("upstream-pool geaendert, erstelle %s neu" % e["container"])
                stop_remove(e["container"])
                if start_container(e, raw):
                    e["state"] = "running"
                    e["upstreams_hash"] = ups_hash
                    changed = True
            elif _exists(e["container"]):
                if not _running(e["container"]):
                    log("container gestoppt, starte neu: %s" % e["container"])
                    start_container(e, raw)
            else:
                log("container fehlt, starte neu: %s" % e["container"])
                if start_container(e, raw):
                    e["upstreams_hash"] = ups_hash
                    changed = True

    present = set(key_hash(k) for k in keys)
    for h in set(by_hash) - present:
        e = by_hash[h]
        if _exists(e["container"]):
            if stop_remove(e["container"]):
                e["state"] = "removed"
                changed = True

    if changed:
        save_registry(reg)
    return len(reg)


# ---------------------------------------------------------------------------
# status / reset
# ---------------------------------------------------------------------------

def read_usage(name):
    if not _exists(name):
        return 0
    try:
        c = client.containers.get(name)
        rc, out = c.exec_run("cat /var/lib/fr-gateway-counter/counter.json")
        if rc == 0:
            d = json.loads(out.decode("utf-8"))
            return int(d.get("tokens", 0))
    except Exception:
        pass
    return 0


def write_counter_file(name, payload):
    if not _exists(name):
        return False
    b64 = base64.b64encode(payload.encode("utf-8")).decode("ascii")
    cmd = "echo %s | base64 -d > /var/lib/fr-gateway-counter/counter.json" % b64
    try:
        c = client.containers.get(name)
        rc, _ = c.exec_run(["sh", "-c", cmd])
        return rc == 0
    except Exception:
        return False


def cmd_status():
    reg = load_registry()
    keys = read_keys()
    pos_of = {key_hash(k): i + 1 for i, k in enumerate(keys)}
    now = datetime.datetime.now(datetime.timezone.utc)
    reset_iso = (now + datetime.timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    ).isoformat()

    rows = []
    for e in sorted(reg, key=lambda x: pos_of.get(x["key_hash"], 10 ** 9)):
        cont = e.get("container", "-")
        if _running(cont):
            state = "running"
        elif _exists(cont):
            state = "stopped"
        elif e.get("state") == "removed":
            state = "removed"
        else:
            state = "absent"
        rows.append((
            str(pos_of.get(e["key_hash"], "-")),
            e.get("key_hash", "-")[:16],
            str(e.get("port", "-")),
            cont,
            state,
            e.get("model_family", "?"),
            str(read_usage(cont)),
            str(e.get("limit_override") or DEFAULT_LIMIT),
            reset_iso,
        ))

    header = ("nr", "key-hash", "port", "container", "state", "family",
              "tokens-heute", "limit", "reset-zeitpunkt")
    widths = [max(len(header[i]), max((len(r[i]) for r in rows), default=0)) for i in range(len(header))]
    fmt = " | ".join("{:<%d}" % w for w in widths)
    print(fmt.format(*header))
    print("-" * (sum(widths) + 3 * (len(header) - 1)))
    for r in rows:
        print(fmt.format(*r))
    print()
    total = sum(read_usage(e.get("container", "")) for e in reg)
    print("eintraege=%d keys=%d tokens-heute-gesamt=%d" % (len(reg), len(keys), total))


def find_by_nr(reg, nr):
    for e in reg:
        if e.get("nr") == nr:
            return e
    return None


def cmd_reset(args):
    reg = load_registry()
    e = find_by_nr(reg, args.nr)
    if e is None:
        print("kein eintrag mit nr=%d" % args.nr, file=sys.stderr)
        return 1
    value = args.tokens if args.tokens is not None else 0
    payload = json.dumps({
        "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"),
        "tokens": value,
        "updated_at": now_iso(),
    })
    if write_counter_file(e["container"], payload):
        print("counter %s auf %d gesetzt" % (e["container"], value))
        return 0
    print("reset fehlgeschlagen (%s)" % e.get("container"), file=sys.stderr)
    return 1


# ---------------------------------------------------------------------------
# add / remove
# ---------------------------------------------------------------------------

def cmd_add(key):
    keys = read_keys()
    if key in keys:
        print("key existiert bereits", file=sys.stderr)
        return 1
    keys.append(key)
    write_keys(keys)
    print("key angehaengt, starte watch-durchlauf")
    watch_once()
    return 0


def cmd_remove(hash_prefix):
    reg = load_registry()
    target = None
    for e in reg:
        if e["key_hash"].startswith(hash_prefix):
            target = e
            break
    if target is None:
        print("kein key mit hash-prefix %s" % hash_prefix, file=sys.stderr)
        return 1
    keys = read_keys()
    keys = [k for k in keys if key_hash(k) != target["key_hash"]]
    write_keys(keys)
    if stop_remove(target["container"]):
        reg = [e for e in reg if e["key_hash"] != target["key_hash"]]
        save_registry(reg)
        print("key %s entfernt" % target["container"])
        return 0
    return 1


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(prog="fr-manager")
    sub = ap.add_subparsers(dest="cmd")

    p_watch = sub.add_parser("watch", help="watch-loop (default)")
    p_watch.add_argument("--once", action="store_true")

    p_add = sub.add_parser("add", help="key anhaengen")
    p_add.add_argument("key")

    p_rm = sub.add_parser("remove", help="key per hash-prefix entfernen")
    p_rm.add_argument("hash")

    p_status = sub.add_parser("status", help="status-tabelle")

    p_reset = sub.add_parser("reset", help="counter setzen")
    p_reset.add_argument("nr", type=int)
    p_reset.add_argument("--tokens", type=int, default=None, help="wert (default 0)")

    args = ap.parse_args()

    if args.cmd == "add":
        return cmd_add(args.key)
    if args.cmd == "remove":
        return cmd_remove(args.hash)
    if args.cmd == "status":
        cmd_status()
        return 0
    if args.cmd == "reset":
        return cmd_reset(args)

    # watch (default)
    if not ensure_gateway_image():
        log("image nicht verfuegbar, abbrechen", "error")
        return 1
    log("fr-manager v3 watch laeuft (interval=%ds)" % WATCH_INTERVAL)
    while True:
        try:
            n = watch_once()
            log("watch-durchlauf fertig, registry=%d eintraege" % n)
        except Exception as e:
            log("watch iteration fehler: %s" % e, "error")
        time.sleep(WATCH_INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
