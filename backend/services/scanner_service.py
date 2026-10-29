import io
import math
import uuid
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import cv2
import numpy as np
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
import pymupdf as fitz

# Ensure HEIF support is registered if available
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pass

from backend.config import TEMP_DIR, get_output_dir
from backend.security import sanitize_filename

# Paper dimensions in PDF points (72 points = 1 inch)
PAPER_SIZES = {
    "a4": (595.0, 842.0),
    "letter": (612.0, 792.0),
}

def get_unique_output_path(output_dir: Path, filename: str) -> Path:
    stem = Path(filename).stem
    ext = Path(filename).suffix
    candidate = output_dir / f"{stem}{ext}"
    counter = 1
    while candidate.exists():
        candidate = output_dir / f"{stem}_{counter}{ext}"
        counter += 1
    return candidate

def open_image_from_bytes(data: bytes) -> Image.Image:
    """
    Safely opens an image from bytes, handling EXIF orientation,
    HEIC, PNG, JPEG, WebP, etc. Always converts to RGB or RGBA.
    """
    img = Image.open(io.BytesIO(data))
    try:
        # Transpose according to EXIF orientation tag if present
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    if img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")
    return img

def order_quad_points(pts: np.ndarray) -> np.ndarray:
    """
    Orders 4 quadrilateral coordinates consistently into:
    [Top-Left, Top-Right, Bottom-Right, Bottom-Left].
    pts: (4, 2) array of (x, y) coordinates.
    """
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]  # TL (smallest sum x + y)
    rect[2] = pts[np.argmax(s)]  # BR (largest sum x + y)

    diff = np.diff(pts, axis=1).reshape(-1)  # y - x
    rect[1] = pts[np.argmin(diff)]  # TR (most negative y - x, i.e. large x, small y)
    rect[3] = pts[np.argmax(diff)]  # BL (most positive y - x, i.e. small x, large y)
    return rect

