@echo off
rem ============================================================
rem  Starter fuer fr-harness (Desktop-App)
rem  Startet die Electron-App aus .\fr-harness
rem ============================================================
setlocal
cd /d "%~dp0fr-harness"

rem Electron braucht echten GUI-Modus; Variable entfernen
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\.bin\electron.cmd" (
    echo Fehler: Abhaengigkeiten fehlen in fr-harness.
    echo Bitte einmalig "npm install" in .\fr-harness ausfuehren.
    pause
    exit /b 1
)

title fr-harness
call npm start
