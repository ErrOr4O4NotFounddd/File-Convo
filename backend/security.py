import os
import re
import io
import time
import unicodedata
import asyncio
from pathlib import Path
from collections import defaultdict, deque
from typing import Any, Dict, Optional, Set, Tuple
from contextlib import asynccontextmanager

from fastapi import Request, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.config import (
    MAX_FILE_SIZE_MB,
    MAX_CONCURRENT_CONVERSIONS,
    RATE_LIMIT_PER_MINUTE,
    CONVERSION_TIMEOUT_SECONDS,
    ENVIRONMENT
)

# Allowed file extensions per tool domain
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp", ".tiff", ".tif", ".gif"}
ALLOWED_PDF_EXTENSIONS = {".pdf"}
ALLOWED_DOCUMENT_EXTENSIONS = {".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".odt", ".odp", ".ods", ".rtf", ".txt"}
ALLOWED_ARCHIVE_EXTENSIONS = {".zip"}

# Known Magic Byte signatures for strict MIME validation
MAGIC_SIGNATURES = {
    ".pdf": [b"%PDF"],
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".gif": [b"GIF87a", b"GIF89a"],
    ".bmp": [b"BM"],
    ".webp": [b"RIFF"],  # Further checked with WEBP at offset 8
    ".zip": [b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"],
    ".docx": [b"PK\x03\x04"],
    ".pptx": [b"PK\x03\x04"],
    ".xlsx": [b"PK\x03\x04"],
    ".odt": [b"PK\x03\x04"],
    ".odp": [b"PK\x03\x04"],
    ".ods": [b"PK\x03\x04"],
    ".tiff": [b"II*\x00", b"MM\x00*"],
    ".tif": [b"II*\x00", b"MM\x00*"],
}

def sanitize_filename(filename: str, default: str = "document") -> str:
    """
    Sanitize an uploaded or download filename:
    - Extracts the pure filename basename (no directories).
    - Removes directory traversal patterns ('../', '..\\').
    - Removes null bytes, control characters, and dangerous shell metacharacters.
    - Preserves safe alphanumeric characters (including international Unicode scripts),
      underscores, hyphens, dots, spaces, and extension.
    """
    if not filename or not filename.strip():
        return f"{default}.bin"

    # Remove null bytes and control chars first
    cleaned = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", filename.strip())
    # Take only the basename component
    cleaned = cleaned.replace("\\", "/")
    base_name = cleaned.split("/")[-1].strip()
    if not base_name:
        return f"{default}.bin"

    p = Path(base_name)
    raw_stem = p.stem
    ext = p.suffix.lower()

    # Clean extension: only alphanumeric and dot
    clean_ext = re.sub(r"[^a-zA-Z0-9\.]", "", ext)
    if clean_ext.startswith(".."):
        clean_ext = ""

    # Replace dangerous characters in stem (path delimiters, shell chars, quotes, brackets) with '_'
    stem = re.sub(r'[\\/:*?"<>|;`$&{}[\]()~!~=\+\^%#@,]', '_', raw_stem)
    # Collapse multiple consecutive underscores
    stem = re.sub(r'_+', '_', stem).strip(" ._")

    if not stem:
        stem = default

    final_name = f"{stem}{clean_ext}"
    # Ensure final filename does not contain path traversal
    final_name = final_name.replace("..", "_")
    return final_name


def validate_content_signature(content: bytes, ext: str) -> None:
    """
    Validates that file content bytes match the declared extension.
    Rejects disguised executables, scripts, or corrupted files.
    """
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    ext_lower = ext.lower()

    if ext_lower == ".pdf":
        if b"%PDF" not in content[:1024]:
            raise HTTPException(status_code=400, detail="Invalid PDF file: Missing %PDF signature.")
        return

    if ext_lower == ".webp":
        if not (content.startswith(b"RIFF") and len(content) > 12 and content[8:12] == b"WEBP"):
            raise HTTPException(status_code=400, detail="Invalid WebP image: Missing RIFF/WEBP signature.")
        return

    if ext_lower in (".heic", ".heif"):
        # HEIF/HEIC has 'ftyp' at offset 4
        if len(content) > 12 and content[4:8] == b"ftyp":
            return
        raise HTTPException(status_code=400, detail="Invalid HEIC/HEIF image: Missing ftyp signature.")

    if ext_lower in MAGIC_SIGNATURES:
        signatures = MAGIC_SIGNATURES[ext_lower]
        if not any(content.startswith(sig) for sig in signatures):
            raise HTTPException(
                status_code=400,
                detail=f"File signature mismatch: Content does not match extension '{ext_lower}'. Executables and mismatched files are rejected."
            )


def validate_upload_bytes(
    content: bytes,
    filename: str,
    allowed_extensions: Set[str],
    max_mb: Optional[int] = None,
    enforce_signature: bool = True
) -> str:
    """
    Synchronously validates uploaded file content, extension, size limit, and magic bytes.
    Returns safe_filename or raises HTTPException (400 or 413).
    """
    safe_name = sanitize_filename(filename or "uploaded_file")
    ext = Path(safe_name).suffix.lower()

    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed formats: {', '.join(sorted(allowed_extensions))}"
        )

    size_limit_mb = max_mb or MAX_FILE_SIZE_MB
    max_bytes = size_limit_mb * 1024 * 1024

    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File '{safe_name}' exceeds maximum allowed size of {size_limit_mb} MB."
        )

    if len(content) == 0:
        raise HTTPException(status_code=400, detail=f"File '{safe_name}' is empty.")

    if enforce_signature:
        validate_content_signature(content, ext)

    return safe_name


