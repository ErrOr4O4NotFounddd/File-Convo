import io
from pathlib import Path
from PIL import Image
import pytest

from backend.services.image_service import (
    process_image,
    compress_to_target_size,
    resolve_output_format
)
from backend.config import TEMP_OUTPUT_DIR
from backend.routers.system import download_file, MIME_TYPE_MAP, build_content_disposition

# Magic byte signatures
JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
WEBP_RIFF = b"RIFF"
WEBP_MARKER = b"WEBP"

def verify_jpeg_bytes(data: bytes):
    assert data[:3] == JPEG_MAGIC, f"Data does not start with JPEG magic bytes: {data[:10]!r}"
    with Image.open(io.BytesIO(data)) as im:
        assert im.format == "JPEG", f"Pillow detected format {im.format} instead of JPEG"

def verify_png_bytes(data: bytes):
    assert data[:8] == PNG_MAGIC, f"Data does not start with PNG magic bytes: {data[:10]!r}"
    with Image.open(io.BytesIO(data)) as im:
        assert im.format == "PNG", f"Pillow detected format {im.format} instead of PNG"

def verify_webp_bytes(data: bytes):
    assert data[:4] == WEBP_RIFF, f"Data does not start with RIFF: {data[:10]!r}"
    assert data[8:12] == WEBP_MARKER, f"Data does not have WEBP marker at offset 8: {data[:14]!r}"
    with Image.open(io.BytesIO(data)) as im:
        assert im.format == "WEBP", f"Pillow detected format {im.format} instead of WEBP"

# --- 1. ACTUAL FILE ENCODING & MAGIC SIGNATURE TESTS ---

