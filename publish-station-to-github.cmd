@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish\publish-station-to-github.ps1" %*
