from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional
from backend.services.ocr_service import (
    ocr_image_to_text,
    ocr_pdf_to_text,
    ocr_pdf_to_searchable_pdf,
    ocr_pdf_to_docx
)
from backend.security import (
    validate_and_read_upload,
    conversion_slot,
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_PDF_EXTENSIONS
)

router = APIRouter(prefix="/api/ocr", tags=["OCR"])

@router.post("/image-to-text")
async def api_ocr_image_to_text(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_IMAGE_EXTENSIONS
        )
        res = ocr_image_to_text(content, safe_name, language, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/pdf-to-text")
async def api_ocr_pdf_to_text(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_PDF_EXTENSIONS
        )
        res = ocr_pdf_to_text(content, safe_name, language, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/searchable-pdf")
async def api_ocr_searchable_pdf(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_PDF_EXTENSIONS
        )
        res = ocr_pdf_to_searchable_pdf(content, safe_name, language, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res

@router.post("/pdf-to-docx")
async def api_ocr_pdf_to_docx(
    file: UploadFile = File(...),
    language: str = Form("eng"),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_PDF_EXTENSIONS
        )
        res = ocr_pdf_to_docx(content, safe_name, language, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res
