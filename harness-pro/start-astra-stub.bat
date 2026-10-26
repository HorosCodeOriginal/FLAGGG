@echo off
rem start-astra-stub.bat -- startet die Astra Harness live mit Stub-Transport.
rem Stub = deterministischer Agenten-Transport (Queue, Canvas, Tools, Self-Healing
rem laufen ohne LLM-Upstream). Fuer echtes LLM: ASTRA_TRANSPORT=real setzen.
setlocal
set ASTRA_TRANSPORT=stub
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" .
endlocal
