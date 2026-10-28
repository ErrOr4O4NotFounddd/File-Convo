import io
import json
import pytest
from pathlib import Path
import pymupdf as fitz
from fastapi import HTTPException

from backend.config import TEMP_DIR, TEMP_OUTPUT_DIR
from backend.services.pdf_service import (
    load_pdf_for_organizer,
    get_organizer_thumbnails,
    export_organized_pdf,
    ORGANIZER_TEMP_DIR
)
from backend.routers.pdf_tools import (
    api_organizer_upload,
    api_organizer_thumbnails,
    api_organizer_export
)
from backend.routers.system import download_file
from starlette.datastructures import UploadFile


def create_sample_pdf(pages_spec):
    """
    Creates an in-memory PDF with specified pages.
    pages_spec: list of dicts: {'text': str, 'width': float, 'height': float, 'rotation': int}
    """
    doc = fitz.open()
    for spec in pages_spec:
        w = spec.get('width', 595.0)
        h = spec.get('height', 842.0)
        p = doc.new_page(width=w, height=h)
        rot = spec.get('rotation', 0)
        if rot:
            p.set_rotation(rot)
        p.insert_text((72, 72), spec.get('text', 'Sample text'), fontsize=14)
    buf = io.BytesIO()
    doc.save(buf)
    doc.close()
    return buf.getvalue()


@pytest.fixture
def multi_page_pdf():
    return create_sample_pdf([
        {"text": "Page 1 Alpha", "width": 595.0, "height": 842.0, "rotation": 0},
        {"text": "Page 2 Beta", "width": 600.0, "height": 600.0, "rotation": 0},
        {"text": "Page 3 Gamma", "width": 842.0, "height": 595.0, "rotation": 90},
        {"text": "Page 4 Delta", "width": 595.0, "height": 842.0, "rotation": 0},
    ])


@pytest.fixture
def second_pdf():
    return create_sample_pdf([
        {"text": "Doc 2 Page 1 Epsilon", "width": 500.0, "height": 700.0, "rotation": 0},
        {"text": "Doc 2 Page 2 Zeta", "width": 500.0, "height": 700.0, "rotation": 0},
    ])


@pytest.fixture
def third_pdf():
    return create_sample_pdf([
        {"text": "Doc 3 Page 1 Eta", "width": 612.0, "height": 792.0, "rotation": 0},
    ])


def test_load_pdf_and_thumbnails(multi_page_pdf):
    """Test loading a multi-page PDF generates file_id and base64 thumbnails."""
    res = load_pdf_for_organizer(multi_page_pdf, "sample.pdf")
    assert res["success"] is True
    assert "file_id" in res
    assert res["total_pages"] == 4
    assert len(res["pages"]) == 4

    p0 = res["pages"][0]
    assert p0["page_index"] == 0
    assert p0["page_number"] == 1
    assert p0["width"] == 595.0
    assert p0["height"] == 842.0
    assert p0["rotation"] == 0
    assert p0["thumbnail"].startswith("data:image/jpeg;base64,")

    p2 = res["pages"][2]
    assert p2["page_index"] == 2
    assert p2["rotation"] == 90


def test_get_additional_thumbnails(multi_page_pdf):
    """Test fetching thumbnail slice with get_organizer_thumbnails."""
    res = load_pdf_for_organizer(multi_page_pdf, "sample.pdf")
    file_id = res["file_id"]

    thumb_res = get_organizer_thumbnails(file_id, start_page=1, count=2)
    assert thumb_res["success"] is True
    assert len(thumb_res["pages"]) == 2
    assert thumb_res["pages"][0]["page_index"] == 1
    assert thumb_res["pages"][1]["page_index"] == 2


def test_reorder_pages(multi_page_pdf):
    """Test reordering pages and verifying content, dimensions, and rotation."""
    load_res = load_pdf_for_organizer(multi_page_pdf, "original.pdf")
    fid = load_res["file_id"]

    # Reorder pages to: [3, 1, 0, 2] (Delta, Beta, Alpha, Gamma)
    reordered_spec = [
        {"file_id": fid, "page_index": 3},
        {"file_id": fid, "page_index": 1},
        {"file_id": fid, "page_index": 0},
        {"file_id": fid, "page_index": 2},
    ]

    export_res = export_organized_pdf(reordered_spec, "reordered.pdf")
    assert export_res["success"] is True
    out_path = Path(export_res["output_path"])
    assert out_path.exists()
    assert out_path.suffix.lower() == ".pdf"

    # Open and verify content of the exported PDF
    doc = fitz.open(str(out_path))
    assert len(doc) == 4

    assert "Page 4 Delta" in doc[0].get_text()
    assert "Page 2 Beta" in doc[1].get_text()
    assert "Page 1 Alpha" in doc[2].get_text()
    assert "Page 3 Gamma" in doc[3].get_text()

    # Check preserved rotation on Gamma
    assert doc[3].rotation == 90
    doc.close()


