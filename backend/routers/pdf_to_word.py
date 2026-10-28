from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import Optional
from backend.services.pdf_to_word_service import convert_pdf_to_docx
from backend.security import validate_and_read_upload, conversion_slot, ALLOWED_PDF_EXTENSIONS

router = APIRouter(prefix="/api/pdf-to-word", tags=["PDF to Word"])

@router.post("/convert")
async def api_convert_pdf_to_docx(
    file: UploadFile = File(...),
    custom_output_dir: Optional[str] = Form(None)
):
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_PDF_EXTENSIONS
        )
        res = convert_pdf_to_docx(content, safe_name, custom_output_dir)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error"))
        return res
