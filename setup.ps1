# File Convo - Windows PowerShell Setup & Dependency Checker
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "              FILE CONVO - LOCAL INSTALLER & SETUP                 " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 1. Check Python
try {
    $pyVer = & python --version 2>&1
    Write-Host "[OK] Python detected: $pyVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Python 3 is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Python from https://www.python.org/"
    pause
    exit 1
}

# 2. Check Node
try {
    $nodeVer = & node --version 2>&1
    Write-Host "[OK] Node.js detected: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/"
    pause
    exit 1
}

# 3. Create Virtual Environment
Write-Host ""
Write-Host "[*] Checking Python virtual environment (venv)..." -ForegroundColor Yellow
if (-not (Test-Path ".\venv\Scripts\python.exe")) {
    & python -m venv venv
    Write-Host "[OK] Created Python virtual environment." -ForegroundColor Green
} else {
    Write-Host "[OK] Virtual environment already exists." -ForegroundColor Green
}

# 4. Install Backend Requirements
Write-Host ""
Write-Host "[*] Installing backend dependencies from requirements.txt..." -ForegroundColor Yellow
& .\venv\Scripts\python.exe -m pip install --upgrade pip
& .\venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install Python dependencies." -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[OK] Backend dependencies installed successfully." -ForegroundColor Green

# 5. Install Frontend Dependencies
Write-Host ""
Write-Host "[*] Installing frontend npm dependencies..." -ForegroundColor Yellow
Set-Location "$scriptDir\frontend"
& cmd.exe /c "npm.cmd install"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install frontend packages." -ForegroundColor Red
    Set-Location $scriptDir
    pause
    exit 1
}
Write-Host "[*] Building frontend production bundle..." -ForegroundColor Yellow
& cmd.exe /c "npm.cmd run build"
Set-Location $scriptDir
Write-Host "[OK] Frontend build complete." -ForegroundColor Green

# 6. Check External Tools
Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "               CHECKING EXTERNAL SOFTWARE STATUS                   " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan

$loFound = $false
if (Get-Command "soffice" -ErrorAction SilentlyContinue) { $loFound = $true }
if (Test-Path "C:\Program Files\LibreOffice\program\soffice.exe") { $loFound = $true }
if (Test-Path "C:\Program Files (x86)\LibreOffice\program\soffice.exe") { $loFound = $true }
if (Test-Path "$env:LOCALAPPDATA\Programs\LibreOffice\program\soffice.exe") { $loFound = $true }

if ($loFound) {
    Write-Host "[OK] LibreOffice is installed and ready for Document-to-PDF conversion." -ForegroundColor Green
} else {
    Write-Host "[!] NOTICE: LibreOffice is NOT detected." -ForegroundColor Yellow
    Write-Host "    DOCX, PPTX, and XLSX to PDF conversion requires LibreOffice." -ForegroundColor Gray
    Write-Host "    Download free for Windows: https://www.libreoffice.org/download/" -ForegroundColor Gray
}

$tessFound = $false
if (Get-Command "tesseract" -ErrorAction SilentlyContinue) { $tessFound = $true }
if (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe") { $tessFound = $true }
if (Test-Path "C:\Program Files (x86)\Tesseract-OCR\tesseract.exe") { $tessFound = $true }

if ($tessFound) {
    Write-Host "[OK] Tesseract OCR is installed and ready for OCR text extraction." -ForegroundColor Green
} else {
    Write-Host "[!] NOTICE: Tesseract OCR is NOT detected." -ForegroundColor Yellow
    Write-Host "    Image and PDF OCR text extraction requires Tesseract OCR." -ForegroundColor Gray
    Write-Host "    Download installer: https://github.com/UB-Mannheim/tesseract/wiki" -ForegroundColor Gray
}

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] File Convo setup completed!" -ForegroundColor Green
Write-Host "To launch the app, run start.bat or .\start.ps1" -ForegroundColor Yellow
Write-Host "===================================================================" -ForegroundColor Cyan
