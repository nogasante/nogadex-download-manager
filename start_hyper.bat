@echo off
title HyperDownloader 64-Thread Turbo
cd /d "%~dp0"

echo ========================================================
echo   ⚡ Starting HyperDownloader (64-Thread Engine)
echo   🚀 Launching in Native Standalone Desktop Window Mode...
echo ========================================================

start "" /b npm run dev

:: Wait 2 seconds for server to boot
timeout /t 2 /nobreak >nul

:: Launch directly as a standalone native app window (no address bar, no tabs)
start msedge --app="http://localhost:5173" --window-size=1150,720 || start chrome --app="http://localhost:5173" --window-size=1150,720 || start http://localhost:5173
