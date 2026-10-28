"""
Integration tests for File Convo output and download workflow.

Verifies:
1. HEIC to JPG conversion and download.
2. PNG to JPG and WebP conversion.
3. Image compression and resizing.
4. PDF conversion and PDF tools.
5. ZIP creation and extraction.
6. Correct filename extensions and MIME types.
7. No automatic permanent output-folder creation or saving.
8. Download still works after temporary processing completes.
9. Temporary file lifecycle, cleanup without breaking recent downloads, and security.
"""

import os
import io
import time
import pytest
from pathlib import Path
from PIL import Image
import pillow_heif
import pymupdf
from fastapi import HTTPException

from backend.config import load_settings, save_settings, TEMP_DIR, TEMP_OUTPUT_DIR
from backend.services.image_service import process_image
from backend.services.pdf_service import merge_pdfs, split_pdf
from backend.services.archive_service import create_zip, extract_zip
from backend.services.system_service import cleanup_temp_files
from backend.routers.system import download_file, get_media_type, build_content_disposition


@pytest.fixture(autouse=True)
def ensure_default_settings():
    """Ensure tests run with empty default_output_dir (temporary downloads model)."""
    settings = load_settings()
    settings.default_output_dir = ""
    save_settings(settings)
    yield


def test_1_heic_to_jpg_conversion_and_download():
    """1. HEIC to JPG conversion and download."""
    # Create valid HEIF/HEIC data using pillow_heif
    src_img = Image.new("RGB", (320, 240), color=(100, 150, 220))
    heif_buf = io.BytesIO()
    pillow_heif.from_pillow(src_img).save(heif_buf, format="HEIF")
    heif_bytes = heif_buf.getvalue()

    res = process_image(
        input_bytes=heif_bytes,
        original_filename="camera_capture.heic",
        target_format="jpg",
        quality=85
    )

    assert res["success"] is True
    out_path = Path(res["output_path"])

    # Verify output file exists in TEMP_OUTPUT_DIR (temporary storage)
    assert out_path.exists()
    assert str(TEMP_DIR) in str(out_path)

    # Verify actual encoding is JPEG (not just extension rename)
    with open(out_path, "rb") as f:
        header = f.read(3)
        assert header == b"\xff\xd8\xff", "Magic bytes must be JPEG"

    with Image.open(out_path) as opened:
        assert opened.format == "JPEG"

    # Verify filename ends with .jpg, not .heic.jpg or extensionless
    assert out_path.suffix.lower() == ".jpg"
    assert out_path.stem.startswith("camera_capture")

    # Verify download endpoint response
    response = download_file(str(out_path))
    assert response.status_code == 200
    assert response.media_type == "image/jpeg"
    disp = response.headers.get("content-disposition", "")
    assert f'filename="{out_path.name}"' in disp


