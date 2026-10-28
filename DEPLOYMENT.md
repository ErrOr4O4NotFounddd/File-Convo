# File Convo — $0 Public Deployment & Production Guide

This guide covers how to deploy **File Convo** to public cloud hosting for **$0 / month without Docker**, specifically tailored for **Render Native Python** and **Render Static Sites**, while maintaining full backward compatibility with the local Windows desktop environment (`start.bat`).

---

## 1. Cloud Architecture & Native Dependency Analysis

### Render Free Tier Runtime Constraints
* **Operating System:** Ubuntu / Linux container running as an unprivileged user (`render`).
* **Privileges:** No `sudo`, no `apt-get` package management available at build or run time.
* **Memory Ceiling:** **512 MB RAM**. Exceeding 512 MB triggers an immediate kernel Out-Of-Memory (OOM) kill.
* **Disk Storage:** Ephemeral / stateless. Files saved to `/tmp` or local directories are wiped on restart, redeploy, or container sleep.
* **Process Lifecycle:** Free instances spin down after 15 minutes of inactivity and cold-boot upon the next incoming HTTP request.

### Feature Compatibility Matrix on Render Native Free Tier

| Feature | Engine / Library | Supported on Render $0 Free Tier? | Technical Explanation |
| :--- | :--- | :---: | :--- |
| **PDF Page Organizer** | PyMuPDF (`pymupdf`) |  **YES** (100%) | Pure Python wheels with bundled precompiled C bindings. Instant thumbnail rendering, page reordering, rotation, deletion, and merging. |
| **PDF Tools (Merge/Split/Extract/Compress)** | PyMuPDF (`pymupdf`) |  **YES** (100%) | Fast in-memory / temp streaming. Fully supported. |
| **PDF to Word (.docx)** | `pdf2docx` |  **YES** (100%) | Python-native parser and document builder. Fully supported. |
| **Image Studio & HEIC Conversion** | Pillow + `pillow-heif` |  **YES** (100%) | Bundled binary wheels for libheif, libjpeg, libpng, and libwebp. Full conversion between all formats. |
| **Target-Size Image Compression** | Pillow (Binary Search) |  **YES** (100%) | Pure Python iterative optimization. Memory-safe. |
| **ZIP Archive Manager** | Python `zipfile` |  **YES** (100%) | Standard library with Zip-Slip path traversal protection. |
| **Document to PDF (.docx, .pptx, .xlsx)** | LibreOffice headless | ❌ **UNSUPPORTED** | Requires system `libreoffice-core` packages via `apt-get` (unsupported on native Render without Docker) and exceeds 512 MB RAM footprint. |
| **OCR & Searchable PDF** | Tesseract OCR | ❌ **UNSUPPORTED** | Requires `tesseract-ocr` system binaries and `tessdata` language models via `apt-get`. |

> [!NOTE]
> **Graceful Degradation:** When deployed to Render Native Python, the backend and frontend automatically detect missing LibreOffice and Tesseract binaries via the `/api/health` and `/api/system/status` endpoints. If a user attempts a document conversion or OCR, the system returns a friendly HTTP 400 error (`missing_dependency: "LibreOffice"` or `"Tesseract"`) without crashing the application.
> If you require full LibreOffice and Tesseract support in production, refer to **Section 6** for deploying to an inexpensive Linux VPS with root access.

---

## 2. Deployment Architecture Options on Render

You can deploy File Convo using either of two architectures:

### Option A: Unified Web Service (Recommended — Simplest $0 Setup)
In this configuration, Render builds both the React frontend and Python backend into a single Web Service. FastAPI serves the compiled React application directly from `frontend/dist` and handles API requests on the same port.
* **Benefits:** 100% free (uses only 1 free service slot), **zero CORS configuration needed**, same-origin requests, no separate domain setup.

* **Build Command:**
  ```bash
  cd frontend && npm install && npm run build && cd .. && pip install -r requirements.txt
  ```
* **Start Command:**
  ```bash
  uvicorn backend.main:app --host 0.0.0.0 --port $PORT
  ```

---

### Option B: Decoupled Services (Static Site + Web Service)
In this configuration, the frontend is deployed as a Render Static Site, and the backend is deployed as a Render Web Service.

1. **Frontend (Render Static Site):**
   * **Root Directory:** `frontend`
   * **Build Command:** `npm install && npm run build`
   * **Publish Directory:** `dist`
   * **Environment Variable:**
     * `VITE_API_BASE_URL`: `https://your-backend-api.onrender.com`

2. **Backend (Render Web Service):**
   * **Build Command:** `pip install -r requirements.txt`
   * **Start Command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   * **Environment Variables:**
     * `ENVIRONMENT`: `production`
     * `ALLOWED_ORIGINS`: `https://your-frontend-site.onrender.com`

---

## 3. Step-by-Step Deployment Guide (Option A — Unified)

### Step 1: Push Code to GitHub / GitLab
Ensure your latest changes are pushed to your repository:
```bash
git add .
git commit -m "Prepare File Convo for production Render deployment"
git push origin main
```

### Step 2: Create a Web Service on Render
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your Git repository (`file-convo`).
4. Configure the service settings:
   * **Name:** `file-convo` (or your chosen name)
   * **Region:** Oregon (US West) or Frankfurt (EU)
   * **Branch:** `main`
   * **Root Directory:** *(leave blank for repository root)*
   * **Runtime:** `Python 3`
   * **Build Command:**
     ```bash
     cd frontend && npm install && npm run build && cd .. && pip install -r requirements.txt
     ```
   * **Start Command:**
     ```bash
     uvicorn backend.main:app --host 0.0.0.0 --port $PORT
     ```
   * **Instance Type:** `Free` (0.1 CPU, 512 MB RAM)

