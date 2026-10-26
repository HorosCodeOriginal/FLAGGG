@echo off
rem ============================================================
rem  Starter fuer Claude Harness (Desktop-App)
rem  Startet die Electron-App aus .\claude-harness
rem ============================================================
setlocal
cd /d "%~dp0claude-harness"

rem Electron braucht echten GUI-Modus; Variable entfernen
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\.bin\electron.cmd" (
    echo Fehler: Abhaengigkeiten fehlen in claude-harness.
    echo Bitte einmalig "npm install" in .\claude-harness ausfuehren.
    pause
    exit /b 1
)

title Claude Harness
call npm start
