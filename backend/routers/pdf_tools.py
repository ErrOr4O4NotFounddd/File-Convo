import json
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List, Optional
from backend.services.pdf_service import (
    merge_pdfs,
    split_pdf,
    extract_pdf_pages,
    compress_pdf,
    load_pdf_for_organizer,
    get_organizer_thumbnails,
    export_organized_pdf
)
from backend.security import (
    validate_and_read_upload,
    validate_content_signature,
    sanitize_filename,
    conversion_slot,
    ALLOWED_PDF_EXTENSIONS,
    MAX_FILE_SIZE_MB
)

router = APIRouter(prefix="/api/pdf", tags=["PDF Tools"])

@router.post("/merge")
async def api_merge_pdfs(
    files: List[UploadFile] = File(...),
    output_filename: str = Form("merged.pdf"),
    custom_output_dir: Optional[str] = Form(None)
):
    if not files or len(files) < 2:
        raise HTTPException(status_code=400, detail="Please upload at least 2 PDF files to merge.")

    safe_out_name = sanitize_filename(output_filename, default="merged.pdf")
    if not safe_out_name.lower().endswith(".pdf"):
        safe_out_name += ".pdf"

    bytes_list = []
    filenames = []
    async with conversion_slot():
        for f in files:
            content, safe_name = await validate_and_read_upload(
                file=f,
                allowed_extensions=ALLOWED_PDF_EXTENSIONS
            )
            bytes_list.append(content)
            filenames.append(safe_name)

        res = merge_pdfs(bytes_list, filenames, safe_out_name, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/split")
async def api_split_pdf(
    file: UploadFile = File(...),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_PDF_EXTENSIONS
        )
        res = split_pdf(content, safe_name, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/extract-pages")
async def api_extract_pages(
    file: UploadFile = File(...),
    page_ranges: str = Form(...),  # e.g. "1, 3-5, 8"
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_PDF_EXTENSIONS
        )
        res = extract_pdf_pages(content, safe_name, page_ranges, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/compress")
async def api_compress_pdf(
    file: UploadFile = File(...),
    compression_level: str = Form("medium"),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_PDF_EXTENSIONS
        )
        res = compress_pdf(content, safe_name, compression_level, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/organizer/upload")
def api_organizer_upload(
    file: UploadFile = File(...)
):
    safe_name = sanitize_filename(file.filename or "document.pdf")
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    max_bytes = MAX_FILE_SIZE_MB * 1024 * 1024
    try:
        if hasattr(file, "file") and hasattr(file.file, "read"):
            content = file.file.read(max_bytes + 1)
        elif hasattr(file, "read"):
            content = file.read(max_bytes + 1)
        else:
            content = b""
    except Exception:
        content = b""

    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_MB} MB.")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    validate_content_signature(content, ".pdf")
    res = load_pdf_for_organizer(content, safe_name)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res

@router.post("/organizer/thumbnails")
def api_organizer_thumbnails(
    file_id: str = Form(...),
    start_page: int = Form(0),
    count: int = Form(50)
):
    res = get_organizer_thumbnails(file_id, start_page, count)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res

@router.post("/organizer/export")
def api_organizer_export(
    pages: str = Form(...),
    output_filename: str = Form("organized_document.pdf"),
    custom_output_dir: Optional[str] = Form(None)
):
    try:
        pages_list = json.loads(pages)
        if not isinstance(pages_list, list):
            raise ValueError("Pages parameter must be a JSON array")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid pages format: {str(e)}")

    raw_out = output_filename if isinstance(output_filename, str) else "organized_document.pdf"
    out_name = sanitize_filename(raw_out, default="organized_document")
    if not out_name.lower().endswith(".pdf"):
        out_name += ".pdf"
    dir_str = custom_output_dir if isinstance(custom_output_dir, str) else None

    res = export_organized_pdf(pages_list, out_name, dir_str)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res