def test_genuine_jpeg_encoding(tmp_path):
    """Verify JPEG output uses Pillow's JPEG encoder, valid magic bytes, and .jpg extension."""
    src = Image.new("RGBA", (200, 150), color=(100, 150, 200, 255))
    buf = io.BytesIO()
    src.save(buf, format="PNG")

    res = process_image(
        input_bytes=buf.getvalue(),
        original_filename="test_source.png",
        target_format="jpg",
        quality=85,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_path = Path(res["output_path"])
    assert out_path.exists()
    assert out_path.suffix == ".jpg"
    assert res["output_filename"].endswith(".jpg")

    data = out_path.read_bytes()
    verify_jpeg_bytes(data)

    with Image.open(out_path) as im:
        assert im.format == "JPEG"
        assert im.size == (200, 150)
        assert im.mode in ("RGB", "L")

def test_genuine_png_encoding(tmp_path):
    """Verify PNG output uses Pillow's PNG encoder, valid magic bytes, and .png extension."""
    src = Image.new("RGB", (180, 120), color=(50, 80, 120))
    buf = io.BytesIO()
    src.save(buf, format="JPEG")

    res = process_image(
        input_bytes=buf.getvalue(),
        original_filename="sample.jpeg",
        target_format="png",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_path = Path(res["output_path"])
    assert out_path.exists()
    assert out_path.suffix == ".png"
    assert res["output_filename"].endswith(".png")

    data = out_path.read_bytes()
    verify_png_bytes(data)

    with Image.open(out_path) as im:
        assert im.format == "PNG"
        assert im.size == (180, 120)

def test_genuine_webp_encoding(tmp_path):
    """Verify WebP output uses Pillow's WebP encoder, valid magic bytes, and .webp extension."""
    src = Image.new("RGBA", (150, 150), color=(255, 0, 0, 128))
    buf = io.BytesIO()
    src.save(buf, format="PNG")

    res = process_image(
        input_bytes=buf.getvalue(),
        original_filename="transparent_circle.png",
        target_format="webp",
        quality=80,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_path = Path(res["output_path"])
    assert out_path.exists()
    assert out_path.suffix == ".webp"
    assert res["output_filename"].endswith(".webp")

    data = out_path.read_bytes()
    verify_webp_bytes(data)

    with Image.open(out_path) as im:
        assert im.format == "WEBP"
        assert im.size == (150, 150)

# --- 2. FILENAME EXTENSION & NORMALIZATION TESTS ---

def test_jpeg_extension_normalization(tmp_path):
    """Ensure .jpeg and .jpg are consistently normalized to .jpg."""
    src = Image.new("RGB", (100, 100), color=(20, 40, 60))
    buf = io.BytesIO()
    src.save(buf, format="JPEG")

    # Uploaded as .jpeg, requesting jpeg
    res1 = process_image(
        input_bytes=buf.getvalue(),
        original_filename="photo.jpeg",
        target_format="jpeg",
        custom_output_dir=str(tmp_path)
    )
    assert res1["output_filename"].endswith(".jpg")
    assert not res1["output_filename"].endswith(".jpeg")

    # Uploaded as .jpg, requesting jpg
    res2 = process_image(
        input_bytes=buf.getvalue(),
        original_filename="photo.jpg",
        target_format="jpg",
        custom_output_dir=str(tmp_path)
    )
    assert res2["output_filename"].endswith(".jpg")

def test_no_extensionless_or_retained_source_extension(tmp_path):
    """Ensure output never retains source extension or produces extensionless files."""
    src = Image.new("RGB", (100, 100), color=(200, 100, 50))
    buf = io.BytesIO()
    src.save(buf, format="PNG")

    # Extensionless source name
    res1 = process_image(
        input_bytes=buf.getvalue(),
        original_filename="nameless_file",
        target_format="webp",
        custom_output_dir=str(tmp_path)
    )
    assert res1["output_filename"].endswith(".webp")
    assert "." in res1["output_filename"]

    # Converting PNG to JPG must NOT keep .png anywhere in the extension
    res2 = process_image(
        input_bytes=buf.getvalue(),
        original_filename="graph.png",
        target_format="jpg",
        custom_output_dir=str(tmp_path)
    )
    assert res2["output_filename"] == "graph_optimized.jpg"
    assert not res2["output_filename"].endswith(".png")
    assert not res2["output_filename"].endswith(".png.jpg")

# --- 3. TARGET-SIZE COMPRESSION & RESIZING BEFORE ENCODING ---

def test_target_size_preserves_selected_format(tmp_path):
    """Ensure target-size compression preserves the selected format."""
    src = Image.new("RGB", (300, 300), color=(120, 140, 160))
    buf = io.BytesIO()
    src.save(buf, format="PNG")

    # Target size compression requesting PNG must stay PNG
    res_png = compress_to_target_size(
        input_bytes=buf.getvalue(),
        original_filename="chart.png",
        target_size_bytes=50 * 1024,
        output_format="png",
        allow_png_fallback=False,
        custom_output_dir=str(tmp_path)
    )
    assert res_png["success"] is True
    out_file = Path(res_png["output_path"])
    assert out_file.suffix == ".png"
    verify_png_bytes(out_file.read_bytes())

    # Target size compression requesting WebP must stay WebP
    res_webp = compress_to_target_size(
        input_bytes=buf.getvalue(),
        original_filename="chart.png",
        target_size_bytes=20 * 1024,
        output_format="webp",
        custom_output_dir=str(tmp_path)
    )
    assert res_webp["success"] is True
    out_file_webp = Path(res_webp["output_path"])
    assert out_file_webp.suffix == ".webp"
    verify_webp_bytes(out_file_webp.read_bytes())

def test_resizing_applied_before_encoding(tmp_path):
    """Ensure dimensions are resized before final encoding."""
    src = Image.new("RGB", (800, 600), color=(50, 100, 150))
    buf = io.BytesIO()
    src.save(buf, format="JPEG")

    res = process_image(
        input_bytes=buf.getvalue(),
        original_filename="large.jpg",
        target_format="jpg",
        enable_resize=True,
        resize_mode="pixels",
        target_width=400,
        target_height=300,
        maintain_aspect_ratio=True,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_path = Path(res["output_path"])
    with Image.open(out_path) as im:
        assert im.size == (400, 300)
        assert im.format == "JPEG"

# --- 4. HTTP DOWNLOAD ENDPOINT: HEADERS & FILENAME HANDLING ---

def test_download_headers_jpeg():
    """Test Content-Type and Content-Disposition headers for JPEG."""
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    f = TEMP_OUTPUT_DIR / "test_photo_verif.jpg"
    src = Image.new("RGB", (100, 100), color=(255, 0, 0))
    src.save(f, format="JPEG")
    try:
        response = download_file(path=str(f), filename="custom_name.jpg")
        headers = dict(response.headers)
        assert headers["content-type"] == "image/jpeg"
        assert 'filename="custom_name.jpg"' in headers["content-disposition"]
        assert response.path == str(f)
    finally:
        f.unlink(missing_ok=True)

def test_download_headers_png():
    """Test Content-Type and Content-Disposition headers for PNG."""
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    f = TEMP_OUTPUT_DIR / "test_icon_verif.png"
    src = Image.new("RGBA", (50, 50), color=(0, 255, 0, 128))
    src.save(f, format="PNG")
    try:
        response = download_file(path=str(f), filename="icon.png")
        headers = dict(response.headers)
        assert headers["content-type"] == "image/png"
        assert 'filename="icon.png"' in headers["content-disposition"]
    finally:
        f.unlink(missing_ok=True)

def test_download_headers_webp():
    """Test Content-Type and Content-Disposition headers for WebP."""
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    f = TEMP_OUTPUT_DIR / "graphic_verif.webp"
    src = Image.new("RGBA", (60, 60), color=(0, 0, 255, 200))
    src.save(f, format="WEBP")
    try:
        response = download_file(path=str(f), filename="graphic.webp")
        headers = dict(response.headers)
        assert headers["content-type"] == "image/webp"
        assert 'filename="graphic.webp"' in headers["content-disposition"]
    finally:
        f.unlink(missing_ok=True)

def test_download_endpoint_corrects_mismatched_extension():
    """If caller requests .png or extensionless for a .jpg disk file, endpoint enforces .jpg."""
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    f = TEMP_OUTPUT_DIR / "output_photo_verif.jpg"
    src = Image.new("RGB", (100, 100), color=(20, 20, 20))
    src.save(f, format="JPEG")
    try:
        # 1. Filename passed without extension
        res1 = download_file(path=str(f), filename="output_photo")
        h1 = dict(res1.headers)
        assert h1["content-type"] == "image/jpeg"
        assert 'filename="output_photo.jpg"' in h1["content-disposition"]

        # 2. Filename passed with .jpeg instead of .jpg
        res2 = download_file(path=str(f), filename="output_photo.jpeg")
        h2 = dict(res2.headers)
        assert h2["content-type"] == "image/jpeg"
        assert 'filename="output_photo.jpg"' in h2["content-disposition"]

        # 3. Filename passed with wrong extension (.png for a .jpg file)
        res3 = download_file(path=str(f), filename="output_photo.png")
        h3 = dict(res3.headers)
        assert h3["content-type"] == "image/jpeg"
        assert 'filename="output_photo.jpg"' in h3["content-disposition"]
    finally:
        f.unlink(missing_ok=True)

def test_download_endpoint_unicode_filename_rfc6266():
    """Ensure non-ASCII filenames generate valid RFC 6266 headers with ASCII fallback."""
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    f = TEMP_OUTPUT_DIR / "sample_verif.jpg"
    src = Image.new("RGB", (100, 100), color=(10, 20, 30))
    src.save(f, format="JPEG")
    try:
        res = download_file(path=str(f), filename="ภาพถ่าย_ทิวทัศน์.jpg")
        h = dict(res.headers)
        cd = h["content-disposition"]
        assert "filename=" in cd
        assert "filename*=UTF-8''" in cd
        assert cd.endswith(".jpg") or "%2Ejpg" in cd or ".jpg" in cd
        assert h["content-type"] == "image/jpeg"
    finally:
        f.unlink(missing_ok=True)
