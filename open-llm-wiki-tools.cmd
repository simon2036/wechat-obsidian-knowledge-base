@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "EXE=%ROOT%llm-wiki-tools.exe"
set "SCRIPT=%ROOT%scripts\gui\llm-wiki-tools.ps1"

if /I "%~1"=="--exe" (
  if exist "%EXE%" (
    start "" "%EXE%"
    exit /b 0
  )
  echo Missing executable: "%EXE%"
  exit /b 1
)

if not exist "%SCRIPT%" (
  echo Missing launcher script: "%SCRIPT%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -File "%SCRIPT%" %*
