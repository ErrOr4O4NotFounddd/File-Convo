import io
import pytest
from starlette.testclient import TestClient
from PIL import Image
import pymupdf as fitz
from backend.main import app

client = TestClient(app)

def test_api_root():
    # Test index serves either frontend or root info with 200
    response = client.get("/")
    assert response.status_code == 200

    # Test dedicated /api/info endpoint returns JSON
    info_res = client.get("/api/info")
    assert info_res.status_code == 200
    assert info_res.json()["app"] == "File Convo"

def test_api_system_status():
    # Initial status call
    response = client.get("/api/system/status")
    assert response.status_code == 200
    data = response.json()
    assert "libreoffice" in data
    assert "tesseract" in data
    assert data["libreoffice"]["installed"] is True
    assert "LibreOffice" in (data["libreoffice"]["version"] or "")

    # Cached call should return immediately
    cached_res = client.get("/api/system/status")
    assert cached_res.status_code == 200
    assert cached_res.json()["libreoffice"]["version"] == data["libreoffice"]["version"]

def test_api_settings():
    response = client.get("/api/system/settings")
    assert response.status_code == 200
    settings = response.json()
    assert "default_output_dir" in settings

def test_api_image_process(tmp_path):
    img = Image.new("RGB", (100, 100), color=(50, 100, 150))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    response = client.post(
        "/api/images/process",
        data={
            "target_format": "jpg",
            "quality": "80",
            "resize_mode": "none",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("test.png", buf.getvalue(), "image/png"))]
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["success"] is True

def test_api_pdf_merge(tmp_path):
    def make_pdf(text):
        doc = fitz.open()
        p = doc.new_page()
        p.insert_text((50, 50), text)
        buf = io.BytesIO()
        doc.save(buf)
        doc.close()
        return buf.getvalue()

    pdf1 = make_pdf("Merge API 1")
    pdf2 = make_pdf("Merge API 2")

    response = client.post(
        "/api/pdf/merge",
        data={
            "output_filename": "api_merged.pdf",
            "custom_output_dir": str(tmp_path)
        },
        files=[
            ("files", ("f1.pdf", pdf1, "application/pdf")),
            ("files", ("f2.pdf", pdf2, "application/pdf"))
        ]
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["stats"]["total_pages"] == 2

def test_api_archives_create_and_extract(tmp_path):
    file1_content = b"Zip API test content"
    res_create = client.post(
        "/api/archives/create-zip",
        data={
            "zip_name": "api_test.zip",
            "custom_output_dir": str(tmp_path)
        },
        files=[("files", ("hello.txt", file1_content, "text/plain"))]
    )
    assert res_create.status_code == 200
    data = res_create.json()
    assert data["success"] is True
    zip_path = data["output_path"]

    with open(zip_path, "rb") as f:
        zip_bytes = f.read()

    res_extract = client.post(
        "/api/archives/extract-zip",
        data={"custom_output_dir": str(tmp_path)},
        files=[("file", ("api_test.zip", zip_bytes, "application/zip"))]
    )
    assert res_extract.status_code == 200
    extract_data = res_extract.json()
    assert extract_data["success"] is True

def test_api_history():
    res = client.get("/api/history")
    assert res.status_code == 200
    assert "history" in res.json()
