@echo off
rem ============================================================
rem  Starter fuer Astra Harness (Desktop-App)
rem  Startet die Electron-App aus .\astra-harness
rem ============================================================
setlocal
cd /d "%~dp0astra-harness"

rem Electron braucht echten GUI-Modus; Variable entfernen
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\.bin\electron.cmd" (
    echo Fehler: Abhaengigkeiten fehlen in astra-harness.
    echo Bitte einmalig "npm install" in .\astra-harness ausfuehren.
    pause
    exit /b 1
)

title Astra Harness
call npm start
