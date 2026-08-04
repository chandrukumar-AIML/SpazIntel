@echo off
:: Project Atlas — Backend Startup
:: Runs FastAPI from backend/ with engines/ on the Python path.
:: Usage: start_backend.bat [port]

set PORT=%1
if "%PORT%"=="" set PORT=8000

cd /d "%~dp0backend"
set PYTHONPATH=%~dp0engines

echo Starting Atlas backend on port %PORT%...
echo PYTHONPATH=%PYTHONPATH%
python -m uvicorn main:app --host 0.0.0.0 --port %PORT% --reload
