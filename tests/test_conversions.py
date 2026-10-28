import io
import os
import zipfile
import pytest
from pathlib import Path
from PIL import Image

import pymupdf as fitz
from docx import Document
import pillow_heif

from backend.services.image_service import process_image
from backend.services.pdf_service import merge_pdfs, split_pdf, extract_pdf_pages, compress_pdf
from backend.services.archive_service import create_zip, extract_zip, is_safe_zip_member
from backend.services.pdf_to_word_service import convert_pdf_to_docx
from backend.services.document_service import convert_document_to_pdf
from backend.services.ocr_service import ocr_image_to_text, ocr_pdf_to_text, ocr_pdf_to_searchable_pdf
from backend.services.system_service import get_system_status, cleanup_temp_files
from backend.services.history_service import add_history_entry, get_history, clear_history
from backend.config import load_settings, save_settings

# --- FIXTURES ---

@pytest.fixture
def sample_png_bytes() -> bytes:
    img = Image.new("RGBA", (400, 300), color=(120, 50, 200, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

@pytest.fixture
def sample_transparent_png_bytes() -> bytes:
    img = Image.new("RGBA", (200, 200), color=(0, 0, 0, 0))
    for x in range(50, 150):
        for y in range(50, 150):
            img.putpixel((x, y), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

@pytest.fixture
def sample_pdf_bytes_factory():
    def _create_pdf(pages: int = 3, text_prefix: str = "Test Page") -> bytes:
        doc = fitz.open()
        for i in range(pages):
            page = doc.new_page(width=595, height=842)
            page.insert_text((72, 100), f"{text_prefix} #{i+1}", fontsize=20)
            page.insert_text((72, 140), "File Convo Local Conversion Engine Test Document.", fontsize=12)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        return buf.getvalue()
    return _create_pdf

# --- IMAGE CONVERSION & HEIC TESTS ---

def test_png_to_jpg(sample_png_bytes, tmp_path):
    res = process_image(
        input_bytes=sample_png_bytes,
        original_filename="test.png",
        target_format="jpg",
        quality=80,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()
    assert out_file.suffix == ".jpg"
    assert res["stats"]["original_dimensions"]["width"] == 400
    assert res["stats"]["original_dimensions"]["height"] == 300

    with Image.open(out_file) as im:
        assert im.format == "JPEG"

def test_heic_to_jpg(tmp_path):
    # Create valid HEIF/HEIC data using pillow_heif
    src_img = Image.new("RGB", (320, 240), color=(100, 150, 220))
    heif_buf = io.BytesIO()
    pillow_heif.from_pillow(src_img).save(heif_buf, format="HEIF")
    heif_bytes = heif_buf.getvalue()

    res = process_image(
        input_bytes=heif_bytes,
        original_filename="iphone_shot.heic",
        target_format="jpg",
        quality=85,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()
    assert out_file.suffix == ".jpg"
    with Image.open(out_file) as im:
        assert im.format == "JPEG"
        assert im.size == (320, 240)

def test_png_to_webp(sample_png_bytes, tmp_path):
    res = process_image(
        input_bytes=sample_png_bytes,
        original_filename="sample.png",
        target_format="webp",
        quality=75,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()
    with Image.open(out_file) as im:
        assert im.format == "WEBP"

def test_image_to_pdf(sample_png_bytes, tmp_path):
    res = process_image(
        input_bytes=sample_png_bytes,
        original_filename="image_doc.png",
        target_format="pdf",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()
    assert out_file.suffix == ".pdf"
    doc = fitz.open(str(out_file))
    assert len(doc) == 1
    doc.close()

def test_image_resizing_pixels(sample_png_bytes, tmp_path):
    res = process_image(
        input_bytes=sample_png_bytes,
        original_filename="resize_test.png",
        target_format="png",
        resize_mode="pixels",
        target_width=200,
        target_height=150,
        maintain_aspect_ratio=True,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    assert res["stats"]["output_dimensions"]["width"] == 200
    assert res["stats"]["output_dimensions"]["height"] == 150

def test_image_resizing_percentage(sample_png_bytes, tmp_path):
    res = process_image(
        input_bytes=sample_png_bytes,
        original_filename="percent_test.png",
        target_format="png",
        resize_mode="percentage",
        resize_percentage=50,
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    assert res["stats"]["output_dimensions"]["width"] == 200
    assert res["stats"]["output_dimensions"]["height"] == 150

def test_transparent_to_jpg_with_bg_color(sample_transparent_png_bytes, tmp_path):
    res = process_image(
        input_bytes=sample_transparent_png_bytes,
        original_filename="trans.png",
        target_format="jpg",
        bg_color_hex="#00ff00",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    with Image.open(out_file) as im:
        assert im.mode == "RGB"

def test_corrupted_image_handling():
    res = process_image(
        input_bytes=b"this is not a valid image file",
        original_filename="fake.heic",
        target_format="jpg"
    )
    assert res["success"] is False
    assert "Failed to open image" in res["error"]

# --- PDF TOOLS TESTS ---

def test_pdf_merge(sample_pdf_bytes_factory, tmp_path):
    pdf1 = sample_pdf_bytes_factory(pages=2, text_prefix="Doc 1")
    pdf2 = sample_pdf_bytes_factory(pages=3, text_prefix="Doc 2")

    res = merge_pdfs(
        file_bytes_list=[pdf1, pdf2],
        filenames=["first.pdf", "second.pdf"],
        output_filename="combined.pdf",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()

    doc = fitz.open(str(out_file))
    assert len(doc) == 5
    doc.close()

def test_pdf_split(sample_pdf_bytes_factory, tmp_path):
    pdf = sample_pdf_bytes_factory(pages=3, text_prefix="SplitPage")
    res = split_pdf(
        file_bytes=pdf,
        original_filename="sample_split.pdf",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    assert len(res["created_files"]) == 3
    out_folder = Path(res["output_folder"])
    assert out_folder.is_dir()
    for fname in res["created_files"]:
        fpath = out_folder / fname
        assert fpath.exists()
        doc = fitz.open(str(fpath))
        assert len(doc) == 1
        doc.close()

def test_pdf_extract_pages(sample_pdf_bytes_factory, tmp_path):
    pdf = sample_pdf_bytes_factory(pages=5, text_prefix="ExtractDoc")
    res = extract_pdf_pages(
        file_bytes=pdf,
        original_filename="large.pdf",
        page_ranges="1, 3-4",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    doc = fitz.open(str(out_file))
    assert len(doc) == 3
    doc.close()

def test_pdf_extract_invalid_ranges(sample_pdf_bytes_factory):
    pdf = sample_pdf_bytes_factory(pages=3)
    res = extract_pdf_pages(
        file_bytes=pdf,
        original_filename="out_of_bounds.pdf",
        page_ranges="1, 99"
    )
    assert res["success"] is False
    assert "out of bounds" in res["error"].lower()

def test_pdf_compress(sample_pdf_bytes_factory, tmp_path):
    pdf = sample_pdf_bytes_factory(pages=4)
    res = compress_pdf(
        file_bytes=pdf,
        original_filename="test_compress.pdf",
        compression_level="medium",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()
    doc = fitz.open(str(out_file))
    assert len(doc) == 4
    doc.close()

# --- ARCHIVE TESTS ---

def test_zip_create_and_extract(tmp_path):
    content1 = b"Hello from File Convo text file 1"
    content2 = b"Hello from File Convo text file 2"

    create_res = create_zip(
        file_bytes_list=[content1, content2],
        filenames=["file1.txt", "file2.txt"],
        zip_name="test_archive.zip",
        custom_output_dir=str(tmp_path)
    )
    assert create_res["success"] is True
    zip_path = Path(create_res["output_path"])
    assert zip_path.exists()

    extract_target = tmp_path / "extracted_dir"
    extract_res = extract_zip(
        zip_bytes=zip_path.read_bytes(),
        original_filename="test_archive.zip",
        custom_output_dir=str(extract_target)
    )
    assert extract_res["success"] is True
    assert extract_res["extracted_count"] == 2

    folder = Path(extract_res["output_folder"])
    assert (folder / "file1.txt").read_bytes() == content1
    assert (folder / "file2.txt").read_bytes() == content2

def test_zip_slip_security_prevention(tmp_path):
    assert is_safe_zip_member(tmp_path, "subfolder/safe.txt") is True
    assert is_safe_zip_member(tmp_path, "../../windows/system32/evil.exe") is False
    assert is_safe_zip_member(tmp_path, "../outside.txt") is False

def test_corrupted_zip_handling():
    res = extract_zip(b"not a real zip", "bad.zip")
    assert res["success"] is False
    assert "not a valid" in res["error"].lower() or "corrupted" in res["error"].lower()

# --- PDF TO WORD TESTS ---

def test_pdf_to_docx(sample_pdf_bytes_factory, tmp_path):
    pdf = sample_pdf_bytes_factory(pages=2, text_prefix="Word Conversion Test")
    res = convert_pdf_to_docx(
        file_bytes=pdf,
        original_filename="sample_to_word.pdf",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_docx = Path(res["output_path"])
    assert out_docx.exists()
    assert out_docx.suffix == ".docx"

    doc = Document(str(out_docx))
    full_text = "\n".join([p.text for p in doc.paragraphs])
    assert "Word Conversion Test" in full_text

# --- DOCUMENT TO PDF & FALLBACK ---

def test_txt_to_pdf_conversion(tmp_path):
    text_content = b"File Convo text document conversion test.\nLine 2 with content."
    res = convert_document_to_pdf(
        file_bytes=text_content,
        original_filename="notes.txt",
        custom_output_dir=str(tmp_path)
    )
    assert res["success"] is True
    out_file = Path(res["output_path"])
    assert out_file.exists()
    doc = fitz.open(str(out_file))
    assert len(doc) == 1
    doc.close()

def test_document_to_pdf_missing_dependency():
    status = get_system_status()
    if not status["libreoffice"]["installed"]:
        res = convert_document_to_pdf(b"dummy docx bytes", "report.docx")
        assert res["success"] is False
        assert "LibreOffice was not found" in res["error"]
        assert res["missing_dependency"] == "LibreOffice"

# --- SYSTEM, OCR & HISTORY TESTS ---

def test_system_status():
    status = get_system_status()
    assert "libreoffice" in status
    assert "tesseract" in status
    assert "settings" in status
    assert "paths" in status
    assert isinstance(status["libreoffice"]["installed"], bool)
    assert isinstance(status["tesseract"]["installed"], bool)

def test_ocr_missing_dependency():
    status = get_system_status()
    if not status["tesseract"]["installed"]:
        res = ocr_image_to_text(b"dummy image", "scan.png")
        assert res["success"] is False
        assert "Tesseract OCR was not found" in res["error"]

def test_history_logging():
    clear_history()
    add_history_entry("test_photo.jpg", "Image → PNG", "success", "/path/to/test.png")
    hist = get_history()
    assert len(hist) >= 1
    assert hist[0]["original_filename"] == "test_photo.jpg"
    assert hist[0]["conversion_type"] == "Image → PNG"

def test_cleanup_temp():
    count = cleanup_temp_files()
    assert isinstance(count, int)
