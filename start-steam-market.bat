@echo off
:: ============================================================
::  Giba Steam Market - launcher
::  Slug: giba-steam-market | Porta: 5260 (auto-ajusta se bloqueada)
::  Modos: (default|/cmd) CMD acoplado com tail | /silent
::  Instala o Node.js sozinho via winget se nao tiver.
::  EuSouOGiba - youtube.com/@eusouogiba - eusouogiba.com
:: ============================================================
setlocal
set "DIR=%~dp0"
set "LOG=%DIR%data\app.log"
set "NODE=node"

echo.
echo  ============================================
echo   GIBA STEAM MARKET - iniciando...
echo  ============================================
echo.

:: ---- Checagem 1: rodou de dentro do ZIP sem extrair? ----
if exist "%DIR%server.mjs" goto checknode
echo  [ERRO] Arquivos do app nao encontrados nesta pasta.
echo  Provavelmente voce abriu o .bat DE DENTRO do arquivo ZIP.
echo.
echo  COMO RESOLVER:
echo    1. Feche esta janela
echo    2. Clique com o botao DIREITO no arquivo ZIP que voce baixou
echo    3. Escolha "Extrair Tudo..." e confirme
echo    4. Abra a NOVA pasta que apareceu e de dois cliques no .bat de la
echo.
pause
exit /b 1

:: ---- Checagem 2: Node.js. Se nao tiver, instala sozinho ----
:checknode
node -v >nul 2>&1
if not errorlevel 1 goto checkwrite
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles%\nodejs\node.exe" goto checkwrite
if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"
if exist "%LocalAppData%\Programs\nodejs\node.exe" goto checkwrite

echo  O app precisa do Node.js e ele ainda nao esta neste PC.
echo  Vou instalar AUTOMATICAMENTE agora, gratis e oficial. Aguarde...
echo  ^(se o Windows abrir uma janela perguntando, clique em SIM^)
echo.
winget --version >nul 2>&1
if errorlevel 1 goto nodemanual
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles%\nodejs\node.exe" goto nodeinstalled
goto nodemanual

:nodeinstalled
echo.
echo  Node.js instalado com sucesso! Continuando...
echo.
goto checkwrite

:nodemanual
echo.
echo  [ERRO] Nao consegui instalar o Node.js automaticamente.
echo.
echo  COMO RESOLVER ^(2 minutos^):
echo    1. Vou abrir o site oficial pra voce: https://nodejs.org
echo    2. Clique no botao verde "LTS" pra baixar
echo    3. Instale clicando "Avancar / Next" ate o fim
echo    4. Rode este .bat de novo
echo.
start "" "https://nodejs.org"
pause
exit /b 1

:: ---- Checagem 3: o Windows deixa gravar nesta pasta? ----
:checkwrite
if not exist "%DIR%data" mkdir "%DIR%data" 2>nul
echo ok>"%DIR%data\.writetest" 2>nul
if exist "%DIR%data\.writetest" goto run
echo  [ERRO] Acesso negado: o Windows nao deixa o app gravar nesta pasta.
echo  Isso acontece em pastas protegidas, tipo Arquivos de Programas,
echo  raiz do C:\ ou pasta vigiada pelo antivirus/OneDrive.
echo.
echo  COMO RESOLVER:
echo    1. Feche esta janela
echo    2. Mova a pasta INTEIRA do app pra Documentos
echo       ou pra uma pasta nova tipo C:\giba-steam-market
echo    3. De dois cliques no .bat de la
echo.
pause
exit /b 1

:run
del "%DIR%data\.writetest" >nul 2>&1
type nul >> "%LOG%"

if /i "%~1"=="/silent" goto silent

:cmd
echo  Tudo certo! O navegador vai abrir SOZINHO em alguns segundos.
echo  Esta janela preta mostra o que o app esta fazendo - pode minimizar.
echo  Pra FECHAR o app: feche esta janela e a janela "Giba Steam Market".
echo.
start "Giba Steam Market" /min cmd /c "cd /d "%DIR%" && set GSM_OPEN=1&& "%NODE%" server.mjs >> "%LOG%" 2>&1"
powershell -NoProfile -Command "Get-Content '%LOG%' -Wait -Tail 30"
goto :eof

:silent
start "Giba Steam Market" /min cmd /c "cd /d "%DIR%" && set GSM_OPEN=1&& "%NODE%" server.mjs >> "%LOG%" 2>&1"
goto :eof
