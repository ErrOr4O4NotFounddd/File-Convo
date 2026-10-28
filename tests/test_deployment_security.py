import io
import os
import json
import pytest
from pathlib import Path
from fastapi import HTTPException

from backend.main import api_health
from backend.config import MAX_FILE_SIZE_MB, TEMP_DIR
from backend.security import (
    sanitize_filename,
    validate_content_signature,
    validate_upload_bytes,
    RateLimitMiddleware,
    ALLOWED_PDF_EXTENSIONS,
    ALLOWED_IMAGE_EXTENSIONS
)
from backend.routers.system import download_file
from backend.services.system_service import (
    get_system_status,
    open_in_file_explorer,
    invalidate_system_status_cache
)


def test_health_endpoint():
    """Verify health endpoint returns status, app info, dependencies, and limits without leaking paths."""
    data = api_health()
    assert data["status"] == "healthy"
    assert data["app"] == "File Convo"
    assert data["version"] == "1.0.0"
    assert "environment" in data
    assert "timestamp" in data
    assert "dependencies" in data
    assert "limits" in data

    deps = data["dependencies"]
    assert "libreoffice" in deps
    assert "tesseract" in deps
    assert "pymupdf" in deps
    assert "pillow" in deps
    assert "pdf2docx" in deps

    limits = data["limits"]
    assert limits["max_file_size_mb"] > 0
    assert limits["max_concurrent_conversions"] > 0
    assert limits["rate_limit_per_minute"] > 0

    # Verify no local filesystem paths or users leaked
    resp_text = json.dumps(data).lower()
    assert "c:\\" not in resp_text
    assert "/users/" not in resp_text
    assert "/home/" not in resp_text


def test_sanitize_filename():
    """Verify safe filename sanitization prevents path traversal and dangerous characters."""
    assert sanitize_filename("normal_file.pdf") == "normal_file.pdf"
    assert sanitize_filename("My Document (Final) [2026].pdf") == "My Document _Final_ _2026.pdf"
    
    # Path traversal patterns
    assert ".." not in sanitize_filename("../../../etc/passwd.pdf")
    assert "/" not in sanitize_filename("../../../etc/passwd.pdf")
    assert "\\" not in sanitize_filename("..\\..\\windows\\system32\\cmd.exe")
    assert sanitize_filename("..\\..\\windows\\system32\\cmd.exe").endswith(".exe")

    # Shell metacharacters and control characters
    sanitized = sanitize_filename("file;rm -rf;`whoami`.png")
    assert ";" not in sanitized
    assert "`" not in sanitized
    assert sanitized.endswith(".png")

    # Null bytes
    assert "\x00" not in sanitize_filename("evil\x00file.docx")

    # Empty or blank filenames
    assert sanitize_filename("") == "document.bin"
    assert sanitize_filename("   ") == "document.bin"


def test_magic_byte_validation():
    """Verify content signature matches declared extension and blocks spoofed files."""
    # Valid PDF
    valid_pdf = b"%PDF-1.5\n%fake-pdf-content-for-test"
    validate_content_signature(valid_pdf, ".pdf")

    # Executable pretending to be PDF
    fake_pdf = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff"
    with pytest.raises(HTTPException) as exc_info:
        validate_content_signature(fake_pdf, ".pdf")
    assert exc_info.value.status_code == 400
    assert "signature" in exc_info.value.detail.lower()

    # Valid PNG
    valid_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    validate_content_signature(valid_png, ".png")

    # HTML disguised as PNG
    fake_png = b"<!DOCTYPE html><html><body>Script</body></html>"
    with pytest.raises(HTTPException) as exc_info:
        validate_content_signature(fake_png, ".png")
    assert exc_info.value.status_code == 400

    # Valid WebP
    valid_webp = b"RIFF\x24\x00\x00\x00WEBPVP8 "
    validate_content_signature(valid_webp, ".webp")

    # Invalid WebP
    fake_webp = b"RIFF\x24\x00\x00\x00AVI LIST"
    with pytest.raises(HTTPException) as exc_info:
        validate_content_signature(fake_webp, ".webp")
    assert exc_info.value.status_code == 400


