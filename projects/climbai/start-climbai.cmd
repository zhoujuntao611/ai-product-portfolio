@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Create a Python 3.11 virtual environment first:
  echo python -m venv .venv
  echo .venv\Scripts\python.exe -m pip install -r requirements.txt
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Build the frontend first with npm ci and npm run build.
  pause
  exit /b 1
)
echo ClimbAI: http://127.0.0.1:8000
echo Press Ctrl+C in this terminal to stop.
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
endlocal
