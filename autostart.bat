@echo off
rem ============================================================
rem  Autostart: Docker + fr-gateway (Flagship-Router) + Apps
rem  Aufruf:  autostart.bat [none|astra|claude|pro]
rem  Default:  startet alle drei Desktop-Apps
rem ============================================================
setlocal
cd /d "%~dp0"

set APPS=
if "%1"=="" set APPS=all
if /i "%1"=="none" set APPS=none
if /i "%1"=="astra" set APPS=astra
if /i "%1"=="claude" set APPS=claude
if /i "%1"=="pro" set APPS=pro
if not defined APPS set APPS=all

echo [1/4] Pr?fe Docker ...
where docker >nul 2>nul
if errorlevel 1 ( echo Fehler: docker ist nicht im PATH. & goto :end )
docker info >nul 2>nul
if not errorlevel 1 ( echo      Docker l?uft bereits. & goto :dockerok )

echo      Starte Docker Desktop ...
set DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe
if not exist "%DOCKER_EXE%" set DOCKER_EXE=%ProgramFiles(x86)%\Docker\Docker\Docker Desktop.exe
if not exist "%DOCKER_EXE%" ( echo Fehler: Docker Desktop nicht gefunden. & goto :end )
start "" "%DOCKER_EXE%"

set /a wait=0
:waitdocker
docker info >nul 2>nul
if not errorlevel 1 ( echo      Docker bereit. & goto :dockerok )
set /a wait+=1
if %wait% geq 36 ( echo Fehler: Docker wurde nach 180s nicht bereit. & goto :end )
timeout /t 5 /nobreak >nul
goto :waitdocker

:dockerok
echo [2/4] Starte fr-gateway (Manager + Panel) ...
docker compose -f "%~dp0fr-gateway\docker-compose.yml" up -d --build
if errorlevel 1 ( echo Fehler beim Gateway-Start. & goto :end )

echo [3/4] Warte auf Panel (Port 8090) ...
set /a tries=0
:waitpanel
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8090/ | findstr /R "^200$" >nul
if not errorlevel 1 goto :panelready
set /a tries+=1
if %tries% geq 60 ( echo Warnung: Panel antwortet nicht. & goto :panelready )
timeout /t 1 /nobreak >nul
goto :waitpanel

:panelready
echo [4/4] Starte Desktop-Apps (%APPS%) ...
if /i "%APPS%"=="all" set APPS=astra claude pro
if /i not "%APPS%"=="none" for %%A in (%APPS%) do call :launch %%A
echo.
echo Fertig.
goto :end

:launch
set APP=%~1
set DIR=%~dp0
set REL=
if /i "%APP%"=="astra" set REL=astra-harness
if /i "%APP%"=="claude" set REL=claude-harness
if /i "%APP%"=="pro" set REL=harness-pro
if not defined REL ( echo Unbekannte App: %APP% & goto :eof )
if not exist "%DIR%%REL%\node_modules\.bin\electron.cmd" ( echo ?bersprungen (%REL% fehlt). & goto :eof )
pushd "%DIR%%REL%"
start "%REL%" /D "%DIR%%REL%" cmd /c "set ELECTRON_RUN_AS_NODE= && npm start"
popd
goto :eof

:end
pause
