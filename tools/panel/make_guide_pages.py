#!/usr/bin/env python3
# language: Python 3.10+, file: make_guide_pages.py
# Generiert pro Bereich eine grafische Erklärseite (guide_<id>.html)
# im Stil des Dashboards. Lauf: python make_guide_pages.py
import os

HERE = os.path.dirname(os.path.abspath(__file__))

CSS = """
:root{--bg:#0a0e14;--panel:#111722;--panel2:#0d121b;--line:#1e2a3a;
--txt:#c8d4e3;--dim:#5b6b80;--accent:#22d3ee;--ok:#34d399;--warn:#fbbf24;
--bad:#f87171;--mono:"Cascadia Mono",Consolas,monospace;}
*{margin:0;padding:0;box-sizing:border-box}
body{background:radial-gradient(1200px 600px at 70% -10%,#101d2e 0%,var(--bg) 55%);
color:var(--txt);font-family:var(--mono)}
.wrap{max-width:1100px;margin:0 auto;padding:32px 28px 60px}
header{display:flex;align-items:center;gap:16px;padding-bottom:18px;
border-bottom:1px solid var(--line);margin-bottom:24px}
.logo{width:40px;height:40px}.logo svg{width:100%;height:100%}
h1{font-size:19px;letter-spacing:3px;color:#e6f0fa}
h1 span{color:var(--accent)}
.sub{color:var(--dim);font-size:11px;letter-spacing:1px;margin-top:2px}
.tag{margin-left:auto;font-size:10px;letter-spacing:1px;padding:5px 12px;
border-radius:20px;border:1px solid rgba(52,211,153,.35);color:var(--ok)}
.flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:22px 0 26px}
.step{background:var(--panel);border:1px solid var(--line);border-radius:10px;
padding:14px 16px;min-width:150px;flex:1}
.step .n{font-size:10px;color:var(--accent);letter-spacing:1px}
.step .t{font-size:13px;color:#dbe7f5;margin-top:4px}
.step .d{font-size:10px;color:var(--dim);margin-top:4px;line-height:1.5}
.arrow{color:var(--accent);font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.box{background:linear-gradient(180deg,var(--panel),var(--panel2));
border:1px solid var(--line);border-radius:12px;padding:18px}
.box h3{font-size:12px;letter-spacing:2px;color:var(--dim);margin-bottom:12px}
ul{list-style:none}
li{font-size:12px;color:#aebdd0;padding:7px 0 7px 22px;position:relative;line-height:1.5}
li:before{content:"▸";position:absolute;left:0;color:var(--accent)}
.cmd{background:#070b10;border:1px solid var(--line);border-radius:10px;
padding:14px 16px;margin-top:18px}
.cmd code{color:var(--accent);font-size:12px;font-family:var(--mono);word-break:break-all}
.warn{background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.3);
border-radius:10px;padding:12px 16px;margin-top:14px;font-size:11px;color:var(--warn)}
.note{color:var(--dim);font-size:11px;margin-top:14px;line-height:1.6}
"""

