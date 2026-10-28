# File Convo - Windows PowerShell Launcher
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "              LAUNCHING FILE CONVO (NATIVE WINDOWS)               " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path ".\venv\Scripts\python.exe")) {
    Write-Host "[ERROR] Python virtual environment not found. Please run setup.bat first." -ForegroundColor Red
    pause
    exit 1
}

# Start Backend in a background process if not already running
$backendRunning = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
if (-not $backendRunning) {
    Write-Host "[*] Starting File Convo Backend API on http://127.0.0.1:8000 ..." -ForegroundColor Green
    $backendJob = Start-Process -FilePath ".\venv\Scripts\python.exe" -ArgumentList "-m uvicorn backend.main:app --host 127.0.0.1 --port 8000" -PassThru -WindowStyle Minimized
    Start-Sleep -Seconds 2
} else {
    Write-Host "[*] Backend is already running on http://127.0.0.1:8000." -ForegroundColor Yellow
}

# Start Frontend Vite Dev Server if not already running
$frontendRunning = (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
if (-not $frontendRunning) {
    Write-Host "[*] Starting File Convo Frontend on http://localhost:5173 ..." -ForegroundColor Green
    Set-Location "$scriptDir\frontend"
    $frontendJob = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd run dev" -PassThru -WindowStyle Minimized
    Set-Location $scriptDir
    Start-Sleep -Seconds 3
} else {
    Write-Host "[*] Frontend is already running on http://localhost:5173." -ForegroundColor Yellow
}

# Launch default browser
Write-Host "[*] Opening File Convo in your web browser..." -ForegroundColor Green
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "File Convo is now running natively on Windows!" -ForegroundColor Yellow
Write-Host "- Frontend: http://localhost:5173" -ForegroundColor White
Write-Host "- Backend API: http://127.0.0.1:8000" -ForegroundColor White
Write-Host "- Swagger Docs: http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C or close the background windows to stop File Convo." -ForegroundColor Gray
Write-Host "===================================================================" -ForegroundColor Cyan
