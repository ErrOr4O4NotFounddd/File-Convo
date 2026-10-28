from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List, Optional
from backend.services.archive_service import create_zip, extract_zip
from backend.security import (
    validate_and_read_upload,
    sanitize_filename,
    conversion_slot,
    ALLOWED_ARCHIVE_EXTENSIONS,
    MAX_FILE_SIZE_MB
)

router = APIRouter(prefix="/api/archives", tags=["Archives"])

@router.post("/create-zip")
async def api_create_zip(
    files: List[UploadFile] = File(...),
    zip_name: str = Form("archive.zip"),
    custom_output_dir: Optional[str] = Form(None)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded to create ZIP.")

    safe_zip_name = sanitize_filename(zip_name, default="archive")
    if not safe_zip_name.lower().endswith(".zip"):
        safe_zip_name += ".zip"

    max_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    file_bytes_list = []
    filenames = []

    async with conversion_slot():
        for f in files:
            safe_fname = sanitize_filename(f.filename or "file")
            content = await f.read()
            if len(content) > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"File '{safe_fname}' exceeds size limit of {MAX_FILE_SIZE_MB}MB."
                )
            file_bytes_list.append(content)
            filenames.append(safe_fname)

        res = create_zip(file_bytes_list, filenames, safe_zip_name, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/extract-zip")
async def api_extract_zip(
    file: UploadFile = File(...),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_ARCHIVE_EXTENSIONS
        )
        res = extract_zip(content, safe_name, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res