def test_upload_size_limit():
    """Verify upload size limits enforce 413 Payload Too Large."""
    # Max size 1 MB limit test
    oversized = b"%PDF-1.4" + b"X" * (2 * 1024 * 1024)
    with pytest.raises(HTTPException) as exc_info:
        validate_upload_bytes(oversized, "test.pdf", ALLOWED_PDF_EXTENSIONS, max_mb=1)
    assert exc_info.value.status_code == 413
    assert "exceeds maximum allowed size" in exc_info.value.detail

    # Empty file test
    with pytest.raises(HTTPException) as exc_info:
        validate_upload_bytes(b"", "empty.pdf", ALLOWED_PDF_EXTENSIONS)
    assert exc_info.value.status_code == 400

    # Disallowed extension test
    with pytest.raises(HTTPException) as exc_info:
        validate_upload_bytes(b"#!/bin/bash\necho test\n", "test.sh", ALLOWED_PDF_EXTENSIONS)
    assert exc_info.value.status_code == 400
    assert "Unsupported file format" in exc_info.value.detail


def test_download_security_path_traversal():
    """Verify download_file denies unauthorized paths and allows safe paths."""
    traversal_paths = [
        "C:\\Windows\\System32\\cmd.exe",
        "/etc/passwd",
        "/etc/shadow",
        "../../../../Windows/System32/drivers/etc/hosts"
    ]
    for p in traversal_paths:
        with pytest.raises(HTTPException) as exc:
            download_file(path=p)
        assert exc.value.status_code in (403, 404)

    # Valid download within TEMP_DIR
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    sample_file = TEMP_DIR / "safe_test_download.pdf"
    sample_file.write_bytes(b"%PDF-1.4 sample safe file")
    try:
        res = download_file(path=str(sample_file), filename="custom_name.pdf")
        assert res.status_code == 200
        assert res.media_type == "application/pdf"
        assert 'attachment;' in res.headers["content-disposition"]
        assert 'custom_name.pdf' in res.headers["content-disposition"]
    finally:
        if sample_file.exists():
            sample_file.unlink()


def test_rate_limit_middleware_logic():
    """Verify RateLimitMiddleware properly exempts endpoints and throttles abusive clients."""
    limiter = RateLimitMiddleware(None, requests_per_minute=2)

    # 1. Exempt path should always pass
    assert limiter._is_exempt("/api/health") is True
    assert limiter._is_exempt("/health") is True
    assert limiter._is_exempt("/assets/index.js") is True
    assert limiter._is_exempt("/api/pdf/merge") is False

    # 2. First 2 requests within limit
    ip = "203.0.113.50"
    assert limiter.check_rate_limit(ip) is None
    assert limiter.check_rate_limit(ip) is None

    # 3. Third request should be rate-limited (HTTP 429)
    resp = limiter.check_rate_limit(ip)
    assert resp is not None
    assert resp.status_code == 429
    assert resp.headers.get("retry-after") == "60"


def test_production_system_status_masking(monkeypatch):
    """Verify system paths are sanitized in production environment."""
    monkeypatch.setattr("backend.services.system_service.ENVIRONMENT", "production")
    invalidate_system_status_cache()

    status = get_system_status(force_refresh=True)
    assert status["paths"]["temp_dir"] == "managed-temp"
    assert status["paths"]["default_output_dir"] == "managed-storage"
    if status["libreoffice"]["installed"]:
        assert status["libreoffice"]["path"] == "managed-binary"
    if status["tesseract"]["installed"]:
        assert status["tesseract"]["path"] == "managed-binary"

    # Open in file explorer must be disabled in production
    res = open_in_file_explorer(str(TEMP_DIR))
    assert res["success"] is False
    assert "only available in local desktop mode" in res["error"]

    invalidate_system_status_cache()