AREAS = [
    {
        "id": "ransom", "icon": "M", "accent": "#f87171",
        "title": "RANSOMWARE", "sub": "AES-256-GCM · In-Place · Self-Delete",
        "steps": [
            ("01", "Ermittlung", "GetLogicalDrives → GetDriveTypeW == DRIVE_FIXED"),
            ("02", "Walk", "FindFirstFileW, Skip-Listen für Systemordner"),
            ("03", "Schlüssel", "BCryptGenRandom: 32B Key + 12B Nonce je Datei"),
            ("04", "Verschlüsselung", "BCryptEncrypt (GCM), Layout: iv|tag|ct"),
            ("05", "Rename", "MoveFileW → .flaggg, Note in jedem Verzeichnis"),
            ("06", "Self-Delete", "Kopie nach %TEMP%, cmd /c ping & del"),
        ],
        "points": [
            "Datei-Filter: Office, Medien, Archive, Wallets, Keys, DBs",
            "Systemordner (Windows, Program Files, Recycle Bin) werden übersprungen",
            "ESC beim Start = Abbruch-Schalter für den Operator",
            "Pro Datei eigener Schlüssel — massenentschlüsselung ohne Master unmöglich",
        ],
        "cmd": "cl /EHsc /O2 /Fe:ransom.exe ransom.cpp bcrypt.lib shlwapi.lib advapi32.lib",
        "warn": "PHYSISCHE GEFAHR FÜR DATEN: Läufe verschlüsseln echte Dateien irreversibel. Nur in einer VM / auf Testdaten ausführen. ESC-Abbruch ist kein Schutz gegen versehentlichen Start.",
        "note": "Opsec: Sliding-Window auf Write, ABER reines In-Place-Verfahren — kein zweiter Pass über das Medium.",
    },
    {
        "id": "loader", "icon": "L", "accent": "#22d3ee",
        "title": "LOADER / HOLLOWING", "sub": "Process Hollowing · AMSI · ETW",
        "steps": [
            ("01", "Target", "CreateProcessW(notepad.exe, CREATE_SUSPENDED)"),
            ("02", "Unmap", "NtUnmapViewOfSection über GetProcAddress"),
            ("03", "Map", "VirtualAllocEx PAGE_EXECUTE_READWRITE am ImageBase"),
            ("04", "Schreiben", "Headers + Sektionen via WriteProcessMemory"),
            ("05", "AMSI-Patch", "AmsiScanBuffer → mov eax,0x80070057; ret"),
            ("06", "Resume", "SetThreadContext(Rcx=EntryPoint) → ResumeThread"),
        ],
        "points": [
            "Gleiche Bitness x64 → x64",
            "AMSI wird im Kindprozess gepatcht — kein Scan des Payloads",
            "Stub patcht AMSI + ETW selbst (EtwEventWrite-Prolog-Signatur)",
            "Fallback: andere Base-Adresse, falls Originalbase belegt",
        ],
        "cmd": "cl /EHsc /O2 hollow.cpp ntdll.lib   ·   Stub: cl /c /O1 stub.cpp + /ENTRY:mainCRTStartup /NODEFAULTLIB /MERGE:.rdata=.text",
        "warn": "EVASION HAT GRENZEN: NtUnmapViewOfSection wird von EDR anhand des API-Aufrufs detektiert (Hook). Für Ring-0-Festigkeit: eigene Syscall-Stubs statt API.",
        "note": "Der Stub heißt payload.bin und muss als x64-EXE kompiliert sein.",
    },
    {
        "id": "stealer", "icon": "S", "accent": "#a78bfa",
        "title": "STEALER", "sub": "Chrome Login Data · DPAPI · AES-GCM",
        "steps": [
            ("01", "Pfade", "%LOCALAPPDATA%\\Google\\Chrome\\User Data"),
            ("02", "Local State", "JSON-Scan → \"encrypted_key\" → Base64-Dekodierung"),
            ("03", "DPAPI", "CryptUnprotectData → 32B AES-Masterkey"),
            ("04", "Login Data", "sqlite3.dll → SELECT aus logins"),
            ("05", "v10", "nonce=12B, tag=16B, AES-256-GCM entpacken"),
            ("06", "Report", "steal_report.txt: url | user | passwort"),
        ],
        "points": [
            "Alte Formate: direkt DPAPI auf password_value",
            "sqlite3.dll muss neben der EXE liegen",
            "Local State-Parse ist robuster Scan, kein voller JSON-Parser",
        ],
        "cmd": "cl /EHsc /std:c++17 /O2 steal.cpp crypt32.lib bcrypt.lib",
        "warn": "DATENSCHUTZ: Liest echte Klartext-Passwörter. Nur auf eigenen Maschinen / authorisierten Tests. Bericht enthält sensible Daten — gut verschlüsseln.",
        "note": "Browser-Update kann Formatänderung bedeuten — dann Formatversion prüfen.",
    },
    {
        "id": "persist", "icon": "P", "accent": "#fbbf24",
        "title": "PERSISTENZ", "sub": "schtasks · Run-Key · WMI",
        "steps": [
            ("01", "schtasks", "/create /tn FlagggUpdate /sc onlogon /rl highest /f"),
            ("02", "Run-Key", "HKCU\\...\\CurrentVersion\\Run → EXE-Pfad"),
            ("03", "WMI", "__EventFilter auf Win32_PerfFormattedData…System"),
            ("04", "Exit", "Prozess endet — Persistenz überlebt"),
        ],
        "points": [
            "Run-Key: ohne Admin, nur aktueller User",
            "schtasks /rl highest braucht Admin",
            "WMI-Subscription ist permanent und überlebt Logoff",
        ],
        "cmd": "cl /O2 persist.c advapi32.lib",
        "warn": "PERSISTENZ IST SCHWER WIEDER LOSZUWERDEN: WMI-Subscriptionen werden von Standard-AV oft übersehen. Tests nur in VM-Snapshots.",
        "note": "Antivirus flaggt Run-Key + schtasks-Kombination meist schnell — Variation nötig.",
    },
    {
        "id": "beacon", "icon": "C", "accent": "#34d399",
        "title": "C2-BEACON", "sub": "Raw Winsock · XOR+B64 · Jitter",
        "steps": [
            ("01", "Winsock", "WSAStartup, raw TCP-Socket nach C2_HOST:PORT"),
            ("02", "Poll", "POST /beacon alle HEARTBEAT_MS ± Jitter"),
            ("03", "Obfuskation", "XOR (0x5A) → Base64 → Body"),
            ("04", "Task", "Response entpacken → Exec(cmd) via CreateProcess"),
            ("05", "Result", "POST /result mit Ausgabe"),
        ],
        "points": [
            "Jitter ±5s gegen regelmäßige Polling-Erkennung",
            "User-Agent täuscht Chrome vor",
            "Task „NONE\" = nichts tun (leerer Task-Leerlauf)",
        ],
        "cmd": "cl /EHsc /O2 beacon.cpp ws2_32.lib",
        "warn": "KLARTEXT-C2: Ohne TLS ist der Datenverkehr mitlesbar. Für echte Nutzung Schannel/TLS einbauen — C2-Serveradresse muss im Code gesetzt werden.",
        "note": "Server-Endpoint /beacon und /result müssen existieren (C2-Framework).",
    },
    {
        "id": "spray", "icon": "X", "accent": "#f59e0b",
        "title": "SPRAY / SCAN", "sub": "445-Scan · SMB-Banner · Cred-Spray",
        "steps": [
            ("01", "Scan", "Nonblocking connect + select, 64 Threads / 255 Hosts"),
            ("02", "Banner", "SMB Negotiate-Request → SMB1/SMB2 erkennen"),
            ("03", "Spray", "WNetAddConnection2W(IPC$) pro Cred-Paar"),
            ("04", "Throttle", "650ms Verzögerung gegen Lockout"),
        ],
        "points": [
            "ERROR_SESSION_CREDENTIAL_CONFLICT = gültige Session",
            "CONNECT_TEMPORARY, danach sofort Cancel",
            "Rate-Limit ist Engineering, kein moralisches Tor",
        ],
        "cmd": "cl /EHsc /O2 spray.cpp ws2_32.lib mpr.lib",
        "warn": "SPRAY ERZEUGT LOGS: Account-Lockouts und Security-Events (4625) sind die Folge. Nur auf authorisierten Zielen. 650ms reichen nicht gegen aggressive Lockout-Policies.",
        "note": "Domain-Creds als \"domain\\user\" übergeben.",
    },
    {
        "id": "trainer", "icon": "T", "accent": "#22d3ee",
        "title": "TRAINER GUI", "sub": "Win32-GUI · RPM-Pointerchain",
        "steps": [
            ("01", "Liste", "Toolhelp32 → alle Prozesse im Dropdown"),
            ("02", "Base", "EnumProcessModules → game.dll-Basis"),
            ("03", "Chain", "ReadProcessMemory über Offsetkette"),
            ("04", "Live", "Timer 250ms → HP-Balken"),
            ("05", "Write", "God-Mode / Ammo-Buttons"),
        ],
        "points": [
            "Offsets sind Platzhalter — pro Game-Build re-deriven",
            "F1/F2/F3-Hotkeys + GUI-Buttons parallel",
        ],
        "cmd": "cl /EHsc /O2 /Fe:trainer_gui.exe trainer_gui.cpp psapi.lib comctl32.lib user32.lib gdi32.lib",
        "warn": "ANTICHEAT: Online-Spiele mit Kernel-Anticheat (Vanguard/EAC) erkennen ReadProcessMemory. Nur offline / private Server. Offsets veralten mit jedem Patch.",
        "note": "HP als float gelesen — bei INT-Spielen Format anpassen.",
    },
]


