@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "PROXY_SCRIPT=%SCRIPT_DIR%scripts\launch\open-wewe-rss-dash-proxy.mjs"
set "DASH_URL=https://z001.tail904288.ts.net/dash"

if exist "%PROXY_SCRIPT%" (
  where node >nul 2>nul
  if not errorlevel 1 (
    rem Use a local proxy so Chrome gets a clean local origin in a dedicated window.
    start "" /B node "%PROXY_SCRIPT%"
    exit /b 0
  )
)

for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
  if exist "%%~P" (
    start "" "%%~P" --new-window --no-first-run --no-default-browser-check "%DASH_URL%"
    exit /b 0
  )
)

start "" "%DASH_URL%"