def test_delete_single_and_multiple_pages(multi_page_pdf):
    """Test deleting one and multiple pages from a document."""
    load_res = load_pdf_for_organizer(multi_page_pdf, "doc.pdf")
    fid = load_res["file_id"]

    # Delete Page 1 (index 1) -> keep [0, 2, 3]
    del_single = [
        {"file_id": fid, "page_index": 0},
        {"file_id": fid, "page_index": 2},
        {"file_id": fid, "page_index": 3},
    ]
    res1 = export_organized_pdf(del_single, "deleted_single.pdf")
    assert res1["success"] is True
    doc1 = fitz.open(res1["output_path"])
    assert len(doc1) == 3
    texts1 = [doc1[i].get_text() for i in range(3)]
    assert not any("Page 2 Beta" in t for t in texts1)
    doc1.close()

    # Delete multiple pages -> keep only [1] (Page 2 Beta)
    del_multi = [{"file_id": fid, "page_index": 1}]
    res2 = export_organized_pdf(del_multi, "deleted_multi.pdf")
    assert res2["success"] is True
    doc2 = fitz.open(res2["output_path"])
    assert len(doc2) == 1
    assert "Page 2 Beta" in doc2[0].get_text()
    doc2.close()


def test_add_selected_pages_from_another_pdf(multi_page_pdf, second_pdf):
    """Test adding selected pages from a second PDF into chosen positions."""
    load1 = load_pdf_for_organizer(multi_page_pdf, "main.pdf")
    load2 = load_pdf_for_organizer(second_pdf, "second.pdf")

    fid1 = load1["file_id"]
    fid2 = load2["file_id"]

    # Main page 0, then Doc 2 page 1 (Zeta), then Main page 1
    arranged = [
        {"file_id": fid1, "page_index": 0},
        {"file_id": fid2, "page_index": 1},
        {"file_id": fid1, "page_index": 1},
    ]

    export_res = export_organized_pdf(arranged, "merged_selection.pdf")
    assert export_res["success"] is True

    doc = fitz.open(export_res["output_path"])
    assert len(doc) == 3
    assert "Page 1 Alpha" in doc[0].get_text()
    assert "Doc 2 Page 2 Zeta" in doc[1].get_text()
    assert "Page 2 Beta" in doc[2].get_text()

    # Verify preserved dimensions from second PDF (500x700)
    assert doc[1].rect.width == 500.0
    assert doc[1].rect.height == 700.0
    doc.close()


def test_add_pages_from_multiple_pdfs(multi_page_pdf, second_pdf, third_pdf):
    """Test combining pages from 3 different PDFs."""
    l1 = load_pdf_for_organizer(multi_page_pdf, "doc1.pdf")
    l2 = load_pdf_for_organizer(second_pdf, "doc2.pdf")
    l3 = load_pdf_for_organizer(third_pdf, "doc3.pdf")

    arranged = [
        {"file_id": l1["file_id"], "page_index": 0},
        {"file_id": l2["file_id"], "page_index": 0},
        {"file_id": l3["file_id"], "page_index": 0},
    ]

    res = export_organized_pdf(arranged, "tri_merge.pdf")
    assert res["success"] is True
    assert res["stats"]["source_files_count"] == 3
    assert res["stats"]["total_pages"] == 3

    doc = fitz.open(res["output_path"])
    assert len(doc) == 3
    assert "Page 1 Alpha" in doc[0].get_text()
    assert "Doc 2 Page 1 Epsilon" in doc[1].get_text()
    assert "Doc 3 Page 1 Eta" in doc[2].get_text()
    doc.close()


def test_empty_pages_rejected():
    """Attempting to export an empty list of pages must be rejected."""
    res = export_organized_pdf([], "empty.pdf")
    assert res["success"] is False
    assert "empty" in res["error"].lower()


def test_corrupted_pdf_handling():
    """Corrupted / non-PDF data must be rejected gracefully."""
    corrupted_data = b"This is definitely not a PDF file header."
    res = load_pdf_for_organizer(corrupted_data, "bad.pdf")
    assert res["success"] is False
    assert "invalid" in res["error"].lower() or "corrupted" in res["error"].lower()


def test_encrypted_pdf_handling():
    """Password-protected PDFs must be rejected with a clear message."""
    doc = fitz.open()
    doc.new_page().insert_text((50, 50), "Secret")
    # Encrypt document
    enc_buf = io.BytesIO()
    doc.save(enc_buf, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="1234")
    doc.close()
    enc_bytes = enc_buf.getvalue()

    res = load_pdf_for_organizer(enc_bytes, "secret.pdf")
    assert res["success"] is False
    assert "password" in res["error"].lower()


class MockUploadFile:
    def __init__(self, filename: str, data: bytes):
        self.filename = filename
        self.file = io.BytesIO(data)


def test_router_endpoints(multi_page_pdf):
    """Test FastAPI router endpoints for upload, thumbnails, and export."""
    # 1. Upload endpoint
    uf = MockUploadFile(filename="test.pdf", data=multi_page_pdf)
    upload_res = api_organizer_upload(file=uf)
    assert upload_res["success"] is True
    fid = upload_res["file_id"]
    assert upload_res["total_pages"] == 4

    # 2. Thumbnails endpoint
    thumb_res = api_organizer_thumbnails(file_id=fid, start_page=0, count=2)
    assert thumb_res["success"] is True
    assert len(thumb_res["pages"]) == 2

    # 3. Export endpoint
    pages_json = json.dumps([
        {"file_id": fid, "page_index": 1},
        {"file_id": fid, "page_index": 0}
    ])
    exp_res = api_organizer_export(pages=pages_json, output_filename="router_exp.pdf")
    assert exp_res["success"] is True
    assert exp_res["stats"]["total_pages"] == 2

    # 4. Download endpoint verification
    dl_response = download_file(path=exp_res["output_path"], filename="router_exp.pdf")
    assert dl_response.status_code == 200
    assert dl_response.media_type == "application/pdf"
    assert 'filename="router_exp.pdf"' in dl_response.headers.get("content-disposition", "")
