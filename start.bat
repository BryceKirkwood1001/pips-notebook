@echo off
rem Double-click to play Pip's Notebook on Windows. Needs Node.js 22+ from https://nodejs.org.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS from https://nodejs.org, then double-click start.bat again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node scripts\start.mjs %*
if errorlevel 1 pause
