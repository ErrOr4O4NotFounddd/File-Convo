import mimetypes
import unicodedata
import urllib.parse
import re
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.services.system_service import (
    get_system_status,
    invalidate_system_status_cache,
    open_in_file_explorer,
    cleanup_temp_files
)
from backend.config import load_settings, save_settings, AppSettings, TEMP_DIR, TEMP_OUTPUT_DIR
from backend.security import sanitize_filename

router = APIRouter(prefix="/api/system", tags=["System"])

class OpenPathRequest(BaseModel):
    path: str

MIME_TYPE_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".zip": "application/zip",
    ".txt": "text/plain; charset=utf-8",
}

def get_media_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in MIME_TYPE_MAP:
        return MIME_TYPE_MAP[ext]
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"

def build_content_disposition(filename: str, disposition_type: str = "attachment") -> str:
    """
    Construct an RFC 6266 / RFC 5987 compliant Content-Disposition header.
    Provides an ASCII-safe fallback 'filename="<ascii>"' for older clients and Windows dialogs,
    and 'filename*=UTF-8''<encoded>' for modern browsers.
    """
    p = Path(filename)
    stem = p.stem
    ext = p.suffix.lower()

    # Create ASCII-safe fallback filename
    ascii_stem = unicodedata.normalize('NFKD', stem).encode('ascii', 'ignore').decode('ascii').strip()
    ascii_stem = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', ascii_stem).strip('_')
    if not ascii_stem:
        ascii_stem = "download"
    ascii_filename = f"{ascii_stem}{ext}"

    # UTF-8 URL-encoded filename
    utf8_encoded = urllib.parse.quote(filename, safe="")

    # If filename is simple ASCII without quotes or semicolons
    if re.match(r'^[a-zA-Z0-9_\-\. ]+$', filename) and '"' not in filename:
        return f'{disposition_type}; filename="{filename}"'
    else:
        return f'{disposition_type}; filename="{ascii_filename}"; filename*=UTF-8\'\'{utf8_encoded}'

@router.get("/status")
def system_status(refresh: bool = False):
    return get_system_status(force_refresh=refresh)

@router.get("/settings")
def get_settings():
    return load_settings().model_dump()

@router.post("/settings")
def update_settings(settings: AppSettings):
    updated = save_settings(settings)
    invalidate_system_status_cache()
    return {"success": True, "settings": updated.model_dump()}

@router.post("/open-explorer")
def open_explorer(req: OpenPathRequest):
    result = open_in_file_explorer(req.path)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result

@router.post("/cleanup-temp")
def cleanup_temp():
    count = cleanup_temp_files()
    return {"success": True, "files_removed": count}

@router.get("/download")
@router.get("/download/")
def download_file(path: str, filename: Optional[str] = None):
    p = Path(path).resolve()
    if not p.is_file():
        raise HTTPException(status_code=404, detail="File not found or expired")

    # Path traversal protection: Ensure target file is within authorized directories
    allowed_roots = [
        TEMP_DIR.resolve(),
        TEMP_OUTPUT_DIR.resolve(),
    ]
    settings = load_settings()
    if settings.default_output_dir and settings.default_output_dir.strip():
        allowed_roots.append(Path(settings.default_output_dir).resolve())

    def is_safe_path(target: Path, roots: List[Path]) -> bool:
        for root in roots:
            try:
                target.relative_to(root)
                return True
            except ValueError:
                continue
        return False

    if not is_safe_path(p, allowed_roots):
        raise HTTPException(status_code=403, detail="Access denied: unauthorized download path")

    # Determine canonical extension from the actual file on disk
    disk_ext = p.suffix.lower()
    if disk_ext in (".jpeg", ".jpg"):
        disk_ext = ".jpg"

    # Derive stem from provided filename or file on disk
    raw_name = filename.strip() if filename and filename.strip() else p.name
    raw_name = sanitize_filename(raw_name)
    stem = raw_name
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".pdf", ".docx", ".zip", ".bmp", ".tiff", ".tif", ".gif", ".txt"]:
        if stem.lower().endswith(ext):
            stem = stem[:-len(ext)].strip()
            break
    if not stem:
        stem = sanitize_filename(p.stem) or "download"

    # Strictly enforce correct extension matching the file on disk
    download_filename = f"{stem}{disk_ext}"
    media_type = get_media_type(download_filename)

    cd_header = build_content_disposition(download_filename, disposition_type="attachment")

    return FileResponse(
        path=str(p),
        media_type=media_type,
        headers={"content-disposition": cd_header}
    )
