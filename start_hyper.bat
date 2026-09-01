@echo off
title HyperDownloader Native Desktop
cd /d "%~dp0"

echo [1/2] Launching HyperDownloader Native Desktop App...
start "" npx electron .
