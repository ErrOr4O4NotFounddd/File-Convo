import os
import sys
import json
import tempfile
from pathlib import Path
from pydantic import BaseModel
from typing import Optional

# Prevent PyMuPDF from slow-loading heavy ONNX neural layout models on startup/tests
sys.modules["pymupdf.layout"] = None

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent

def _get_default_config_dir() -> Path:
    if os.environ.get("FILECONVO_CONFIG_DIR"):
        p = Path(os.environ["FILECONVO_CONFIG_DIR"])
        try:
            p.mkdir(parents=True, exist_ok=True)
            return p
        except Exception:
            pass
    try:
        primary = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".fileconvo"
        primary.mkdir(parents=True, exist_ok=True)
        # Verify writable permissions
        test_probe = primary / ".write_probe"
        test_probe.write_text("ok", encoding="utf-8")
        test_probe.unlink(missing_ok=True)
        return primary
    except Exception:
        fallback = Path(tempfile.gettempdir()) / ".fileconvo"
        try:
            fallback.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return fallback

CONFIG_DIR = _get_default_config_dir()
SETTINGS_FILE = CONFIG_DIR / "settings.json"
HISTORY_FILE = CONFIG_DIR / "history.json"
TEMP_DIR = CONFIG_DIR / "temp"
try:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

TEMP_OUTPUT_DIR = TEMP_DIR / "outputs"
try:
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# Deployment and Server Environment Configuration
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").lower()
PORT = int(os.environ.get("PORT", 8000))
HOST = os.environ.get("HOST", "0.0.0.0" if ENVIRONMENT == "production" else "127.0.0.1")
ALLOWED_ORIGINS_RAW = os.environ.get("ALLOWED_ORIGINS", "")

# Security and Resource Limits
MAX_FILE_SIZE_MB = int(os.environ.get("MAX_FILE_SIZE_MB", "50" if ENVIRONMENT == "production" else "250"))
MAX_CONCURRENT_CONVERSIONS = int(os.environ.get("MAX_CONCURRENT_CONVERSIONS", "2" if ENVIRONMENT == "production" else "5"))
RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "60"))
CONVERSION_TIMEOUT_SECONDS = int(os.environ.get("CONVERSION_TIMEOUT_SECONDS", "120"))

def get_allowed_origins() -> list[str]:
    """Parse ALLOWED_ORIGINS environment variable into clean list."""
    if ALLOWED_ORIGINS_RAW and ALLOWED_ORIGINS_RAW.strip():
        return [o.strip() for o in ALLOWED_ORIGINS_RAW.split(",") if o.strip()]
    if ENVIRONMENT == "production":
        return []
    # Local development default origins
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

# For backwards compatibility with any existing imports, point DEFAULT_OUTPUT_DIR to temporary output directory.
# NEVER automatically create or populate Downloads/FileConvo_Output.
DEFAULT_OUTPUT_DIR = TEMP_OUTPUT_DIR

def get_output_dir(custom_path: Optional[str] = None) -> Path:
    """
    Get the directory to store converted output files.
    - If custom_path is provided by the caller, uses that.
    - If settings.default_output_dir is explicitly configured by the user, uses that.
    - Otherwise, returns the temporary output directory (TEMP_OUTPUT_DIR).
    NEVER silently creates or populates Downloads/FileConvo_Output.
    """
    if custom_path and custom_path.strip():
        p = Path(custom_path.strip())
        p.mkdir(parents=True, exist_ok=True)
        return p
    settings = load_settings()
    if settings.default_output_dir and settings.default_output_dir.strip():
        p = Path(settings.default_output_dir.strip())
        p.mkdir(parents=True, exist_ok=True)
        return p
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return TEMP_OUTPUT_DIR

class AppSettings(BaseModel):
    default_output_dir: str = ""
    default_image_quality: int = 80
    default_image_format: str = "jpg"
    preserve_exif: bool = True
    pdf_compression_level: str = "medium"  # low, medium, high
    max_file_size_mb: int = 250
    libreoffice_path: Optional[str] = None
    tesseract_path: Optional[str] = None
    ocr_language: str = "eng"
    temp_cleanup_policy: str = "auto"  # auto, immediate, never

def load_settings() -> AppSettings:
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return AppSettings(**data)
        except Exception:
            pass
    settings = AppSettings()
    save_settings(settings)
    return settings

def save_settings(settings: AppSettings) -> AppSettings:
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            f.write(settings.model_dump_json(indent=2))
    except Exception:
        pass
    return settings
