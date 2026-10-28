import io
import os
import uuid
import base64
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from PIL import Image, ImageOps

# Register HEIF opener with pillow
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_AVAILABLE = True
except Exception:
    HEIF_AVAILABLE = False

from backend.config import TEMP_DIR, DEFAULT_OUTPUT_DIR, load_settings, get_output_dir
from backend.services.history_service import add_history_entry

def hex_to_rgb(hex_code: str) -> Tuple[int, int, int]:
    hex_code = hex_code.lstrip("#")
    if len(hex_code) == 3:
        hex_code = "".join([c * 2 for c in hex_code])
    if len(hex_code) == 6:
        return tuple(int(hex_code[i:i+2], 16) for i in (0, 2, 4))
    return (255, 255, 255)

def get_unique_output_path(output_dir: Path, filename: str) -> Path:
    stem = Path(filename).stem
    ext = Path(filename).suffix
    candidate = output_dir / f"{stem}{ext}"
    counter = 1
    while candidate.exists():
        candidate = output_dir / f"{stem}_{counter}{ext}"
        counter += 1
    return candidate

def make_thumb(image_obj: Image.Image) -> str:
    """Generate small base64 JPEG thumbnail preview."""
    try:
        thumb = image_obj.copy()
        thumb.thumbnail((240, 240))
        if thumb.mode not in ("RGB", "RGBA"):
            thumb = thumb.convert("RGB")
        elif thumb.mode == "RGBA":
            # Flatten with white background for JPEG preview
            bg = Image.new("RGB", thumb.size, (255, 255, 255))
            bg.paste(thumb, mask=thumb.split()[3])
            thumb = bg
        buf = io.BytesIO()
        thumb.save(buf, format="JPEG", quality=75)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception:
        return ""

def resolve_output_format(img: Image.Image, original_filename: str, requested_fmt: Optional[str]) -> str:
    """
    Resolve requested format string to normalized format: 'jpg', 'png', 'webp', or 'pdf'.
    Handles 'auto', None, MIME types, or source extension mapping.
    """
    raw_str = (requested_fmt or "auto").lower().strip()
    if raw_str.startswith("image/"):
        raw_str = raw_str[6:]
    fmt_str = raw_str.replace(".", "").strip()

    if fmt_str in ("jpeg", "jpg"):
        return "jpg"
    elif fmt_str in ("png", "webp", "pdf"):
        return fmt_str

    # 'auto' or unrecognized: inspect actual decoded image format first
    pillow_fmt = (getattr(img, "format", None) or "").upper()
    if pillow_fmt in ("JPEG", "JPG", "MPO"):
        return "jpg"
    elif pillow_fmt == "PNG":
        return "png"
    elif pillow_fmt == "WEBP":
        return "webp"
    elif pillow_fmt == "PDF":
        return "pdf"

    # Next infer from source file extension
    orig_ext = Path(original_filename or "").suffix.lower().lstrip(".")
    if orig_ext in ("jpg", "jpeg"):
        return "jpg"
    elif orig_ext == "png":
        return "png"
    elif orig_ext == "webp":
        return "webp"
    elif orig_ext == "pdf":
        return "pdf"
    else:
        # HEIC, BMP, TIFF, etc. Check if image has transparency
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        return "webp" if has_alpha else "jpg"

