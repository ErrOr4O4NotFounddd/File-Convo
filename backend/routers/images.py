from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List, Optional
from backend.services.image_service import process_image
from backend.security import validate_and_read_upload, conversion_slot, ALLOWED_IMAGE_EXTENSIONS

router = APIRouter(prefix="/api/images", tags=["Images"])

@router.post("/process")
@router.post("/process/")
async def api_process_images(
    files: List[UploadFile] = File(...),
    target_format: str = Form("auto"),
    quality: int = Form(80),
    enable_resize: bool = Form(False),
    resize_mode: str = Form("none"),  # none, pixels, percentage, max_dimensions
    target_width: Optional[int] = Form(None),
    target_height: Optional[int] = Form(None),
    resize_percentage: Optional[int] = Form(None),
    maintain_aspect_ratio: bool = Form(True),
    enable_target_size: bool = Form(False),
    target_size_kb: Optional[float] = Form(None),
    allow_png_fallback: bool = Form(True),
    auto_downscale: bool = Form(False),
    preserve_exif: bool = Form(True),
    bg_color_hex: str = Form("#ffffff"),
    custom_output_dir: Optional[str] = Form(None)
):
    if not files:
        raise HTTPException(status_code=400, detail="No image files uploaded.")

    if enable_target_size:
        if target_size_kb is None or target_size_kb <= 0:
            raise HTTPException(status_code=400, detail="Target size must be greater than 0 KB.")

    results = []
    async with conversion_slot():
        for file in files:
            content, safe_name = await validate_and_read_upload(
                file=file,
                allowed_extensions=ALLOWED_IMAGE_EXTENSIONS
            )
            res = process_image(
                input_bytes=content,
                original_filename=safe_name,
                target_format=target_format,
                quality=quality,
                enable_resize=enable_resize,
                resize_mode=resize_mode,
                target_width=target_width,
                target_height=target_height,
                resize_percentage=resize_percentage,
                maintain_aspect_ratio=maintain_aspect_ratio,
                enable_target_size=enable_target_size,
                target_size_kb=target_size_kb,
                allow_png_fallback=allow_png_fallback,
                auto_downscale=auto_downscale,
                preserve_exif=preserve_exif,
                bg_color_hex=bg_color_hex,
                custom_output_dir=custom_output_dir
            )
            results.append(res)

    return {"results": results}

@router.post("/compress-target-size")
@router.post("/compress-target-size/")
async def api_compress_target_size(
    files: List[UploadFile] = File(...),
    target_size_kb: float = Form(...),
    output_format: str = Form("auto"),  # auto, jpg, png, webp
    max_width: Optional[int] = Form(None),
    max_height: Optional[int] = Form(None),
    allow_png_fallback: bool = Form(True),
    auto_downscale: bool = Form(False),
    custom_output_dir: Optional[str] = Form(None)
):
    if not files:
        raise HTTPException(status_code=400, detail="No image files uploaded.")
    if target_size_kb <= 0:
        raise HTTPException(status_code=400, detail="Target size must be greater than 0 KB.")

    has_resize = bool(max_width or max_height)
    results = []
    async with conversion_slot():
        for file in files:
            content, safe_name = await validate_and_read_upload(
                file=file,
                allowed_extensions=ALLOWED_IMAGE_EXTENSIONS
            )
            res = process_image(
                input_bytes=content,
                original_filename=safe_name,
                target_format=output_format,
                enable_target_size=True,
                target_size_kb=target_size_kb,
                allow_png_fallback=allow_png_fallback,
                auto_downscale=auto_downscale,
                enable_resize=has_resize,
                resize_mode="max_dimensions" if has_resize else "none",
                target_width=max_width,
                target_height=max_height,
                maintain_aspect_ratio=True,
                custom_output_dir=custom_output_dir
            )
            results.append(res)

    return {"results": results}
