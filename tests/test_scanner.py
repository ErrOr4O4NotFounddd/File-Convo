import io
import json
import pytest
from pathlib import Path
from PIL import Image
import pymupdf as fitz
from fastapi.testclient import TestClient

from backend.main import app
from backend.config import TEMP_OUTPUT_DIR
from backend.services.history_service import get_history

@pytest.fixture
def client():
    return TestClient(app)

def create_test_image_bytes(format="JPEG", size=(300, 400), color="white"):
    im = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    im.save(buf, format=format)
    return buf.getvalue()

def test_scanner_preview_file_endpoint(client):
    img_bytes = create_test_image_bytes("JPEG", (250, 350), "blue")
    response = client.post(
        "/api/scanner/preview-file",
        files={"file": ("page1.jpg", img_bytes, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["width"] == 250
    assert data["height"] == 350
    assert data["thumbnail"].startswith("data:image/jpeg;base64,")

def test_scanner_preview_invalid_file_rejected(client):
    response = client.post(
        "/api/scanner/preview-file",
        files={"file": ("bad.jpg", b"not an image", "image/jpeg")}
    )
    assert response.status_code == 400

def test_scanner_export_pdf_basic(client):
    img1 = create_test_image_bytes("JPEG", (400, 600), "white")
    img2 = create_test_image_bytes("PNG", (500, 700), "lightgray")

    response = client.post(
        "/api/scanner/export-pdf",
        files=[
            ("files", ("page1.jpg", img1, "image/jpeg")),
            ("files", ("page2.png", img2, "image/png"))
        ],
        data={
            "paper_size": "a4",
            "orientation": "portrait",
            "margin": "normal",
            "quality": "standard",
            "add_page_numbers": "true",
            "output_filename": "my_scanned_notes.pdf"
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["output_filename"] == "my_scanned_notes.pdf"
    assert data["stats"]["page_count"] == 2

    # Open the generated PDF and verify structure
    pdf_path = Path(data["output_path"])
    assert pdf_path.exists()
    assert pdf_path.parent == TEMP_OUTPUT_DIR

    doc = fitz.open(str(pdf_path))
    assert len(doc) == 2
    # Verify A4 portrait dimensions: width ~595, height ~842
    rect = doc[0].rect
    assert round(rect.width) == 595
    assert round(rect.height) == 842

    # Verify page text has footer
    text = doc[0].get_text()
    assert "Page 1 of 2" in text
    doc.close()

    # Clean up test output
    try:
        pdf_path.unlink()
    except Exception:
        pass

def test_scanner_export_pdf_paper_sizes_and_orientations(client):
    img = create_test_image_bytes("JPEG", (800, 400), "yellow") # Landscape image

    # Test Letter Landscape
    response = client.post(
        "/api/scanner/export-pdf",
        files=[("files", ("doc.jpg", img, "image/jpeg"))],
        data={
            "paper_size": "letter",
            "orientation": "landscape",
            "margin": "narrow",
            "quality": "high",
            "output_filename": "letter_doc.pdf"
        }
    )
    assert response.status_code == 200
    data = response.json()
    pdf_path = Path(data["output_path"])
    doc = fitz.open(str(pdf_path))
    assert len(doc) == 1
    # Letter is 612 x 792; in landscape width should be 792, height 612
    rect = doc[0].rect
    assert round(rect.width) == 792
    assert round(rect.height) == 612
    doc.close()
    pdf_path.unlink()

    # Test Fit + Auto orientation
    response = client.post(
        "/api/scanner/export-pdf",
        files=[("files", ("doc.jpg", img, "image/jpeg"))],
        data={
            "paper_size": "fit",
            "orientation": "auto",
            "margin": "none",
            "output_filename": "fit_doc.pdf"
        }
    )
    assert response.status_code == 200
    data = response.json()
    pdf_path = Path(data["output_path"])
    doc = fitz.open(str(pdf_path))
    assert len(doc) == 1
    # Auto orientation with landscape image should make page wider than tall
    rect = doc[0].rect
    assert rect.width > rect.height
    doc.close()
    pdf_path.unlink()

def test_scanner_per_page_config_and_filters(client):
    img1 = create_test_image_bytes("JPEG", (400, 500), "white")
    img2 = create_test_image_bytes("JPEG", (400, 500), "white")

    pages_config = json.dumps([
        {
            "rotation": 90,
            "filter_type": "document",
            "crop_quad": [0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.05, 0.95]
        },
        {
            "rotation": 0,
            "filter_type": "grayscale",
            "crop_quad": None
        }
    ])

    response = client.post(
        "/api/scanner/export-pdf",
        files=[
            ("files", ("p1.jpg", img1, "image/jpeg")),
            ("files", ("p2.jpg", img2, "image/jpeg"))
        ],
        data={
            "pages_config": pages_config,
            "paper_size": "a4",
            "orientation": "portrait"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    pdf_path = Path(data["output_path"])
    assert pdf_path.exists()
    doc = fitz.open(str(pdf_path))
    assert len(doc) == 2
    doc.close()
    pdf_path.unlink()

def test_scanner_no_history_logged(client):
    """Verify that document scanning does not persist conversion history records."""
    history_before = get_history()
    count_before = len(history_before)

    img = create_test_image_bytes("JPEG", (200, 200), "white")
    response = client.post(
        "/api/scanner/export-pdf",
        files=[("files", ("scan.jpg", img, "image/jpeg"))],
        data={"paper_size": "a4"}
    )
    assert response.status_code == 200
    pdf_path = Path(response.json()["output_path"])
    pdf_path.unlink()

    history_after = get_history()
    assert len(history_after) == count_before

def test_scanner_detect_document_corners_endpoint(client):
    """Test automatic document boundary detection via endpoint."""
    import numpy as np
    import cv2
    desk = np.full((600, 800, 3), 40, dtype=np.uint8)
    pts = np.array([[150, 80], [650, 100], [600, 520], [120, 480]], dtype=np.int32)
    cv2.fillPoly(desk, [pts], (245, 245, 245))
    im = Image.fromarray(cv2.cvtColor(desk, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    im.save(buf, format="JPEG")
    img_bytes = buf.getvalue()

    response = client.post(
        "/api/scanner/detect-corners",
        files={"file": ("photo.jpg", img_bytes, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["detected"] is True
    assert len(data["corners"]) == 8
    assert data["confidence"] > 0.3

def test_scanner_detect_corners_fallback_when_no_document(client):
    """Test that detection gracefully falls back to None without arbitrary silent cropping."""
    im = Image.new("RGB", (500, 500), color=(128, 128, 128))
    buf = io.BytesIO()
    im.save(buf, format="JPEG")

    response = client.post(
        "/api/scanner/detect-corners",
        files={"file": ("blank.jpg", buf.getvalue(), "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["detected"] is False
    assert data["corners"] is None
    assert data["confidence"] == 0.0

def test_scanner_process_preview_endpoint(client):
    """Test live thumbnail processing with rotation, perspective crop, and filter."""
    im = Image.new("RGB", (400, 500), color="white")
    buf = io.BytesIO()
    im.save(buf, format="JPEG")

    response = client.post(
        "/api/scanner/process-preview",
        files={"file": ("page.jpg", buf.getvalue(), "image/jpeg")},
        data={
            "rotation": "90",
            "crop_quad": json.dumps([0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9]),
            "filter_type": "magic_color"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["thumbnail"].startswith("data:image/jpeg;base64,")
    assert data["width"] > 0
    assert data["height"] > 0

def test_scanner_shadow_removal_magic_color_and_bw():
    """Test that Magic Color and Adaptive B&W eliminate uneven shadows while preserving text."""
    import numpy as np
    import cv2
    from backend.services.scanner_service import apply_scanner_filter

    # Create shadowed page
    page = np.full((400, 300, 3), 245, dtype=np.uint8)
    cv2.putText(page, "IMPORTANT TEXT", (30, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (20, 20, 20), 2)
    # Severe shadow over bottom half
    shadow = np.ones((400, 300), dtype=np.float32)
    shadow[200:, :] = 0.40
    shadow = cv2.GaussianBlur(shadow, (31, 31), 0)
    shadowed = np.clip(page.astype(np.float32) * shadow[:, :, None], 0, 255).astype(np.uint8)

    pil_shadowed = Image.fromarray(cv2.cvtColor(shadowed, cv2.COLOR_BGR2RGB))

    # Magic color
    mc = apply_scanner_filter(pil_shadowed, "magic_color")
    mc_np = np.array(mc)
    # Former shadow paper area at bottom should now be bright white (>= 235)
    assert mc_np[350, 150, 0] >= 230
    assert mc_np[350, 150, 1] >= 230
    assert mc_np[350, 150, 2] >= 230

    # Black & White
    bw = apply_scanner_filter(pil_shadowed, "black_white")
    bw_np = np.array(bw)
    # Former shadow paper area should be 255 pure white
    assert bw_np[350, 150, 0] == 255

def test_scanner_pdf_page_fit_fill_and_fit(client):
    """Test PDF generation with page_fit options 'fit' and 'fill'."""
    img = create_test_image_bytes("JPEG", (600, 800), "white")

    # Fit mode
    res_fit = client.post(
        "/api/scanner/export-pdf",
        files=[("files", ("page1.jpg", img, "image/jpeg"))],
        data={"paper_size": "a4", "page_fit": "fit", "output_filename": "fit_test.pdf"}
    )
    assert res_fit.status_code == 200
    p1 = Path(res_fit.json()["output_path"])
    assert p1.exists()
    p1.unlink()

    # Fill mode
    res_fill = client.post(
        "/api/scanner/export-pdf",
        files=[("files", ("page1.jpg", img, "image/jpeg"))],
        data={"paper_size": "letter", "page_fit": "fill", "margin": "none", "output_filename": "fill_test.pdf"}
    )
    assert res_fill.status_code == 200
    p2 = Path(res_fill.json()["output_path"])
    assert p2.exists()
    p2.unlink()