def apply_image_resize(
    img: Image.Image,
    resize_mode: str,
    target_width: Optional[int],
    target_height: Optional[int],
    resize_percentage: Optional[int],
    maintain_aspect_ratio: bool
) -> Image.Image:
    """
    Apply resizing to a PIL Image according to user configuration:
    - 'pixels': resize by width / height with optional aspect-ratio constraint
    - 'percentage': scale by percentage (e.g. 50% = half size)
    - 'max_dimensions': fit within max_width and max_height preserving aspect ratio
    """
    orig_width, orig_height = img.size
    new_width, new_height = orig_width, orig_height

    mode = (resize_mode or "none").lower().strip()

    if mode == "percentage" and resize_percentage and resize_percentage > 0:
        factor = resize_percentage / 100.0
        new_width = max(1, int(round(orig_width * factor)))
        new_height = max(1, int(round(orig_height * factor)))

    elif mode == "pixels":
        if target_width and target_height:
            if maintain_aspect_ratio:
                ratio = min(target_width / orig_width, target_height / orig_height)
                new_width = max(1, int(round(orig_width * ratio)))
                new_height = max(1, int(round(orig_height * ratio)))
            else:
                new_width = max(1, int(target_width))
                new_height = max(1, int(target_height))
        elif target_width:
            new_width = max(1, int(target_width))
            if maintain_aspect_ratio:
                ratio = target_width / orig_width
                new_height = max(1, int(round(orig_height * ratio)))
            else:
                new_height = orig_height
        elif target_height:
            new_height = max(1, int(target_height))
            if maintain_aspect_ratio:
                ratio = target_height / orig_height
                new_width = max(1, int(round(orig_width * ratio)))
            else:
                new_width = orig_width

    elif mode == "max_dimensions":
        scale = 1.0
        if target_width and target_width > 0:
            scale = min(scale, target_width / orig_width)
        if target_height and target_height > 0:
            scale = min(scale, target_height / orig_height)
        if scale < 1.0:
            new_width = max(1, int(round(orig_width * scale)))
            new_height = max(1, int(round(orig_height * scale)))

    if (new_width, new_height) != (orig_width, orig_height):
        return img.resize((new_width, new_height), Image.Resampling.LANCZOS)
    return img

def encode_lossy(source_img: Image.Image, format_str: str, quality_val: int, bg_color_hex: str = "#ffffff") -> bytes:
    """Helper to encode PIL image in memory at a specific lossy quality (JPEG / WebP)."""
    buf = io.BytesIO()
    fmt = format_str.lower().strip().replace(".", "")
    if fmt.startswith("image/"):
        fmt = fmt[6:]
    if fmt in ("jpg", "jpeg"):
        # Flatten alpha if present for JPEG
        if source_img.mode in ("RGBA", "LA") or (source_img.mode == "P" and "transparency" in source_img.info):
            bg = Image.new("RGB", source_img.size, hex_to_rgb(bg_color_hex))
            conv = source_img.convert("RGBA")
            bg.paste(conv, mask=conv.split()[3])
            encode_img = bg
        elif source_img.mode not in ("RGB", "L"):
            encode_img = source_img.convert("RGB")
        else:
            encode_img = source_img
        encode_img.save(buf, format="JPEG", quality=quality_val, optimize=True)
    elif fmt == "webp":
        encode_img = source_img
        if encode_img.mode not in ("RGB", "RGBA"):
            encode_img = encode_img.convert("RGBA" if "transparency" in encode_img.info else "RGB")
        encode_img.save(buf, format="WEBP", quality=quality_val, method=4)
    elif fmt == "png":
        source_img.save(buf, format="PNG", optimize=True, compress_level=9)
    return buf.getvalue()

