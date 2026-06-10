@echo off
:: ============================================================
::  Giba Steam Market - launcher
::  Slug: giba-steam-market | Porta: 5260 | Log: data\app.log
::  Modos: (default|/cmd) CMD acoplado com tail | /silent
::  EuSouOGiba - youtube.com/@eusouogiba - eusouogiba.com
:: ============================================================
setlocal
set "DIR=%~dp0"
set "LOG=%DIR%data\app.log"
if not exist "%DIR%data" mkdir "%DIR%data"

if /i "%~1"=="/silent" goto silent

:cmd
echo  [Giba Steam Market] subindo em http://localhost:5260 ...
start "Giba Steam Market" /min cmd /c "cd /d "%DIR%" && node server.mjs >> "%LOG%" 2>&1"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5260"
powershell -NoProfile -Command "Get-Content '%LOG%' -Wait -Tail 30"
goto :eof

:silent
start "Giba Steam Market" /min cmd /c "cd /d "%DIR%" && node server.mjs >> "%LOG%" 2>&1"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5260"
goto :eof
