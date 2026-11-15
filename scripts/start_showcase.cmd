@echo off
rem Double-click to put the BiteDown backend online for phones (see docs/SETUP.md, "Showcase").
rem Start Docker Desktop first. Keep this window open; close it to stop.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve_public.ps1" %*
pause
