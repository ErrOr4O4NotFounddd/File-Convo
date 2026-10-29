import json
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List, Optional, Dict, Any
from pathlib import Path

from backend.services.scanner_service import (
    build_scanned_pdf,
    generate_scanner_thumbnail,
    process_scanner_preview,
    detect_document_corners,
    open_image_from_bytes
)
from backend.security import (
    validate_and_read_upload,
    sanitize_filename,
    conversion_slot,
    ALLOWED_IMAGE_EXTENSIONS,
    MAX_FILE_SIZE_MB
)

router = APIRouter(prefix="/api/scanner", tags=["Document Scanner"])

@router.post("/preview-file")
async def api_preview_scanner_file(file: UploadFile = File(...)):
    """
    Decodes an uploaded image (including iOS HEIC, WebP, PNG, JPEG),
    computes automatic document corner detection, and returns a web-compatible
    base64 JPEG thumbnail, natural dimensions, and detected corners.
    """
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_IMAGE_EXTENSIONS
        )
        try:
            res = generate_scanner_thumbnail(content, auto_detect=True)
            res["filename"] = safe_name
            return res
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to preview image: {str(e)}")

@router.post("/detect-corners")
async def api_detect_scanner_corners(file: UploadFile = File(...)):
    """
    Runs computer-vision document boundary detection on an image,
    returning the 4 corners [tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y]
    and confidence score.
    """
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_IMAGE_EXTENSIONS
        )
        try:
            img = open_image_from_bytes(content)
            corners, confidence = detect_document_corners(img)
            return {
                "success": True,
                "detected": corners is not None,
                "corners": corners,
                "confidence": confidence,
                "filename": safe_name
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to detect document corners: {str(e)}")

@router.post("/process-preview")
async def api_process_scanner_preview(
    file: UploadFile = File(...),
    rotation: int = Form(0),
    crop_quad: Optional[str] = Form(None),
    filter_type: str = Form("original")
):
    """
    Applies rotation, genuine perspective warp, and image processing filters
    to return a live preview thumbnail without saving or persisting.
    """
    async with conversion_slot():
        content, safe_name = await validate_and_read_upload(
            file=file,
            allowed_extensions=ALLOWED_IMAGE_EXTENSIONS
        )
        try:
            parsed_quad = None
            if crop_quad:
                try:
                    parsed_quad = json.loads(crop_quad)
                except Exception:
                    pass

            res = process_scanner_preview(
                data=content,
                rotation=rotation,
                crop_quad=parsed_quad,
                filter_type=filter_type
            )
            res["filename"] = safe_name
            return res
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to render preview: {str(e)}")

@router.post("/export-pdf")
async def api_export_scanned_pdf(
    files: List[UploadFile] = File(...),
    pages_config: str = Form("[]"),
    paper_size: str = Form("a4"),
    orientation: str = Form("portrait"),
    margin: str = Form("normal"),
    quality: str = Form("standard"),
    page_fit: str = Form("fit"),
    add_page_numbers: bool = Form(False),
    output_filename: str = Form("scanned_document.pdf"),
    custom_output_dir: Optional[str] = Form(None)
):
    """
    Combines scanned or uploaded document images into a clean PDF.
    Applies rotations, perspective crops, and document enhancement filters per page.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Please upload or capture at least one image.")

    # Parse per-page configuration JSON
    try:
        config_list: List[Dict[str, Any]] = json.loads(pages_config) if pages_config else []
    except Exception:
        config_list = []

    pages_data = []

    async with conversion_slot():
        for idx, f in enumerate(files):
            content, safe_name = await validate_and_read_upload(
                file=f,
                allowed_extensions=ALLOWED_IMAGE_EXTENSIONS
            )

            # Match config for this page if available
            p_conf = config_list[idx] if idx < len(config_list) and isinstance(config_list[idx], dict) else {}

            pages_data.append({
                "bytes": content,
                "filename": safe_name,
                "rotation": p_conf.get("rotation", 0),
                "crop_quad": p_conf.get("crop_quad"),
                "filter_type": p_conf.get("filter_type", "original")
            })

        res = build_scanned_pdf(
            pages_data=pages_data,
            paper_size=paper_size,
            orientation=orientation,
            margin_type=margin,
            quality=quality,
            page_fit=page_fit,
            add_page_numbers=add_page_numbers,
            output_filename=output_filename,
            custom_output_dir=custom_output_dir
        )

        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to generate scanned PDF."))

        return res
