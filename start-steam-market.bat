@echo off
:: ============================================================
::  Giba Steam Market - launcher
::  Slug: giba-steam-market | Porta: 5260 (auto-ajusta se bloqueada)
::  Modos: (default|/cmd) CMD acoplado com tail | /silent
::  EuSouOGiba - youtube.com/@eusouogiba - eusouogiba.com
:: ============================================================
setlocal
set "DIR=%~dp0"
set "LOG=%DIR%data\app.log"

:: ---- Checagem 1: rodou de dentro do ZIP sem extrair? ----
if not exist "%DIR%server.mjs" (
  echo.
  echo  [ERRO] Arquivos do app nao encontrados nesta pasta.
  echo  Provavelmente voce abriu o .bat DE DENTRO do arquivo ZIP.
  echo.
  echo  SOLUCAO: clique com o botao direito no ZIP, escolha "Extrair Tudo...",
  echo  abra a pasta extraida e de dois cliques no .bat de la.
  echo.
  pause
  exit /b 1
)

:: ---- Checagem 2: Node.js instalado? ----
node -v >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [ERRO] Node.js nao encontrado neste PC.
  echo.
  echo  SOLUCAO: baixe a versao LTS em https://nodejs.org , instale
  echo  clicando Avancar ate o fim e REINICIE o PC antes de rodar de novo.
  echo  Vou abrir o site pra voce...
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

:: ---- Checagem 3: o Windows deixa gravar nesta pasta? ----
if not exist "%DIR%data" mkdir "%DIR%data" 2>nul
echo ok>"%DIR%data\.writetest" 2>nul
if not exist "%DIR%data\.writetest" (
  echo.
  echo  [ERRO] Acesso negado: o Windows nao deixa o app gravar nesta pasta.
  echo  Isso acontece em pastas protegidas, tipo Arquivos de Programas,
  echo  raiz do C:\ ou pasta vigiada pelo antivirus/OneDrive.
  echo.
  echo  SOLUCAO: mova a pasta inteira do app para Documentos ou para
  echo  C:\giba-steam-market e rode o .bat de la.
  echo.
  pause
  exit /b 1
)
del "%DIR%data\.writetest" >nul 2>&1
type nul >> "%LOG%"

if /i "%~1"=="/silent" goto silent

:cmd
echo  [Giba Steam Market] iniciando... o navegador abre sozinho em alguns segundos.
echo  Se a porta 5260 estiver bloqueada pelo Windows, o app escolhe outra e avisa aqui no log.
echo  Pra fechar o app: feche esta janela e a janela minimizada "Giba Steam Market".
echo.
start "Giba Steam Market" /min cmd /c "cd /d "%DIR%" && set GSM_OPEN=1&& node server.mjs >> "%LOG%" 2>&1"
powershell -NoProfile -Command "Get-Content '%LOG%' -Wait -Tail 30"
goto :eof

:silent
start "Giba Steam Market" /min cmd /c "cd /d "%DIR%" && set GSM_OPEN=1&& node server.mjs >> "%LOG%" 2>&1"
goto :eof
