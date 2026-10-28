# File Convo — Personal Local File Converter

**File Convo** is a desktop-friendly web application designed for Windows that runs natively and 100% locally on your PC. It processes all documents, images, PDFs, archives, and OCR operations entirely on localhost using standard Windows tooling—**no Docker required**, no cloud uploads, no paid subscriptions, and zero privacy risks.

---

## Key Features

### 1. Document to PDF (P1)
- **Supported conversions:** `DOCX → PDF`, `PPTX → PDF`, `XLSX → PDF` (also supports `.doc`, `.ppt`, `.xls`, `.odt`, `.rtf`, `.txt`).
- **Engine:** LibreOffice headless execution with isolated temporary directories (plus native `.txt → PDF` formatting).
- **Features:** Batch conversion, drag-and-drop queue, automatic detection of LibreOffice installation, error reporting with setup guide.

### 2. Image Studio & HEIC Converter (P1)
- **Supported conversions:**
  - `PNG ↔ JPG/JPEG`
  - `WebP → PNG/JPG`
  - `HEIC / HEIF → JPG, PNG, WebP` (Full iPhone camera support via `pillow-heif`)
  - `BMP → PNG/JPG`
  - `TIFF → PNG/JPG`
  - `Image → PDF`
- **Compression & Resizing:**
  - Lossy compression slider: 10% to 100% (Default: 80%).
  - Resize by exact pixels (width/height) or scale percentage (10% to 200%).
  - Aspect ratio preservation toggle.
  - EXIF metadata retention toggle.
  - Configurable background color when flattening transparent PNGs to JPG.
- **Reporting:** Original size vs. output size, dimensions before & after, bytes and percentage saved, and before/after thumbnail previews.

### 3. PDF Manipulation Suite (P1)
- **Merge PDFs:** Drag, drop, and custom reorder PDF files before combining into a single document.
- **Split PDF:** Break multipage PDFs into individual single-page PDF files in a dedicated output subfolder.
- **Extract Pages:** Parse and extract precise page numbers and page ranges (e.g. `1-3, 5, 8-10`).
- **Compress PDF:** Real PDF stream optimization, garbage collection, stream deflation, font/image compression, and honest space reduction reporting.

### 4. ZIP Archive Tools (P1)
- **Create ZIP:** Bundle multiple files of any format into a compressed `.zip` archive.
- **Extract ZIP:** Unpack archives safely into an isolated destination folder.
- **Security:** Built-in protection against **Zip Slip** (path traversal vulnerabilities) and file overwrite validation.

### 5. PDF to Word (DOCX) (P2)
- **Convert `PDF → DOCX`:** Converts digital PDFs to editable Microsoft Word documents preserving headings, paragraphs, and images.
- **Validation:** Verifies generated `.docx` file structure before reporting success.
- **Smart detection:** Flags scanned image-based PDFs and directs users to the OCR tool.

### 6. OCR & Text Extraction (P2)
- **Operations:**
  - `Image → TXT`
  - `Scanned PDF → TXT`
  - `Scanned PDF → Searchable PDF` (selectable text overlay)
  - `Scanned PDF → DOCX`
- **Languages:** English (`eng`) and optional Bengali / Bangla (`ben` or `eng+ben`).
- **Engine:** Tesseract OCR running offline with local language training data.

### 7. Conversion History & Settings
- **History Audit:** Local audit log of all conversions (filename, conversion type, timestamp, output path, metrics). No file content is retained. Clear history at any time.
- **Windows Explorer Integration:** One-click "Show in Explorer" opens the folder and highlights generated files.
- **Settings:** Customize default output directories, image quality, format, EXIF policy, custom LibreOffice / Tesseract executable paths, and temporary file cleanup policies.

---

## Technology Stack (No Docker Required)

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Lucide React icons.
- **Backend:** Python 3.10+ (tested on Python 3.14), FastAPI, Uvicorn, Pydantic.
- **Document Engine:** LibreOffice headless (`soffice.exe`).
- **Image Engine:** Pillow (`PIL`) + `pillow-heif` (HEIC decoder plugin).
- **PDF Engine:** PyMuPDF (`fitz`) + `pypdf`.
- **Word Engine:** `pdf2docx` + `python-docx`.
- **OCR Engine:** Tesseract OCR (`pytesseract`).
- **Archive Engine:** Python `zipfile` with path normalization security.

---

## Native Windows Quick Start

### 1. Automated Setup
Double-click `setup.bat` (or run in PowerShell `.\setup.ps1`):
```cmd
setup.bat
```
This script will:
1. Verify Python 3 and Node.js are available.
2. Create a local Python virtual environment (`venv`).
3. Install backend packages from `requirements.txt`.
4. Install frontend npm dependencies and compile the production bundle.
5. Check if LibreOffice and Tesseract OCR are installed on Windows and display status.

### 2. Launching File Convo
Double-click `start.bat` (or run `.\start.ps1` in PowerShell):
```cmd
start.bat
```
This launches:
- **Backend API:** `http://127.0.0.1:8000`
- **Frontend Web UI:** `http://localhost:5173`
- Opens your default web browser automatically.

---

## Manual Execution (Developers)

### Start Backend:
```powershell
.\venv\Scripts\Activate.ps1
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

### Start Frontend:
```cmd
cd frontend
npm run dev
```

### Run Automated Tests:
```powershell
.\venv\Scripts\python.exe -m pytest tests -v
```

---

## External Tools Setup (Optional)

File Convo works immediately for Image Conversion, HEIC decoding, PDF manipulation, ZIP archives, and PDF-to-Word conversions out of the box.

For **Document-to-PDF** and **OCR**:
1. **LibreOffice (for DOCX, PPTX, XLSX → PDF):**
   - Download the free Windows installer from [LibreOffice Official Download](https://www.libreoffice.org/download/download-libreoffice/).
   - Default install location: `C:\Program Files\LibreOffice\program\soffice.exe` (automatically detected).
2. **Tesseract OCR (for Image & Scanned PDF OCR):**
   - Download the Windows installer from [UB-Mannheim Tesseract Wiki](https://github.com/UB-Mannheim/tesseract/wiki).
   - During setup, check **Additional script data (Bengali)** if you need Bangla OCR.
   - Default install location: `C:\Program Files\Tesseract-OCR\tesseract.exe` (automatically detected).

*Note: You can also specify custom installation paths at any time in the File Convo **Settings** page.*

---

## Cloud Deployment (Non-Docker)

File Convo is cloud-deployable without Docker using standard Linux VPS tooling (`systemd`, `Nginx`, `apt`).
See the complete step-by-step guide in [DEPLOYMENT.md](file:///c:/Users/nazmu/OneDrive/เอกสาร/File%20Converter%20Project/DEPLOYMENT.md).

---

## Privacy & Security

- **Zero Cloud Uploads:** No file leaves your computer.
- **Bound to Localhost:** Backend listens exclusively on `127.0.0.1`.
- **Path Traversal Defense:** ZIP archive extraction strictly validates resolved extraction targets to block Zip Slip attacks.
- **Isolated Sandboxing:** Multi-file document and PDF operations run in isolated temporary folders.
- **Automatic Cleanup:** Temporary working files are automatically cleaned up according to your cleanup settings.
