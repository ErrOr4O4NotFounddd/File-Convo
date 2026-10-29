import os
import time
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import (
    load_settings,
    PROJECT_ROOT,
    ENVIRONMENT,
    HOST,
    PORT,
    MAX_FILE_SIZE_MB,
    MAX_CONCURRENT_CONVERSIONS,
    RATE_LIMIT_PER_MINUTE,
    get_allowed_origins,
)
from backend.security import RateLimitMiddleware
from backend.services.system_service import cleanup_temp_files
from backend.routers import (
    system,
    documents,
    pdf_tools,
    images,
    archives,
    pdf_to_word,
    ocr,
    history,
    scanner
)

_last_temp_cleanup_time: float = 0.0

def maybe_cleanup_abandoned_temp_files():
    """Periodically purges abandoned temporary files older than 30m without persistent background threads."""
    global _last_temp_cleanup_time
    now = time.time()
    if now - _last_temp_cleanup_time > 900.0:  # Every 15 minutes
        _last_temp_cleanup_time = now
        try:
            cleanup_temp_files(max_age_hours=0.5)
        except Exception:
            pass

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: cleanup old temp files
    settings = load_settings()
    if settings.temp_cleanup_policy in ("auto", "immediate"):
        cleanup_temp_files(max_age_hours=1.0)
    yield
    # Final cleanup on shutdown if policy is immediate
    settings = load_settings()
    if settings.temp_cleanup_policy == "immediate":
        cleanup_temp_files(max_age_hours=0.0)

app = FastAPI(
    title="File Convo API",
    description="High-performance file conversion and document manipulation engine",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS origins based on deployment environment
configured_origins = get_allowed_origins()
if ENVIRONMENT == "production":
    # In production: strictly allow only configured origins, no wildcard
    app_cors_origins = configured_origins
    allow_credentials = bool(app_cors_origins)
else:
    # In development: allow local origins
    app_cors_origins = configured_origins if configured_origins else ["*"]
    allow_credentials = True if app_cors_origins != ["*"] else False

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_cors_origins,
    allow_credentials=allow_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Apply in-memory rate limiting middleware
app.add_middleware(RateLimitMiddleware, requests_per_minute=RATE_LIMIT_PER_MINUTE)

# Dedicated API health & readiness endpoints (safe for public monitoring, zero secrets or paths leaked)
@app.get("/api/health")
@app.get("/health")
def api_health():
    maybe_cleanup_abandoned_temp_files()
    from backend.services.system_service import get_system_status
    status = get_system_status()
    lo_info = status.get("libreoffice", {})
    tess_info = status.get("tesseract", {})

    return {
        "status": "healthy",
        "app": "File Convo",
        "version": "1.0.0",
        "environment": ENVIRONMENT,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dependencies": {
            "libreoffice": {
                "available": lo_info.get("installed", False),
                "version": lo_info.get("version")
            },
            "tesseract": {
                "available": tess_info.get("installed", False),
                "version": tess_info.get("version"),
                "languages": tess_info.get("languages", [])
            },
            "pymupdf": {
                "available": True
            },
            "pillow": {
                "available": True
            },
            "pdf2docx": {
                "available": True
            }
        },
        "limits": {
            "max_file_size_mb": MAX_FILE_SIZE_MB,
            "max_concurrent_conversions": MAX_CONCURRENT_CONVERSIONS,
            "rate_limit_per_minute": RATE_LIMIT_PER_MINUTE
        }
    }

@app.get("/api/info")
def api_info():
    return {
        "app": "File Convo",
        "status": "running",
        "environment": ENVIRONMENT,
        "docs_url": "/docs",
        "version": "1.0.0"
    }

# Register API routers
app.include_router(system.router)
app.include_router(documents.router)
app.include_router(pdf_tools.router)
app.include_router(images.router)
app.include_router(archives.router)
app.include_router(pdf_to_word.router)
app.include_router(ocr.router)
app.include_router(history.router)
app.include_router(scanner.router)

# Mount frontend production build if present (for unified single-container or standalone deployment)
frontend_dist = PROJECT_ROOT / "frontend" / "dist"
if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
else:
    @app.get("/")
    def root():
        return {
            "app": "File Convo",
            "status": "running",
            "environment": ENVIRONMENT,
            "docs_url": "/docs",
            "version": "1.0.0"
        }

if __name__ == "__main__":
    import uvicorn
    # Bind to configured HOST (default 0.0.0.0 on production, 127.0.0.1 locally) and PORT
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=(ENVIRONMENT != "production"))