async def validate_and_read_upload(
    file: UploadFile,
    allowed_extensions: Set[str],
    max_mb: Optional[int] = None,
    enforce_signature: bool = True
) -> Tuple[bytes, str]:
    """
    Safely reads and validates an uploaded file:
    1. Sanitizes filename.
    2. Enforces allowed extensions.
    3. Enforces maximum file size limit (streaming chunk read).
    4. Validates magic byte signatures.
    Returns (content_bytes, safe_filename).
    """
    raw_name = file.filename or "uploaded_file"
    safe_name = sanitize_filename(raw_name)
    ext = Path(safe_name).suffix.lower()

    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed formats: {', '.join(sorted(allowed_extensions))}"
        )

    size_limit_mb = max_mb or MAX_FILE_SIZE_MB
    max_bytes = size_limit_mb * 1024 * 1024

    # Chunked read to prevent memory exhaustion from oversized payload attacks
    chunks = []
    total_bytes = 0
    chunk_size = 64 * 1024  # 64 KB chunks

    try:
        while True:
            if hasattr(file, "file") and hasattr(file.file, "read"):
                chunk = file.file.read(chunk_size)
            elif hasattr(file, "read"):
                res = file.read(chunk_size)
                chunk = await res if asyncio.iscoroutine(res) else res
            else:
                chunk = b""

            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"File '{safe_name}' exceeds maximum allowed size of {size_limit_mb} MB."
                )
            chunks.append(chunk)
    finally:
        try:
            await file.close()
        except Exception:
            pass

    content = b"".join(chunks)

    if len(content) == 0:
        raise HTTPException(status_code=400, detail=f"File '{safe_name}' is empty.")

    if enforce_signature:
        validate_content_signature(content, ext)

    return content, safe_name


# --- Concurrency Limiting ---
_semaphores_by_loop: Dict[Any, asyncio.Semaphore] = {}

def _get_semaphore() -> asyncio.Semaphore:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop not in _semaphores_by_loop:
        _semaphores_by_loop[loop] = asyncio.Semaphore(MAX_CONCURRENT_CONVERSIONS)
    return _semaphores_by_loop[loop]

@asynccontextmanager
async def conversion_slot(timeout_seconds: float = 12.0):
    """
    Context manager to limit concurrent heavy conversions.
    Prevents Out-Of-Memory (OOM) crashes on constrained public/free instances.
    """
    acquired = False
    sem = _get_semaphore()
    try:
        await asyncio.wait_for(sem.acquire(), timeout=timeout_seconds)
        acquired = True
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail="Server is currently busy processing other conversions. Please retry in a few moments."
        )

    try:
        yield
    finally:
        if acquired:
            sem.release()


# --- In-Memory Sliding Window Rate Limiting ---
class RateLimitMiddleware:
    """
    Pure ASGI sliding-window IP rate limiter.
    Does not require Redis or paid external services.
    Enforces maximum requests per minute per IP address with zero overhead and zero deadlock risk.
    """
    def __init__(self, app, requests_per_minute: int = RATE_LIMIT_PER_MINUTE):
        self.app = app
        self.requests_per_minute = requests_per_minute
        self.client_records = defaultdict(deque)
        self.last_cleanup = time.time()

    def _get_client_ip(self, scope: dict) -> str:
        headers = dict(scope.get("headers", []))
        forwarded = headers.get(b"x-forwarded-for")
        if forwarded:
            return forwarded.decode("latin1").split(",")[0].strip()
        client = scope.get("client")
        return client[0] if client else "unknown"

    def _is_exempt(self, path: str) -> bool:
        # Exempt health checks, info, docs, and static assets from rate limiting
        return (
            path in ("/api/health", "/api/info", "/health", "/docs", "/openapi.json", "/redoc", "/")
            or path.startswith("/assets/")
            or path.endswith(".ico")
            or path.endswith(".svg")
            or path.endswith(".png")
        )

    def check_rate_limit(self, client_ip: str) -> Optional[JSONResponse]:
        """Check rate limit for client IP, returning 429 response if exceeded."""
        now = time.time()
        window_start = now - 60.0  # 60 second window

        # Periodic cleanup of old IP buckets every 5 minutes
        if now - self.last_cleanup > 300.0:
            stale_ips = [ip for ip, times in self.client_records.items() if not times or times[-1] < window_start]
            for ip in stale_ips:
                del self.client_records[ip]
            self.last_cleanup = now

        ip_deque = self.client_records[client_ip]

        # Purge records older than window
        while ip_deque and ip_deque[0] < window_start:
            ip_deque.popleft()

        if len(ip_deque) >= self.requests_per_minute:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Rate limit exceeded. Too many requests. Please wait a moment before sending more requests."
                },
                headers={"Retry-After": "60"}
            )

        ip_deque.append(now)
        return None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if self._is_exempt(path):
            await self.app(scope, receive, send)
            return

        client_ip = self._get_client_ip(scope)
        error_resp = self.check_rate_limit(client_ip)
        if error_resp is not None:
            await error_resp(scope, receive, send)
            return

        await self.app(scope, receive, send)