def detect_document_corners(img: Image.Image) -> Tuple[Optional[List[float]], float]:
    """
    Detects the 4 corners of a physical document sheet using robust computer vision.
    Suppresses high-frequency text characters to isolate the macroscopic sheet boundary.
    Returns normalized coordinates [tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y] in 0.0..1.0
    and confidence score (0.0..1.0).
    If no reliable document boundary is detected, returns (None, 0.0).
    """
    if img.mode != "RGB":
        rgb_img = img.convert("RGB")
    else:
        rgb_img = img
    img_np = np.array(rgb_img)
    img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

    orig_h, orig_w = img_bgr.shape[:2]
    if orig_h < 40 or orig_w < 40:
        return None, 0.0

    # Downscale for edge and contour detection (max 800px)
    max_dim = 800.0
    scale = min(1.0, max_dim / max(orig_h, orig_w))
    if scale < 1.0:
        proc_w = max(10, int(round(orig_w * scale)))
        proc_h = max(10, int(round(orig_h * scale)))
        proc = cv2.resize(img_bgr, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
    else:
        proc = img_bgr.copy()
        scale = 1.0

    proc_h, proc_w = proc.shape[:2]
    img_area = float(proc_w * proc_h)

    gray = cv2.cvtColor(proc, cv2.COLOR_BGR2GRAY)

    # Text suppression: large median blur completely wipes out small printed text (2-8px)
    # leaving only macroscopic sheet boundaries against desks or backgrounds
    med_k = max(9, min(25, (min(proc_w, proc_h) // 32) | 1))
    suppressed = cv2.medianBlur(gray, med_k)
    suppressed = cv2.morphologyEx(suppressed, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)))

    # Edge Map 1: Canny on text-suppressed image
    v = float(np.median(suppressed))
    lower = int(max(15, 0.45 * v))
    upper = int(min(240, 1.35 * v))
    edges1 = cv2.Canny(suppressed, lower, upper)
    edges1 = cv2.dilate(edges1, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))

    # Edge Map 2: Otsu threshold on suppressed image
    _, otsu = cv2.threshold(suppressed, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edges2 = cv2.Canny(cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))), 50, 150)

    # Edge Map 3: Morphological gradient (region boundaries)
    grad = cv2.morphologyEx(suppressed, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    _, edges3 = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    candidates = []

    for edge_map in [edges1, edges2, edges3]:
        contours, _ = cv2.findContours(edge_map, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < 0.12 * img_area or area > 0.98 * img_area:
                continue

            peri = cv2.arcLength(c, True)
            hull = cv2.convexHull(c)
            hull_area = float(cv2.contourArea(hull))
            if hull_area <= 0:
                continue
            solidity = area / hull_area

            # Strategy A: Direct approxPolyDP
            quad_found = False
            for eps in [0.02, 0.03, 0.04, 0.05, 0.07]:
                approx = cv2.approxPolyDP(c, eps * peri, True)
                if len(approx) == 4 and cv2.isContourConvex(approx):
                    pts_cand = approx.reshape(4, 2)
                    ordered = order_quad_points(pts_cand)
                    quad_found = True
                    break

            # Strategy B: Diagonal extremals on convex hull (robust to rounded corners or staple marks)
            if not quad_found and solidity > 0.80 and len(hull) >= 4:
                h_pts = hull.reshape(-1, 2)
                s_diag = h_pts[:, 0] + h_pts[:, 1]
                d_diag = h_pts[:, 0] - h_pts[:, 1]
                tl = h_pts[np.argmin(s_diag)]
                br = h_pts[np.argmax(s_diag)]
                tr = h_pts[np.argmax(d_diag)]
                bl = h_pts[np.argmin(d_diag)]
                ordered = np.array([tl, tr, br, bl], dtype=np.float32)
                quad_found = True

            if quad_found:
                # Check angles are plausible for a document (roughly 50 to 130 degrees)
                v1 = ordered[1] - ordered[0]
                v2 = ordered[2] - ordered[1]
                v3 = ordered[3] - ordered[2]
                v4 = ordered[0] - ordered[3]

                def angle_cos(u, v):
                    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
                    return abs(float(np.dot(u, v)) / (nu * nv)) if (nu * nv) > 0 else 1.0

                max_cos = max(angle_cos(v1, v2), angle_cos(v2, v3), angle_cos(v3, v4), angle_cos(v4, v1))
                if max_cos < 0.65:
                    score = (area / img_area) * (1.0 - max_cos * 0.4)
                    candidates.append((score, ordered))

    if not candidates:
        return None, 0.0

    candidates.sort(key=lambda x: x[0], reverse=True)
    best_score, best_pts = candidates[0]
    orig_pts = best_pts / scale

    norm_coords = []
    for pt in orig_pts:
        nx = max(0.0, min(1.0, float(pt[0] / orig_w)))
        ny = max(0.0, min(1.0, float(pt[1] / orig_h)))
        norm_coords.extend([round(nx, 5), round(ny, 5)])

    confidence = min(1.0, max(0.0, float(best_score * 1.4)))
    return norm_coords, confidence

def apply_perspective_quad(img: Image.Image, quad: List[float]) -> Image.Image:
    """
    Applies genuine 3x3 projective homography (CamScanner style).
    quad format: [tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y]
    Coordinates can be absolute pixels or normalized (0..1).
    Rectifies rotated and trapezoidal documents photographed at an angle into a flat rectangular document.
    """
    if len(quad) != 8:
        return img

    w, h = img.size
    is_normalized = all(0.0 <= float(c) <= 1.01 for c in quad)

    if is_normalized:
        coords = [
            quad[0] * w, quad[1] * h,  # TL
            quad[2] * w, quad[3] * h,  # TR
            quad[4] * w, quad[5] * h,  # BR
            quad[6] * w, quad[7] * h,  # BL
        ]
    else:
        coords = [float(c) for c in quad]

    tl = np.array([coords[0], coords[1]], dtype=np.float32)
    tr = np.array([coords[2], coords[3]], dtype=np.float32)
    br = np.array([coords[4], coords[5]], dtype=np.float32)
    bl = np.array([coords[6], coords[7]], dtype=np.float32)

    width_top = float(np.hypot(tr[0] - tl[0], tr[1] - tl[1]))
    width_bottom = float(np.hypot(br[0] - bl[0], br[1] - bl[1]))
    target_w = max(20, int(round(max(width_top, width_bottom))))

    height_left = float(np.hypot(bl[0] - tl[0], bl[1] - tl[1]))
    height_right = float(np.hypot(br[0] - tr[0], br[1] - tr[1]))
    target_h = max(20, int(round(max(height_left, height_right))))

    src_pts = np.array([tl, tr, br, bl], dtype=np.float32)
    dst_pts = np.array([
        [0.0, 0.0],
        [float(target_w - 1), 0.0],
        [float(target_w - 1), float(target_h - 1)],
        [0.0, float(target_h - 1)]
    ], dtype=np.float32)

    try:
        M = cv2.getPerspectiveTransform(src_pts, dst_pts)

        if img.mode != "RGB":
            rgb_img = img.convert("RGB")
        else:
            rgb_img = img
        img_np = np.array(rgb_img)
        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

        warped_bgr = cv2.warpPerspective(
            img_bgr,
            M,
            (target_w, target_h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE
        )

        warped_rgb = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2RGB)
        return Image.fromarray(warped_rgb)
    except Exception:
        return img

def apply_scanner_filter(img: Image.Image, filter_type: str, intensity: float = 1.0) -> Image.Image:
    """
    Applies genuine document enhancement filters:
    - original: unmodified original photo
    - magic_color: CamScanner-style background illumination normalization, eliminating deep shadows
      and center folds, turning paper into clean white while preserving vibrant ink, signatures, and stamps.
    - auto_enhance: balanced soft illumination correction, contrast boost, and clarity.
    - grayscale: crisp monochrome with illumination normalization, eliminating shadows.
    - black_white: illumination-normalized adaptive Gaussian thresholding, pure white background, crisp dark text.
    """
    f_type = (filter_type or "original").lower().strip()

    if f_type in ("original", "none", "off"):
        if img.mode != "RGB":
            return img.convert("RGB")
        return img

    if img.mode != "RGB":
        rgb_img = img.convert("RGB")
    else:
        rgb_img = img
    img_np = np.array(rgb_img)
    bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]

    # Structuring element size scaled to document dimensions
    # Covers text line height and word gaps to estimate the continuous paper illumination surface
    k_size = max(31, min(75, (min(h, w) // 18) | 1))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))

    if f_type in ("black_white", "bw", "b&w", "black_and_white"):
        # Real adaptive thresholding with illumination normalization:
        # Step 1: Normalize grayscale background so shadows (hand, phone, fold) are removed first
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        closed = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
        bg = cv2.GaussianBlur(closed, (15, 15), 0)
        bg_f = np.maximum(bg.astype(np.float32), 1.0)
        norm_gray = np.clip((gray.astype(np.float32) / bg_f) * 255.0, 0, 255).astype(np.uint8)

        # Step 2: Adaptive Gaussian thresholding on shadow-free normalized image
        block_size = max(15, (w // 30) | 1)
        c_val = int(round(12.0 * intensity))
        bw = cv2.adaptiveThreshold(
            norm_gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            block_size,
            c_val
        )

        # Step 3: Remove isolated 1-pixel speckles
        kernel_denoise = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        bw_clean = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kernel_denoise)

        res_rgb = cv2.cvtColor(bw_clean, cv2.COLOR_GRAY2RGB)
        return Image.fromarray(res_rgb)

    elif f_type in ("magic_color", "magic", "document_color", "document", "camscanner"):
        # CamScanner Magic Color:
        # Step 1: Per-channel morphological closing to estimate background illumination
        norm_channels = []
        for c in range(3):
            ch = bgr[:, :, c]
            closed = cv2.morphologyEx(ch, cv2.MORPH_CLOSE, kernel)
            bg = cv2.GaussianBlur(closed, (15, 15), 0)
            bg_f = np.maximum(bg.astype(np.float32), 1.0)
            norm_ch = (ch.astype(np.float32) / bg_f) * 255.0
            norm_channels.append(norm_ch)

        norm_bgr = cv2.merge(norm_channels)

        # Step 2: Paper background mapping to pure clean white
        gray_norm = cv2.cvtColor(np.clip(norm_bgr, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
        p_white = float(np.percentile(gray_norm, 75))
        white_pt = max(210.0, min(235.0, p_white))
        p_black = float(np.percentile(gray_norm, 1.5))
        black_pt = max(0.0, min(35.0, p_black))

        scale = 255.0 / max(1.0, (white_pt - black_pt))
        clean_bgr = np.clip((norm_bgr - black_pt) * scale, 0, 255).astype(np.uint8)

        # Step 3: Boost saturation of colored ink, signatures, and stamps
        hsv = cv2.cvtColor(clean_bgr, cv2.COLOR_BGR2HSV)
        h_ch, s_ch, v_ch = cv2.split(hsv)
        s_boosted = np.where(s_ch > 20, np.clip(s_ch.astype(np.float32) * 1.25, 0, 255).astype(np.uint8), s_ch)
        hsv_boosted = cv2.merge([h_ch, s_boosted, v_ch])
        clean_bgr = cv2.cvtColor(hsv_boosted, cv2.COLOR_HSV2BGR)

        # Step 4: Subtle unsharp mask for crisp text edges
        blur = cv2.GaussianBlur(clean_bgr, (0, 0), 1.0)
        sharp = cv2.addWeighted(clean_bgr, 1.25, blur, -0.25, 0)
        res_rgb = cv2.cvtColor(sharp, cv2.COLOR_BGR2RGB)
        return Image.fromarray(res_rgb)

    elif f_type in ("auto_enhance", "enhanced", "auto", "enhance"):
        # Auto Enhance: Balanced natural illumination correction
        norm_channels = []
        for c in range(3):
            ch = bgr[:, :, c]
            closed = cv2.morphologyEx(ch, cv2.MORPH_CLOSE, kernel)
            bg = cv2.GaussianBlur(closed, (15, 15), 0)
            bg_f = np.maximum(bg.astype(np.float32), 1.0)
            norm_ch = (ch.astype(np.float32) / bg_f) * 255.0
            norm_channels.append(norm_ch)

        norm_bgr = cv2.merge(norm_channels)

        # Soft blend: 75% normalized + 25% original to maintain photographic depth
        blended = np.clip(norm_bgr * 0.75 + bgr.astype(np.float32) * 0.25, 0, 255).astype(np.uint8)

        # Conservative CLAHE
        lab = cv2.cvtColor(blended, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=1.3, tileGridSize=(8, 8))
        enhanced_l = clahe.apply(l)

        merged_lab = cv2.merge([enhanced_l, a, b])
        res_bgr = cv2.cvtColor(merged_lab, cv2.COLOR_LAB2BGR)

        blur = cv2.GaussianBlur(res_bgr, (0, 0), 1.0)
        sharp = cv2.addWeighted(res_bgr, 1.20, blur, -0.20, 0)
        res_rgb = cv2.cvtColor(sharp, cv2.COLOR_BGR2RGB)
        return Image.fromarray(res_rgb)

    elif f_type == "grayscale":
        # Grayscale with illumination normalization
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        closed = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
        bg = cv2.GaussianBlur(closed, (15, 15), 0)
        bg_f = np.maximum(bg.astype(np.float32), 1.0)
        norm_gray = (gray.astype(np.float32) / bg_f) * 255.0

        p_white = float(np.percentile(norm_gray, 75))
        white_pt = max(210.0, min(235.0, p_white))
        p_black = float(np.percentile(norm_gray, 1.5))
        black_pt = max(0.0, min(35.0, p_black))

        scale = 255.0 / max(1.0, (white_pt - black_pt))
        clean_gray = np.clip((norm_gray - black_pt) * scale, 0, 255).astype(np.uint8)

        blur = cv2.GaussianBlur(clean_gray, (0, 0), 1.0)
        sharp = cv2.addWeighted(clean_gray, 1.25, blur, -0.25, 0)

        res_rgb = cv2.cvtColor(sharp, cv2.COLOR_GRAY2RGB)
        return Image.fromarray(res_rgb)

    if img.mode != "RGB":
        return img.convert("RGB")
    return img

def generate_scanner_thumbnail(data: bytes, max_dim: int = 500, auto_detect: bool = True) -> Dict[str, Any]:
    """
    Generates a fast base64 JPEG thumbnail, metadata, and automatic document corner detection.
    When a document is detected, generates the rectified, Magic Color enhanced thumbnail
    for the card preview, along with original_thumbnail for the crop modal.
    """
    import base64
    img = open_image_from_bytes(data)
    orig_w, orig_h = img.size

    detected_corners = None
    confidence = 0.0

    if auto_detect:
        try:
            detected_corners, confidence = detect_document_corners(img)
        except Exception:
            detected_corners = None
            confidence = 0.0

    # Raw uncropped thumbnail (used by crop adjustment modal)
    orig_thumb = img.copy()
    orig_thumb.thumbnail((max_dim, max_dim), Image.Resampling.BILINEAR)
    if orig_thumb.mode != "RGB":
        orig_thumb = orig_thumb.convert("RGB")
    buf_orig = io.BytesIO()
    orig_thumb.save(buf_orig, format="JPEG", quality=80)
    b64_orig = "data:image/jpeg;base64," + base64.b64encode(buf_orig.getvalue()).decode("utf-8")

    # If document detected, generate rectified, Magic Color enhanced thumbnail
    if detected_corners and len(detected_corners) == 8 and confidence >= 0.25:
        try:
            rectified = apply_perspective_quad(img, detected_corners)
            enhanced = apply_scanner_filter(rectified, "magic_color")
            proc_thumb = enhanced.copy()
            proc_thumb.thumbnail((max_dim, max_dim), Image.Resampling.BILINEAR)
            if proc_thumb.mode != "RGB":
                proc_thumb = proc_thumb.convert("RGB")
            buf_proc = io.BytesIO()
            proc_thumb.save(buf_proc, format="JPEG", quality=85)
            b64_thumb = "data:image/jpeg;base64," + base64.b64encode(buf_proc.getvalue()).decode("utf-8")
        except Exception:
            b64_thumb = b64_orig
    else:
        b64_thumb = b64_orig

    return {
        "success": True,
        "width": orig_w,
        "height": orig_h,
        "thumbnail": b64_thumb,
        "original_thumbnail": b64_orig,
        "detected_corners": detected_corners,
        "detection_confidence": round(confidence, 3)
    }

def process_scanner_preview(
    data: bytes,
    rotation: int = 0,
    crop_quad: Optional[List[float]] = None,
    filter_type: str = "original",
    max_dim: int = 500
) -> Dict[str, Any]:
    """
    Renders an efficient real-time preview of a page with rotation, genuine homography crop,
    and actual image processing filter.
    """
    import base64
    img = open_image_from_bytes(data)

    rot = int(rotation) % 360
    if rot == 90:
        img = img.transpose(Image.Transpose.ROTATE_270)
    elif rot == 180:
        img = img.transpose(Image.Transpose.ROTATE_180)
    elif rot == 270:
        img = img.transpose(Image.Transpose.ROTATE_90)

    if crop_quad and len(crop_quad) == 8:
        img = apply_perspective_quad(img, crop_quad)

    if filter_type and filter_type != "original":
        img = apply_scanner_filter(img, filter_type)

    w, h = img.size
    thumb = img.copy()
    thumb.thumbnail((max_dim, max_dim), Image.Resampling.BILINEAR)
    if thumb.mode != "RGB":
        thumb = thumb.convert("RGB")

    buf = io.BytesIO()
    thumb.save(buf, format="JPEG", quality=85)
    b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

    return {
        "success": True,
        "width": w,
        "height": h,
        "thumbnail": b64
    }

def build_scanned_pdf(
    pages_data: List[Dict[str, Any]],
    paper_size: str = "a4",
    orientation: str = "portrait",
    margin_type: str = "normal",
    quality: str = "standard",
    page_fit: str = "fit",
    add_page_numbers: bool = False,
    output_filename: str = "scanned_document.pdf",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Compiles processed document scanner pages into a polished PDF document.
    Applies genuine homography perspective warp, illumination normalization, and proportional layout.
    Does NOT write to conversion history.
    Saves output to temporary output directory or user-chosen output directory.
    """
    if not pages_data:
        return {"success": False, "error": "No pages provided for PDF export"}

    output_dir = get_output_dir(custom_output_dir)
    safe_out_name = sanitize_filename(output_filename, default="scanned_document.pdf")
    if not safe_out_name.lower().endswith(".pdf"):
        safe_out_name += ".pdf"

    out_path = get_unique_output_path(output_dir, safe_out_name)

    # Determine margin in points
    margins = {
        "none": 0.0,
        "narrow": 12.0,
        "normal": 24.0
    }
    margin = margins.get((margin_type or "normal").lower(), 24.0)

    # Determine JPEG compression quality
    jpeg_quality = 95 if (quality or "").lower() == "high" else 85

    doc = fitz.open()

    try:
        total_pages = len(pages_data)

        for idx, page_info in enumerate(pages_data):
            img_bytes = page_info["bytes"]
            rotation = int(page_info.get("rotation", 0)) % 360
            crop_quad = page_info.get("crop_quad")
            filter_type = page_info.get("filter_type", "original")

            # 1. Load image (per-page, isolated to prevent memory buildup)
            img = open_image_from_bytes(img_bytes)

            # 2. Apply rotation if specified
            if rotation == 90:
                img = img.transpose(Image.Transpose.ROTATE_270)
            elif rotation == 180:
                img = img.transpose(Image.Transpose.ROTATE_180)
            elif rotation == 270:
                img = img.transpose(Image.Transpose.ROTATE_90)

            # 3. Apply genuine 4-point perspective homography
            # If crop_quad is not set, auto-detect document boundary to crop desk
            effective_quad = crop_quad
            if not effective_quad or len(effective_quad) != 8:
                try:
                    auto_quad, auto_conf = detect_document_corners(img)
                    if auto_quad and auto_conf >= 0.25:
                        effective_quad = auto_quad
                except Exception:
                    effective_quad = None

            if effective_quad and len(effective_quad) == 8:
                img = apply_perspective_quad(img, list(effective_quad))

            # 4. Apply document enhancement filter
            img = apply_scanner_filter(img, filter_type)

            # 5. Determine PDF page dimensions
            img_w, img_h = img.size
            is_image_landscape = img_w > img_h

            target_paper = (paper_size or "a4").lower()
            if target_paper in PAPER_SIZES:
                base_w, base_h = PAPER_SIZES[target_paper]
            elif target_paper == "fit":
                scale = 72.0 / 150.0
                base_w = max(200.0, img_w * scale)
                base_h = max(200.0, img_h * scale)
            else:
                base_w, base_h = PAPER_SIZES["a4"]

            # Orientation handling
            ori = (orientation or "portrait").lower()
            if ori == "landscape":
                page_w = max(base_w, base_h)
                page_h = min(base_w, base_h)
            elif ori == "portrait":
                page_w = min(base_w, base_h)
                page_h = max(base_w, base_h)
            else:  # 'auto' - adapts to document aspect ratio
                if is_image_landscape:
                    page_w = max(base_w, base_h)
                    page_h = min(base_w, base_h)
                else:
                    page_w = min(base_w, base_h)
                    page_h = max(base_w, base_h)

            # 6. Create PDF page
            page = doc.new_page(width=page_w, height=page_h)

            effective_margin = margin
            bottom_extra = 16.0 if add_page_numbers and effective_margin < 20.0 else 0.0

            printable_w = page_w - (2 * effective_margin)
            printable_h = page_h - (2 * effective_margin) - bottom_extra

            if printable_w <= 10.0 or printable_h <= 10.0:
                printable_w = page_w
                printable_h = page_h
                effective_margin = 0.0
                bottom_extra = 0.0

            # 7. Page fit handling ("fill" vs "fit")
            fit_mode = (page_fit or "fit").lower()
            if fit_mode == "fill" and target_paper != "fit" and printable_w > 0 and printable_h > 0:
                target_ratio = printable_w / printable_h
                img_ratio = img_w / img_h
                if img_ratio > target_ratio:
                    crop_w = max(10, int(round(img_h * target_ratio)))
                    offset_x = max(0, (img_w - crop_w) // 2)
                    img = img.crop((offset_x, 0, offset_x + crop_w, img_h))
                elif img_ratio < target_ratio:
                    crop_h = max(10, int(round(img_w / target_ratio)))
                    offset_y = max(0, (img_h - crop_h) // 2)
                    img = img.crop((0, offset_y, img_w, offset_y + crop_h))

            # 8. Convert image to JPEG buffer for PyMuPDF insertion
            img_buf = io.BytesIO()
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(img_buf, format="JPEG", quality=jpeg_quality, optimize=True)
            encoded_bytes = img_buf.getvalue()

            # 9. Insert image within margins preserving aspect ratio
            img_rect = fitz.Rect(
                effective_margin,
                effective_margin,
                page_w - effective_margin,
                page_h - effective_margin - bottom_extra
            )
            page.insert_image(img_rect, stream=encoded_bytes, keep_proportion=True)

            # 10. Optional page numbers
            if add_page_numbers:
                page_num_str = f"Page {idx + 1} of {total_pages}"
                text_rect = fitz.Rect(0, page_h - 22, page_w, page_h - 4)
                page.insert_textbox(
                    text_rect,
                    page_num_str,
                    fontsize=8.5,
                    fontname="helv",
                    color=(0.35, 0.35, 0.4),
                    align=fitz.TEXT_ALIGN_CENTER
                )

            # Explicit per-page cleanup
            del img
            del encoded_bytes
            img_buf.close()

        # Save finalized PDF with garbage collection and deflation for minimum file size
        doc.save(str(out_path), garbage=4, deflate=True)
        out_size = out_path.stat().st_size
        doc.close()

        return {
            "success": True,
            "output_path": str(out_path),
            "output_filename": safe_out_name,
            "stats": {
                "page_count": total_pages,
                "file_size_bytes": out_size,
                "file_size_formatted": f"{out_size / 1024:.1f} KB" if out_size < 1024 * 1024 else f"{out_size / (1024 * 1024):.2f} MB",
                "paper_size": paper_size.upper(),
                "orientation": orientation.capitalize(),
                "page_fit": page_fit.capitalize()
            }
        }

    except Exception as e:
        if 'doc' in locals() and not doc.is_closed:
            doc.close()
        if out_path.exists():
            try:
                out_path.unlink()
            except Exception:
                pass
        return {
            "success": False,
            "error": f"Failed to generate scanned PDF: {str(e)}"
        }
