@echo off
setlocal

set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-z001-obsidian-archive-once.ps1" %*
exit /b %ERRORLEVEL%

