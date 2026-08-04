@echo off
:: Project Atlas — Frontend Startup
:: Usage: start_frontend.bat

cd /d "%~dp0frontend"
echo Starting Atlas frontend (Vite dev server)...
npm run dev