def process_image(
    input_bytes: bytes,
    original_filename: str,
    target_format: str = "auto",  # auto, jpg, png, webp, pdf
    quality: int = 80,
    # Resizing Controls
    enable_resize: bool = False,
    resize_mode: str = "none",  # none, pixels, percentage, max_dimensions
    target_width: Optional[int] = None,
    target_height: Optional[int] = None,
    resize_percentage: Optional[int] = None,
    maintain_aspect_ratio: bool = True,
    # Target-size Compression Controls (Mode B)
    enable_target_size: bool = False,
    target_size_kb: Optional[float] = None,
    allow_png_fallback: bool = True,
    auto_downscale: bool = False,
    # Output Settings
    preserve_exif: bool = True,
    bg_color_hex: str = "#ffffff",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Unified Image Processing Engine supporting:
    - Mode A: Standard Compression & Optimization (Default)
    - Mode B: Iterative Target File Size Compression (Optional)
    - Exact, percentage, and max-dimension resizing with aspect-ratio preservation
    """
    original_size = len(input_bytes)
    if original_size == 0:
        return {"success": False, "error": "Empty input file", "original_filename": original_filename}

    output_dir = get_output_dir(custom_output_dir)

    try:
        raw_img = Image.open(io.BytesIO(input_bytes))
        img = ImageOps.exif_transpose(raw_img) or raw_img
    except Exception as e:
        error_msg = f"Failed to open image: {str(e)}. "
        if original_filename.lower().endswith((".heic", ".heif")) and not HEIF_AVAILABLE:
            error_msg += "HEIC decoder (pillow-heif) is missing or failed to initialize."
        add_history_entry(original_filename, "Image Optimizer", "error", error_message=error_msg)
        return {
            "success": False,
            "error": error_msg,
            "original_filename": original_filename
        }

    orig_width, orig_height = img.size
    before_preview = make_thumb(img)

    # Extract EXIF if available and requested
    exif_data = None
    if preserve_exif:
        try:
            exif_data = img.info.get("exif")
        except Exception:
            pass

    # Resolve output format
    out_format = resolve_output_format(img, original_filename, target_format)

    # Apply explicit resizing if enabled
    should_resize = enable_resize or (resize_mode and resize_mode != "none")
    if should_resize and resize_mode != "none":
        img = apply_image_resize(
            img=img,
            resize_mode=resize_mode,
            target_width=target_width,
            target_height=target_height,
            resize_percentage=resize_percentage,
            maintain_aspect_ratio=maintain_aspect_ratio
        )

    current_width, current_height = img.size

    # Variables for compression reporting
    final_bytes: Optional[bytes] = None
    target_achieved: Optional[bool] = None
    target_explanation: Optional[str] = None
    fidelity_warning: Optional[str] = None
    quality_used: Optional[int] = None
    chosen_format = out_format

    # -------------------------------------------------------------
    # MODE B: Iterative Target File Size Compression (When Enabled)
    # -------------------------------------------------------------
    if enable_target_size and target_size_kb is not None and target_size_kb > 0:
        target_size_bytes = int(target_size_kb * 1024)

        # Check if already within target: only preserve input_bytes if the ACTUAL decoded
        # image format strictly matches the target format!
        actual_source_format = (raw_img.format or "").upper()
        expected_pillow_format = "JPEG" if out_format == "jpg" else out_format.upper()
        is_same_encoded_format = (actual_source_format == expected_pillow_format)
        is_same_dim = (current_width == orig_width and current_height == orig_height)

        if original_size <= target_size_bytes and is_same_encoded_format and is_same_dim:
            final_bytes = input_bytes
            target_achieved = True
            quality_used = None
            target_explanation = (
                f"Original image is already smaller than the target size "
                f"({original_size / 1024:.1f} KB ≤ {target_size_kb:.1f} KB). "
                f"Preserved original file without lossy re-compression."
            )
        else:
            # PNG target size strategy
            if out_format == "png":
                # 1. Lossless PNG
                buf = io.BytesIO()
                img.save(buf, format="PNG", optimize=True, compress_level=9)
                lossless_bytes = buf.getvalue()
                lossless_size = len(lossless_bytes)

                if lossless_size <= target_size_bytes:
                    final_bytes = lossless_bytes
                    target_achieved = True
                    target_explanation = (
                        f"Target achieved with lossless PNG optimization "
                        f"({lossless_size / 1024:.1f} KB ≤ {target_size_kb:.1f} KB). "
                        f"Full pixel fidelity preserved."
                    )
                else:
                    # 2. 8-bit adaptive color quantization
                    quant_bytes = None
                    try:
                        q_img = img.quantize(colors=256)
                        q_buf = io.BytesIO()
                        q_img.save(q_buf, format="PNG", optimize=True, compress_level=9)
                        quant_bytes = q_buf.getvalue()
                    except Exception:
                        quant_bytes = None

                    if quant_bytes and len(quant_bytes) <= target_size_bytes:
                        final_bytes = quant_bytes
                        target_achieved = True
                        target_explanation = (
                            f"Target achieved with 8-bit adaptive color palette PNG optimization "
                            f"({len(quant_bytes) / 1024:.1f} KB ≤ {target_size_kb:.1f} KB). "
                            f"Transparency preserved."
                        )
                    elif allow_png_fallback:
                        # 3. Fallback to WebP or JPG
                        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
                        fallback_fmt = "webp" if has_alpha else "jpg"

                        low, high = 5, 95
                        best_fb_bytes: Optional[bytes] = None
                        best_fb_q: Optional[int] = None

                        while low <= high:
                            mid = (low + high) // 2
                            attempt = encode_lossy(img, fallback_fmt, mid, bg_color_hex)
                            if len(attempt) <= target_size_bytes:
                                best_fb_bytes = attempt
                                best_fb_q = mid
                                low = mid + 1
                            else:
                                high = mid - 1

                        if best_fb_bytes is not None:
                            final_bytes = best_fb_bytes
                            chosen_format = fallback_fmt
                            target_achieved = True
                            quality_used = best_fb_q
                            alpha_note = "Transparency was preserved via WebP encoding." if fallback_fmt == "webp" else "Transparency was composited onto background."
                            fidelity_warning = (
                                f"Notice: Lossless PNG could not reach target size ({lossless_size / 1024:.1f} KB). "
                                f"Converted to {fallback_fmt.upper()} at {best_fb_q}% quality to meet target size. "
                                f"{alpha_note}"
                            )
                            target_explanation = (
                                f"Target achieved ({len(final_bytes) / 1024:.1f} KB ≤ {target_size_kb:.1f} KB) "
                                f"by converting to {fallback_fmt.upper()} at quality {best_fb_q}%."
                            )
                        else:
                            final_bytes = quant_bytes if (quant_bytes and len(quant_bytes) < lossless_size) else lossless_bytes
                            target_achieved = False
                            target_explanation = (
                                f"Target size ({target_size_kb:.1f} KB) cannot be reached in PNG "
                                f"(lossless: {lossless_size / 1024:.1f} KB). Closest PNG result is {len(final_bytes) / 1024:.1f} KB."
                            )
                    else:
                        final_bytes = quant_bytes if (quant_bytes and len(quant_bytes) < lossless_size) else lossless_bytes
                        target_achieved = False
                        target_explanation = (
                            f"Target size ({target_size_kb:.1f} KB) cannot be reached in lossless PNG "
                            f"(lossless: {lossless_size / 1024:.1f} KB, 8-bit: {len(final_bytes) / 1024:.1f} KB). "
                            f"Enable format fallback or select WebP/JPG to reach this size."
                        )

            # Lossy formats (JPEG / WebP)
            elif out_format in ("jpg", "webp"):
                working_img = img.copy()

                def run_binary_search(src_img: Image.Image, fmt: str) -> Tuple[Optional[bytes], Optional[int], bytes]:
                    low, high = 5, 95
                    best_b: Optional[bytes] = None
                    best_q: Optional[int] = None
                    min_q_bytes = encode_lossy(src_img, fmt, 5, bg_color_hex)

                    while low <= high:
                        mid = (low + high) // 2
                        attempt = encode_lossy(src_img, fmt, mid, bg_color_hex)
                        if len(attempt) <= target_size_bytes:
                            best_b = attempt
                            best_q = mid
                            low = mid + 1
                        else:
                            high = mid - 1
                    return best_b, best_q, min_q_bytes

                best_b, best_q, min_q_b = run_binary_search(working_img, out_format)

                # Optional resolution downscaling fallback
                if best_b is None and auto_downscale:
                    for scale_factor in [0.75, 0.50, 0.35, 0.25]:
                        down_w = max(1, int(current_width * scale_factor))
                        down_h = max(1, int(current_height * scale_factor))
                        down_img = working_img.resize((down_w, down_h), Image.Resampling.LANCZOS)
                        down_b, down_q, down_min_b = run_binary_search(down_img, out_format)
                        if down_b is not None:
                            best_b = down_b
                            best_q = down_q
                            img = down_img
                            current_width, current_height = down_w, down_h
                            fidelity_warning = f"Resolution was automatically scaled to {down_w}×{down_h} to meet the target file size."
                            break
                        else:
                            min_q_b = down_min_b

                if best_b is not None:
                    final_bytes = best_b
                    target_achieved = True
                    quality_used = best_q
                    target_explanation = (
                        f"Target achieved at quality {best_q}% "
                        f"({len(final_bytes) / 1024:.1f} KB ≤ {target_size_kb:.1f} KB)."
                    )
                else:
                    final_bytes = min_q_b
                    quality_used = 5
                    target_achieved = False
                    target_explanation = (
                        f"Target size ({target_size_kb:.1f} KB) is too aggressive for {current_width}×{current_height} "
                        f"resolution at minimum acceptable quality (5%). Closest achievable result is "
                        f"{len(final_bytes) / 1024:.1f} KB."
                    )
            else:
                # PDF target size fallback
                buf = io.BytesIO()
                pdf_img = img.convert("RGB") if img.mode != "RGB" else img
                pdf_img.save(buf, format="PDF")
                final_bytes = buf.getvalue()
                target_achieved = len(final_bytes) <= target_size_bytes
                target_explanation = f"PDF output generated ({len(final_bytes) / 1024:.1f} KB)."

    # -------------------------------------------------------------
    # MODE A: Standard Compression & Optimization (Default Mode)
    # -------------------------------------------------------------
    else:
        buf = io.BytesIO()
        save_format = out_format.upper()
        save_kwargs: Dict[str, Any] = {}

        if out_format == "jpg":
            save_format = "JPEG"
            save_kwargs["quality"] = max(10, min(100, quality))
            save_kwargs["optimize"] = True
            quality_used = save_kwargs["quality"]

            # Flatten alpha if present
            needs_flatten = (img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info))
            if needs_flatten:
                bg_rgb = hex_to_rgb(bg_color_hex)
                background = Image.new("RGB", img.size, bg_rgb)
                conv = img.convert("RGBA") if img.mode != "RGBA" else img
                background.paste(conv, mask=conv.split()[3])
                img = background
            elif img.mode != "RGB":
                img = img.convert("RGB")

        elif out_format == "png":
            save_format = "PNG"
            save_kwargs["optimize"] = True
            save_kwargs["compress_level"] = 9

        elif out_format == "webp":
            save_format = "WEBP"
            save_kwargs["quality"] = max(10, min(100, quality))
            save_kwargs["method"] = 6
            quality_used = save_kwargs["quality"]

        elif out_format == "pdf":
            save_format = "PDF"
            if img.mode != "RGB":
                img = img.convert("RGB")

        if preserve_exif and exif_data and out_format in ["jpg", "webp"]:
            save_kwargs["exif"] = exif_data

        try:
            img.save(buf, format=save_format, **save_kwargs)
            final_bytes = buf.getvalue()
        except Exception as e:
            error_msg = f"Failed to encode {out_format.upper()}: {str(e)}"
            add_history_entry(original_filename, f"Image → {out_format.upper()}", "error", error_message=error_msg)
            return {
                "success": False,
                "error": error_msg,
                "original_filename": original_filename
            }

    # Save to disk with guaranteed valid filename stem and strictly normalized extension
    p_orig = Path(original_filename or "image")
    out_stem = p_orig.stem.strip()
    if not out_stem or out_stem == ".":
        out_stem = "image"
    # Strip any trailing known extensions from out_stem (e.g. if original was photo.jpg or photo.png)
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp", ".tiff", ".tif", ".gif", ".pdf"]:
        if out_stem.lower().endswith(ext):
            out_stem = out_stem[:-len(ext)].strip()
            break
    if not out_stem:
        out_stem = "image"

    # Normalize extension: strictly .jpg for JPEG, .png for PNG, .webp for WebP, .pdf for PDF
    if chosen_format.lower() in ("jpg", "jpeg"):
        suffix = ".jpg"
    elif chosen_format.lower() == "png":
        suffix = ".png"
    elif chosen_format.lower() == "webp":
        suffix = ".webp"
    elif chosen_format.lower() == "pdf":
        suffix = ".pdf"
    else:
        suffix = f".{chosen_format.lower()}"

    # Use _optimized or _target_<size>k suffix
    tag = f"target_{int(target_size_kb or 0)}k" if enable_target_size else "optimized"
    out_filename = f"{out_stem}_{tag}{suffix}"
    out_path = get_unique_output_path(output_dir, out_filename)
    out_path.write_bytes(final_bytes)

    output_size = len(final_bytes)
    bytes_saved = original_size - output_size
    percent_saved = round((bytes_saved / original_size) * 100, 2) if original_size > 0 else 0

    try:
        final_pil = Image.open(io.BytesIO(final_bytes))
        after_preview = make_thumb(final_pil)
        final_dims = {"width": final_pil.width, "height": final_pil.height}
    except Exception:
        after_preview = before_preview
        final_dims = {"width": current_width, "height": current_height}

    stats = {
        "original_size": original_size,
        "output_size": output_size,
        "bytes_saved": bytes_saved,
        "percent_saved": percent_saved,
        "original_dimensions": {"width": orig_width, "height": orig_height},
        "output_dimensions": final_dims,
        "output_format": chosen_format.upper(),
        "quality_used": quality_used,
        "before_preview": before_preview,
        "after_preview": after_preview,
        "download_url": f"/api/system/download?path={str(out_path)}&filename={out_path.name}",
    }

    if enable_target_size and target_size_kb:
        stats["target_size"] = int(target_size_kb * 1024)
        stats["target_achieved"] = target_achieved
        stats["target_explanation"] = target_explanation
        stats["fidelity_warning"] = fidelity_warning

    history_type = (
        f"Target Compressor ({int(target_size_kb)} KB)"
        if enable_target_size and target_size_kb
        else f"Image Optimizer → {chosen_format.upper()}"
    )

    add_history_entry(
        original_filename=original_filename,
        conversion_type=history_type,
        status="success" if (target_achieved is not False) else "warning",
        output_location=str(out_path),
        details=stats
    )

    return {
        "success": True,
        "output_path": str(out_path),
        "output_filename": out_path.name,
        "target_achieved": target_achieved,
        "target_explanation": target_explanation,
        "fidelity_warning": fidelity_warning,
        "stats": stats
    }

def compress_to_target_size(
    input_bytes: bytes,
    original_filename: str,
    target_size_bytes: int,
    output_format: str = "auto",
    max_width: Optional[int] = None,
    max_height: Optional[int] = None,
    allow_png_fallback: bool = True,
    auto_downscale: bool = False,
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Backward-compatible target file size compression wrapper delegating to process_image.
    """
    target_kb = target_size_bytes / 1024.0
    has_resize = bool(max_width or max_height)
    return process_image(
        input_bytes=input_bytes,
        original_filename=original_filename,
        target_format=output_format,
        enable_target_size=True,
        target_size_kb=target_kb,
        allow_png_fallback=allow_png_fallback,
        auto_downscale=auto_downscale,
        enable_resize=has_resize,
        resize_mode="max_dimensions" if has_resize else "none",
        target_width=max_width,
        target_height=max_height,
        maintain_aspect_ratio=True,
        custom_output_dir=custom_output_dir
    )
