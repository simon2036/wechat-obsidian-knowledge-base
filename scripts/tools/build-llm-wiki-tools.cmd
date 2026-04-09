@echo off
setlocal EnableExtensions
powershell -NoProfile -ExecutionPolicy Bypass -Sta -File "%~dp0build-llm-wiki-tools.ps1" %*
