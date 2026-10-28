import os
import sys
import tempfile
from pathlib import Path

# Prevent PyMuPDF from slow-loading heavy ONNX neural layout models on startup/tests
sys.modules["pymupdf.layout"] = None

# Setup isolated writable test directories before backend imports
_test_root = Path(tempfile.gettempdir()) / "fileconvo_pytest_suite"
_test_root.mkdir(parents=True, exist_ok=True)
_test_config = _test_root / "config"
_test_config.mkdir(parents=True, exist_ok=True)
_test_output = _test_root / "output"
_test_output.mkdir(parents=True, exist_ok=True)

os.environ["FILECONVO_CONFIG_DIR"] = str(_test_config)
os.environ["FILECONVO_OUTPUT_DIR"] = str(_test_output)
