@echo off
rem ============================================================
rem  Starter fuer Harness Pro (Desktop-App)
rem  Startet die Electron-App aus .\harness-pro
rem ============================================================
setlocal
cd /d "%~dp0harness-pro"

rem Electron braucht echten GUI-Modus; Variable entfernen
set "ELECTRON_RUN_AS_NODE="

if not exist "node_modules\.bin\electron.cmd" (
    echo Fehler: Abhaengigkeiten fehlen in harness-pro.
    echo Bitte einmalig "npm install" in .\harness-pro ausfuehren.
    pause
    exit /b 1
)

title Harness Pro
call npm start
