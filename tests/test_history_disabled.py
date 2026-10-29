import pytest
from pathlib import Path
from backend.config import HISTORY_FILE
from backend.services.history_service import (
    get_history,
    add_history_entry,
    clear_history,
    delete_history_entry,
)
from backend.services.archive_service import create_zip
from backend.services.image_service import process_image

def test_history_service_no_persistence():
    # Ensure any legacy history file is removed
    clear_history()
    assert not HISTORY_FILE.exists()

    # Call add_history_entry multiple times
    res1 = add_history_entry(
        original_filename="sample.pdf",
        conversion_type="PDF Compress",
        status="success",
        output_location="/fake/path/sample.pdf",
        details={"size": 1234}
    )
    assert isinstance(res1, dict)
    assert res1.get("original_filename") == "sample.pdf"

    res2 = add_history_entry(
        original_filename="broken.docx",
        conversion_type="Document → PDF",
        status="error",
        error_message="Conversion failed"
    )
    assert isinstance(res2, dict)
    assert res2.get("status") == "error"

    # Verify history is not persisted
    history = get_history()
    assert history == []
    assert not HISTORY_FILE.exists()

    # Verify clear and delete return True safely
    assert clear_history() is True
    assert delete_history_entry("fake-id") is True
    assert not HISTORY_FILE.exists()

def test_legacy_history_file_cleanup(tmp_path):
    # Simulate a pre-existing legacy history file on disk
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text('[{"id": "legacy", "original_filename": "old.png"}]', encoding="utf-8")
    assert HISTORY_FILE.exists()

    # get_history must still return empty list despite legacy file
    assert get_history() == []

    # clear_history must remove the legacy file
    assert clear_history() is True
    assert not HISTORY_FILE.exists()

def test_conversions_do_not_create_history_file(tmp_path):
    clear_history()
    assert not HISTORY_FILE.exists()

    # Create ZIP archive conversion
    file_content = b"Non-persistent history test"
    zip_res = create_zip([file_content], ["note.txt"], "test_hist.zip", custom_output_dir=str(tmp_path))
    assert zip_res["success"] is True

    # Confirm HISTORY_FILE is still not created
    assert not HISTORY_FILE.exists()
    assert get_history() == []