def test_2_png_to_jpg_and_webp_conversion_and_download():
    """2. PNG to JPG and WebP conversion."""
    img = Image.new("RGBA", (150, 150), color=(255, 100, 50, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    # Convert PNG -> JPG
    jpg_res = process_image(
        input_bytes=png_bytes,
        original_filename="graphic_logo.png",
        target_format="jpg",
        quality=90,
        bg_color_hex="#FFFFFF"
    )
    assert jpg_res["success"] is True
    jpg_path = Path(jpg_res["output_path"])
    assert jpg_path.suffix == ".jpg"
    with Image.open(jpg_path) as im:
        assert im.format == "JPEG"
    jpg_download = download_file(str(jpg_path))
    assert jpg_download.media_type == "image/jpeg"

    # Convert PNG -> WebP
    webp_res = process_image(
        input_bytes=png_bytes,
        original_filename="graphic_logo.png",
        target_format="webp",
        quality=80
    )
    assert webp_res["success"] is True
    webp_path = Path(webp_res["output_path"])
    assert webp_path.suffix == ".webp"
    with Image.open(webp_path) as im:
        assert im.format == "WEBP"
    webp_download = download_file(str(webp_path))
    assert webp_download.media_type == "image/webp"


def test_3_image_compression_and_resizing():
    """3. Image compression and resizing."""
    img = Image.new("RGB", (800, 600), color="darkgreen")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    # Resize by pixels to 400x300 and convert to WebP
    res = process_image(
        input_bytes=png_bytes,
        original_filename="large_photo.png",
        target_format="webp",
        enable_resize=True,
        resize_mode="pixels",
        target_width=400,
        target_height=300,
        maintain_aspect_ratio=False,
        quality=75
    )
    assert res["success"] is True
    out_path = Path(res["output_path"])
    with Image.open(out_path) as im:
        assert im.format == "WEBP"
        assert im.size == (400, 300)

    # Target-size compression preserving JPG format
    jpg_buf = io.BytesIO()
    Image.new("RGB", (600, 600), color="purple").save(jpg_buf, format="JPEG")
    target_res = process_image(
        input_bytes=jpg_buf.getvalue(),
        original_filename="big_sample.jpg",
        target_format="jpg",
        enable_target_size=True,
        target_size_kb=30
    )
    assert target_res["success"] is True
    compressed_path = Path(target_res["output_path"])
    assert compressed_path.suffix == ".jpg"
    with Image.open(compressed_path) as im:
        assert im.format == "JPEG"


def test_4_pdf_conversion_and_pdf_tools():
    """4. PDF conversion and PDF tools."""
    # Create two minimal 1-page PDFs using PyMuPDF
    doc1 = pymupdf.open()
    page1 = doc1.new_page(width=300, height=300)
    page1.insert_text((50, 50), "Document 1 Content")
    pdf1_bytes = doc1.tobytes()
    doc1.close()

    doc2 = pymupdf.open()
    page2 = doc2.new_page(width=300, height=300)
    page2.insert_text((50, 50), "Document 2 Content")
    pdf2_bytes = doc2.tobytes()
    doc2.close()

    # Merge PDFs
    merge_res = merge_pdfs(
        file_bytes_list=[pdf1_bytes, pdf2_bytes],
        filenames=["doc1.pdf", "doc2.pdf"],
        output_filename="combined_report.pdf"
    )
    assert merge_res["success"] is True
    merged_path = Path(merge_res["output_path"])
    assert merged_path.exists()
    assert merged_path.suffix == ".pdf"
    with open(merged_path, "rb") as f:
        assert f.read(5) == b"%PDF-"

    # Check download endpoint for PDF
    pdf_resp = download_file(str(merged_path))
    assert pdf_resp.status_code == 200
    assert pdf_resp.media_type == "application/pdf"
    assert f'filename="{merged_path.name}"' in pdf_resp.headers.get("content-disposition", "")

    # Split PDF
    with open(merged_path, "rb") as f:
        merged_bytes = f.read()
    split_res = split_pdf(
        file_bytes=merged_bytes,
        original_filename="combined_report.pdf"
    )
    assert split_res["success"] is True
    assert len(split_res["created_files"]) == 2


def test_5_zip_creation_and_extraction():
    """5. ZIP creation and extraction."""
    f1_bytes = b"Hello World from File Convo"
    f2_bytes = b"File Convo ZIP Test Data"

    zip_res = create_zip(
        file_bytes_list=[f1_bytes, f2_bytes],
        filenames=["file1.txt", "file2.txt"],
        zip_name="bundle.zip"
    )
    assert zip_res["success"] is True
    zip_path = Path(zip_res["output_path"])
    assert zip_path.suffix == ".zip"
    with open(zip_path, "rb") as f:
        assert f.read(4) == b"PK\x03\x04"

    # Download endpoint for ZIP
    zip_resp = download_file(str(zip_path))
    assert zip_resp.status_code == 200
    assert zip_resp.media_type == "application/zip"
    assert f'filename="{zip_path.name}"' in zip_resp.headers.get("content-disposition", "")

    # Extract ZIP
    with open(zip_path, "rb") as f:
        archive_bytes = f.read()
    extract_res = extract_zip(
        zip_bytes=archive_bytes,
        original_filename="bundle.zip"
    )
    assert extract_res["success"] is True
    assert extract_res["extracted_count"] == 2


def test_6_correct_filename_extensions_and_mime_types():
    """6. Correct filename extensions and MIME types."""
    assert get_media_type("image.jpg") == "image/jpeg"
    assert get_media_type("photo.jpeg") == "image/jpeg"
    assert get_media_type("icon.png") == "image/png"
    assert get_media_type("art.webp") == "image/webp"
    assert get_media_type("report.pdf") == "application/pdf"
    assert get_media_type("archive.zip") == "application/zip"
    assert get_media_type("document.docx") == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    # RFC 6266 / RFC 5987 Content-Disposition
    cd_ascii = build_content_disposition("test_output.jpg")
    assert cd_ascii == 'attachment; filename="test_output.jpg"'

    cd_unicode = build_content_disposition("ภาพถ่าย_2026.png")
    assert "filename*=UTF-8''" in cd_unicode
    assert ".png" in cd_unicode


def test_7_no_automatic_permanent_output_folder_creation():
    """7. No automatic permanent output-folder creation or saving."""
    settings = load_settings()
    assert settings.default_output_dir == "", "Default output dir must be empty string by default"

    # Converted file must be created inside TEMP_OUTPUT_DIR
    dummy_img = Image.new("RGB", (50, 50), "white")
    buf = io.BytesIO()
    dummy_img.save(buf, format="PNG")

    res = process_image(
        input_bytes=buf.getvalue(),
        original_filename="test_no_permanent.png",
        target_format="jpg"
    )
    out_path = Path(res["output_path"])

    assert out_path.exists()
    assert str(TEMP_OUTPUT_DIR) in str(out_path)

    # Downloads/FileConvo_Output should not exist or be auto-created
    user_downloads_output = Path.home() / "Downloads" / "FileConvo_Output"
    assert not user_downloads_output.exists(), "FileConvo_Output in user Downloads must not be auto-created"


def test_8_download_still_works_after_temporary_processing():
    """8. Download still works after temporary processing completes."""
    test_img = Image.new("RGB", (60, 60), "red")
    buf = io.BytesIO()
    test_img.save(buf, format="PNG")

    res = process_image(
        input_bytes=buf.getvalue(),
        original_filename="download_check.png",
        target_format="webp"
    )
    out_path = Path(res["output_path"])

    # Simulate browser download call
    resp = download_file(path=str(out_path), filename=out_path.name)
    assert resp.status_code == 200
    assert resp.path == str(out_path)
    assert resp.media_type == "image/webp"

    # File must still be present and intact
    assert out_path.exists()
    with open(out_path, "rb") as f:
        bytes_data = f.read()
    assert len(bytes_data) > 0
    assert bytes_data[:4] == b"RIFF"


def test_9_temporary_lifecycle_and_cleanup_and_security(tmp_path):
    """9. Temporary files are cleaned up without breaking downloads, and security checks work."""
    # Create an old temporary file in TEMP_OUTPUT_DIR
    old_file = TEMP_OUTPUT_DIR / "old_stale_file.jpg"
    old_file.write_bytes(b"\xff\xd8\xff old data")
    # Set modified time to 30 hours ago
    past_time = time.time() - (30 * 3600)
    os.utime(str(old_file), (past_time, past_time))

    # Create a fresh temporary file in TEMP_OUTPUT_DIR
    fresh_file = TEMP_OUTPUT_DIR / "fresh_download.jpg"
    fresh_file.write_bytes(b"\xff\xd8\xff fresh data")

    # Run cleanup with max_age_hours=24
    cleaned = cleanup_temp_files(max_age_hours=24)
    assert cleaned >= 1
    assert not old_file.exists(), "Stale file older than 24h must be deleted"
    assert fresh_file.exists(), "Fresh file must be preserved for download"

    # Fresh file can still be downloaded
    resp = download_file(str(fresh_file))
    assert resp.status_code == 200

    # Path traversal security: Attempt to download outside authorized directories raises 403 Forbidden
    unauthorized_file = tmp_path / "sensitive.txt"
    unauthorized_file.write_text("secret password", encoding="utf-8")
    with pytest.raises(HTTPException) as exc_info:
        download_file(str(unauthorized_file))
    assert exc_info.value.status_code == 403

    # Non-existent file raises 404 Not Found
    with pytest.raises(HTTPException) as exc_info_404:
        download_file(str(TEMP_OUTPUT_DIR / "non_existent_file.xyz"))
    assert exc_info_404.value.status_code == 404

    # Clean up fresh_file
    if fresh_file.exists():
        fresh_file.unlink()