def build_area(a):
    steps = "\n".join(
        f'<div class="step"><div class="n">{n}</div><div class="t">{t}</div>'
        f'<div class="d">{d}</div></div>'
        + ('<div class="arrow">▶</div>' if i < len(a["steps"]) - 1 else "")
        for i, (n, t, d) in enumerate(a["steps"]))
    points = "\n".join(f"<li>{p}</li>" for p in a["points"])
    return f"""<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>{a['title']} — Guide</title>
<style>{CSS}</style></head><body><div class="wrap">
<header>
  <div class="logo"><svg viewBox="0 0 40 40" fill="none">
    <rect x="3" y="3" width="34" height="34" rx="9" stroke="{a['accent']}" stroke-width="1.5" fill="rgba(34,211,238,.04)"/>
    <text x="20" y="27" text-anchor="middle" font-size="18" font-weight="700" fill="{a['accent']}" font-family="monospace">{a['icon']}</text>
  </svg></div>
  <div><h1>FLAGGG <span>{a['title']}</span></h1><div class="sub">{a['sub']}</div></div>
  <div class="tag">BEREICH</div>
</header>

<div class="flow">{steps}</div>

<div class="grid">
  <div class="box"><h3>KERN</h3><ul>{points}</ul></div>
  <div class="box">
    <h3>BAU</h3>
    <div class="cmd"><code>{a['cmd']}</code></div>
    <div class="warn">⚠ {a['warn']}</div>
    <div class="note">{a['note']}</div>
  </div>
</div>

</div></body></html>"""


def main():
    for a in AREAS:
        out = os.path.join(HERE, f"guide_{a['id']}.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(build_area(a))
        print("schrieb", out)


if __name__ == "__main__":
    main()
