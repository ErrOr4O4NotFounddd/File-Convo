from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List, Optional
from backend.services.document_service import convert_document_to_pdf
from backend.security import validate_and_read_upload, conversion_slot, ALLOWED_DOCUMENT_EXTENSIONS

router = APIRouter(prefix="/api/documents", tags=["Documents"])

@router.post("/convert")
async def convert_documents(
    files: List[UploadFile] = File(...),
    custom_output_dir: Optional[str] = Form(None)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    results = []
    async with conversion_slot():
        for file in files:
            content, safe_name = await validate_and_read_upload(
                file=file,
                allowed_extensions=ALLOWED_DOCUMENT_EXTENSIONS
            )
            res = convert_document_to_pdf(
                file_bytes=content,
                original_filename=safe_name,
                custom_output_dir=custom_output_dir
            )
            results.append(res)

    return {"results": results}
