@echo off
setlocal enabledelayedexpansion

echo ===================================================================
echo               FILE CONVO - LOCAL INSTALLER & SETUP
echo ===================================================================
echo.

:: 1. Check Python
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python 3 is not installed or not in your PATH.
    echo Please install Python 3.10+ from https://www.python.org/
    pause
    exit /b 1
)
echo [OK] Python detected.

:: 2. Check Node.js
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js detected.

:: 3. Create Python Virtual Environment
echo.
echo [*] Setting up Python virtual environment (venv)...
if not exist "venv" (
    python -m venv venv
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [OK] Created virtual environment.
) else (
    echo [OK] Virtual environment already exists.
)

:: 4. Install Backend Dependencies
echo.
echo [*] Installing backend Python packages from requirements.txt...
call venv\Scripts\python.exe -m pip install --upgrade pip
call venv\Scripts\python.exe -m pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install Python dependencies.
    pause
    exit /b 1
)
echo [OK] Python dependencies installed successfully.

:: 5. Install Frontend Dependencies
echo.
echo [*] Installing frontend npm dependencies...
cd frontend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install frontend packages.
    cd ..
    pause
    exit /b 1
)
echo [*] Building frontend production bundle...
call npm run build
cd ..
echo [OK] Frontend setup complete.

:: 6. Check External Tools (LibreOffice and Tesseract)
echo.
echo ===================================================================
echo               CHECKING EXTERNAL SOFTWARE STATUS
echo ===================================================================

:: Check LibreOffice
where soffice >nul 2>&1
set LO_FOUND=0
if %ERRORLEVEL% EQU 0 set LO_FOUND=1
if exist "C:\Program Files\LibreOffice\program\soffice.exe" set LO_FOUND=1
if exist "C:\Program Files (x86)\LibreOffice\program\soffice.exe" set LO_FOUND=1
if exist "%LOCALAPPDATA%\Programs\LibreOffice\program\soffice.exe" set LO_FOUND=1

if %LO_FOUND% EQU 1 (
    echo [OK] LibreOffice is installed and ready for Document-to-PDF conversion.
) else (
    echo [!] NOTICE: LibreOffice is NOT detected.
    echo     DOCX, PPTX, and XLSX to PDF conversion requires LibreOffice.
    echo     Download free for Windows: https://www.libreoffice.org/download/
    echo     (You can configure custom path in File Convo Settings later)
)

:: Check Tesseract OCR
where tesseract >nul 2>&1
set TESS_FOUND=0
if %ERRORLEVEL% EQU 0 set TESS_FOUND=1
if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" set TESS_FOUND=1
if exist "C:\Program Files (x86)\Tesseract-OCR\tesseract.exe" set TESS_FOUND=1

if %TESS_FOUND% EQU 1 (
    echo [OK] Tesseract OCR is installed and ready for OCR text extraction.
) else (
    echo [!] NOTICE: Tesseract OCR is NOT detected.
    echo     Image and PDF OCR text extraction requires Tesseract OCR.
    echo     Download installer: https://github.com/UB-Mannheim/tesseract/wiki
    echo     (Be sure to check 'Bengali' during setup if you need Bangla OCR)
)

echo.
echo ===================================================================
echo [SUCCESS] File Convo setup finished!
echo To launch the application, run start.bat
echo ===================================================================
echo.
pause
