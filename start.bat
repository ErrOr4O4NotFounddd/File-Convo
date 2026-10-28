@echo off
setlocal enabledelayedexpansion

echo ===================================================================
echo               LAUNCHING FILE CONVO (LOCAL DESKTOP)
echo ===================================================================
echo.

if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found. Please run setup.bat first.
    pause
    exit /b 1
)

:: Check if Backend is already running
set BACKEND_RUNNING=0
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! EQU 0 set BACKEND_RUNNING=1

if !BACKEND_RUNNING! EQU 1 (
    echo [*] Backend is already running on http://127.0.0.1:8000.
) else (
    echo [*] Starting File Convo Backend on http://127.0.0.1:8000 ...
    start "File Convo Backend" /min cmd /c "venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload"
    timeout /t 2 /nobreak >nul
)

:: Check if Frontend is already running
set FRONTEND_RUNNING=0
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul 2>&1
if !ERRORLEVEL! EQU 0 set FRONTEND_RUNNING=1

if !FRONTEND_RUNNING! EQU 1 (
    echo [*] Frontend is already running on http://localhost:5173.
) else (
    echo [*] Starting File Convo Frontend UI on http://localhost:5173 ...
    cd frontend
    start "File Convo UI" /min cmd /c "npm run dev"
    cd ..
    timeout /t 3 /nobreak >nul
)
echo [*] Opening File Convo in your browser...
start http://localhost:5173/

echo.
echo ===================================================================
echo File Convo is now running!
echo - Frontend: http://localhost:5173
echo - Backend API: http://127.0.0.1:8000
echo - Swagger Docs: http://127.0.0.1:8000/docs
echo.
echo Close the background command windows when you are finished using File Convo.
echo ===================================================================
echo.
pause