### Step 3: Configure Environment Variables
Under the **Environment Variables** tab in the Render dashboard, add the following key-value pairs:

| Variable | Value | Description |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `production` | Enables production security mode, masks internal paths, and disables debug endpoints. |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload size per file (prevents memory spikes on 512MB RAM instances). |
| `MAX_CONCURRENT_CONVERSIONS` | `2` | Limits concurrent heavy conversions to prevent OOM errors. |
| `RATE_LIMIT_PER_MINUTE` | `60` | Limits incoming requests per client IP to prevent denial-of-service abuse. |
| `CONVERSION_TIMEOUT_SECONDS` | `60` | Maximum duration for an individual file conversion. |
| `ALLOWED_ORIGINS` | *(leave empty for Option A, or set your frontend URL)* | Comma-separated list of allowed CORS origins. |

> [!NOTE]
> `PORT` is automatically injected by Render's runtime. The application reads `$PORT` dynamically and binds to `0.0.0.0`.

### Step 4: Deploy and Verify
1. Click **Create Web Service**. Render will clone the repo, install Node modules, compile the Vite React bundle, install Python wheels, and launch Uvicorn.
2. Once the deploy status changes to **Live**, open your public URL (e.g., `https://file-convo.onrender.com/`).
3. Verify the health check by navigating to:
   ```
   https://file-convo.onrender.com/api/health
   ```
   Expected response:
   ```json
   {
     "status": "healthy",
     "app": "File Convo",
     "version": "1.0.0",
     "environment": "production",
     "dependencies": {
       "libreoffice": false,
       "tesseract": false,
       "pymupdf": true,
       "pillow": true,
       "pdf2docx": true
     },
     "limits": {
       "max_file_size_mb": 50,
       "max_concurrent_conversions": 2,
       "rate_limit_per_minute": 60
     }
   }
   ```

---

## 4. Production Security & Hardening Features

File Convo includes the following enterprise-grade security protections out of the box:

1. **Sliding-Window Rate Limiter (`RateLimitMiddleware`):**
   * Tracks client requests per minute using client IP addresses (with `X-Forwarded-For` proxy support).
   * Automatically bypasses static assets (`/assets/*`, `favicon.ico`) and health endpoints (`/api/health`).
   * Returns standard `HTTP 429 Too Many Requests` with a `Retry-After: 60` header when limits are exceeded.

2. **Concurrency Limiter (`conversion_slot`):**
   * Uses an asynchronous semaphore to restrict concurrent heavy operations (PDF rendering, batch resizing, ZIP compression) to `MAX_CONCURRENT_CONVERSIONS`.
   * Fast fail: Returns `HTTP 503 Service Unavailable` with a friendly message if all slots are occupied for longer than 12 seconds.

3. **Magic Byte Signature & MIME Validation:**
   * Files are inspected for genuine binary headers (e.g., `%PDF`, `\x89PNG`, `\xff\xd8\xff`, `RIFF...WEBP`, `ftyp`).
   * Executables (`MZ`, ELF, scripts) disguised with `.pdf` or `.png` extensions are rejected before processing.

4. **Filename Sanitization & Path Traversal Defense:**
   * Basenames are isolated, and traversal characters (`../`, `..\`) are stripped.
   * Null bytes (`\x00`), shell injection characters (`;`, `` ` ``, `$`, `&`), and control characters are purged.
   * Full international Unicode support is preserved for Asian, European, and Cyrillic character sets.

5. **Safe Streaming Downloads (RFC 6266 / RFC 5987):**
   * Download endpoints verify that target files reside strictly inside authorized temporary directories using `relative_to` checks.
   * Filenames are transmitted with dual headers: ASCII fallback for legacy clients and UTF-8 encoded `filename*=` for modern browsers.
   * Canonical file extensions are enforced based on the real file on disk.

6. **Automated Temporary File Lifecycle:**
   * Unique directories are generated for each batch using Python's `tempfile` module.
   * Temp files are cleaned up on startup, shutdown, and periodically every 15 minutes for files older than 30 minutes.

---

## 5. Local Windows Desktop Workflow (Unchanged)

The local workflow remains completely unaffected:
* Running `start.bat` launches:
  * Backend on `http://127.0.0.1:8000` with `ENVIRONMENT=development`.
  * Frontend on `http://localhost:5173`.
* In development mode:
  * Full LibreOffice and Tesseract OCR paths are utilized when installed on Windows.
  * System file explorer integration (`open-explorer`) remains active.
  * Local configuration persists to `%USERPROFILE%\.fileconvo\settings.json`.

---

## 6. Optional: Full VPS Deployment (LibreOffice + Tesseract)

If you require document conversions (DOCX/PPTX to PDF) or multi-language OCR, deploy File Convo to an Ubuntu 22.04/24.04 LTS VPS (DigitalOcean, Hetzner, AWS EC2, or Linode) where system packages can be installed:

```bash
# 1. Install system packages
sudo apt-get update && sudo apt-get install -y \
    python3 python3-pip python3-venv git nginx \
    libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-ben nodejs npm

# 2. Clone and install
cd /opt
sudo git clone https://github.com/your-username/file-convo.git
sudo chown -R $USER:$USER /opt/file-convo
cd /opt/file-convo

python3 -m venv venv
./venv/bin/pip install -r requirements.txt

cd frontend && npm install && npm run build && cd ..

# 3. Create systemd service
sudo tee /etc/systemd/system/fileconvo.service > /dev/null <<EOF
[Unit]
Description=File Convo Service
After=network.target

[Service]
User=$USER
WorkingDirectory=/opt/file-convo
Environment="ENVIRONMENT=production"
Environment="PORT=8000"
ExecStart=/opt/file-convo/venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now fileconvo
```
