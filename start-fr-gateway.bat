@echo off
rem ============================================================
rem  Starter fuer fr-gateway
rem  1) Docker pruefen / starten
rem  2) Manager + Panel per docker compose starten
rem  3) auf Panel (http://127.0.0.1:8090) warten
rem  4) Panel als Desktop-App oeffnen (Electron)
rem ============================================================
setlocal
cd /d "%~dp0"

title fr-gateway

where docker >nul 2>nul
if errorlevel 1 (
    echo Fehler: docker ist nicht im PATH oder nicht installiert.
    pause
    exit /b 1
)

docker info >nul 2>nul
if not errorlevel 1 goto :dockerok

echo Docker laeuft nicht - starte Docker Desktop ...
set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "%DOCKER_EXE%" set "DOCKER_EXE=%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe"
if not exist "%DOCKER_EXE%" (
    echo Fehler: Docker Desktop nicht gefunden.
    pause
    exit /b 1
)
start "" "%DOCKER_EXE%"

set /a wait=0
:waitdocker
docker info >nul 2>nul
if not errorlevel 1 goto :dockerok
set /a wait+=1
if %wait% geq 36 (
    echo Fehler: Docker wurde nach 180s nicht bereit.
    pause
    exit /b 1
)
timeout /t 5 /nobreak >nul
goto :waitdocker

:dockerok
echo.
echo Baue und starte fr-gateway ...
docker compose -f "%~dp0fr-gateway\docker-compose.yml" up -d --build
if errorlevel 1 (
    echo Fehler beim Start. Siehe Ausgabe oben.
    pause
    exit /b 1
)

echo.
echo Container-Status:
docker compose -f "%~dp0fr-gateway\docker-compose.yml" ps

echo.
echo Warte auf Panel (http://127.0.0.1:8090) ...
set /a tries=0
:waitloop
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8090/ | findstr /R "^200$" >nul
if not errorlevel 1 goto :panelready
set /a tries+=1
if %tries% geq 60 (
    echo Warnung: Panel antwortet noch nicht, oeffne trotzdem.
    goto :panelready
)
ping -n 2 127.0.0.1 >nul
goto :waitloop

:panelready
echo.
rem Electron braucht echten GUI-Modus; Variable im Eltern-Prozess entfernen,
rem damit der gestartete Prozess sie nicht erbt.
set "ELECTRON_RUN_AS_NODE="
if exist "%~dp0fr-gateway\panel-desktop\node_modules\.bin\electron.cmd" (
    echo Oeffne Panel als Desktop-App ...
    start "fr-gateway Panel" /D "%~dp0fr-gateway\panel-desktop" cmd /c "npm start"
) else (
    echo Hinweis: Desktop-App fehlt - oeffne Panel im Standard-Browser.
    start "" "http://127.0.0.1:8090/"
)

echo.
echo Panel:   http://127.0.0.1:8090/
echo Stoppen: docker compose -f "%~dp0fr-gateway\docker-compose.yml" down
ping -n 4 127.0.0.1 >nul
