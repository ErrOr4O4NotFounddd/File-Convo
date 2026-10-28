import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, List, Optional
from backend.config import load_settings, AppSettings, TEMP_DIR, DEFAULT_OUTPUT_DIR, ENVIRONMENT

import time

# In-memory cache for system status
_status_cache: Optional[Dict[str, Any]] = None
_status_cache_time: float = 0.0
_status_cache_key: Optional[tuple] = None
CACHE_TTL: float = 300.0  # 5 minutes

def invalidate_system_status_cache() -> None:
    """Invalidates the cached system status so the next request re-evaluates dependencies."""
    global _status_cache, _status_cache_time, _status_cache_key
    _status_cache = None
    _status_cache_time = 0.0
    _status_cache_key = None

def get_pe_file_version(filepath: str) -> Optional[str]:
    """
    Extracts the FileVersion string directly from a Windows PE binary header
    using version.dll without executing any process or creating a window.
    """
    if sys.platform != "win32" or not filepath or not os.path.isfile(filepath):
        return None
    try:
        import ctypes
        size = ctypes.windll.version.GetFileVersionInfoSizeW(str(filepath), None)
        if not size:
            return None
        res = ctypes.create_string_buffer(size)
        if not ctypes.windll.version.GetFileVersionInfoW(str(filepath), 0, size, res):
            return None
        ptr = ctypes.c_void_p()
        u_len = ctypes.c_uint()
        if ctypes.windll.version.VerQueryValueW(res, r"\\", ctypes.byref(ptr), ctypes.byref(u_len)):
            import struct
            data = ctypes.string_at(ptr, u_len.value)
            fixed_info = struct.unpack("13I", data[:52])
            ms = fixed_info[2]
            ls = fixed_info[3]
            return f"{ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}"
    except Exception:
        pass
    return None

def find_libreoffice_binary(custom_path: Optional[str] = None) -> Optional[str]:
    if custom_path and os.path.isfile(custom_path):
        return custom_path

    # Check PATH
    which_path = shutil.which("soffice") or shutil.which("soffice.exe") or shutil.which("soffice.com")
    if which_path:
        return which_path

    # Check common Windows paths
    candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\LibreOffice\program\soffice.exe"),
    ]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate

    return None

def get_libreoffice_version(lo_exe: Optional[str]) -> Optional[str]:
    """
    Detect LibreOffice version cleanly, silently, and non-interactively.
    
    IMPORTANT: On Windows, soffice.exe is a GUI binary that calls AllocConsole() 
    when invoked with --version, popping up a terminal window and halting on 
    'Press Enter to continue...'. We avoid this by:
    1. Using soffice.com (LibreOffice's console wrapper) if available on Windows.
    2. Falling back to reading the PE version resource from soffice.exe directly (0 subprocesses).
    3. Never executing soffice.exe with --version on Windows.
    """
    if not lo_exe or not os.path.isfile(lo_exe):
        return None

    if sys.platform == "win32":
        # 1. Look for soffice.com in the same directory (standard console wrapper)
        com_candidate = Path(lo_exe).with_name("soffice.com")
        if com_candidate.is_file():
            try:
                res = subprocess.run(
                    [str(com_candidate), "--version"],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
                if res.returncode == 0 and res.stdout.strip():
                    return res.stdout.strip().splitlines()[0]
            except Exception:
                pass

        # 2. Direct PE binary metadata inspection (instant, non-interactive, zero subprocess)
        pe_version = get_pe_file_version(lo_exe)
        if pe_version:
            return f"LibreOffice {pe_version}"

        return "LibreOffice Detected"

    # Non-Windows (Linux / macOS)
    try:
        res = subprocess.run(
            [lo_exe, "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().splitlines()[0]
    except Exception:
        pass
    return "LibreOffice Detected"

def find_tesseract_binary(custom_path: Optional[str] = None) -> Optional[str]:
    if custom_path and os.path.isfile(custom_path):
        return custom_path

    # Check PATH
    which_path = shutil.which("tesseract") or shutil.which("tesseract.exe")
    if which_path:
        return which_path

    # Check common Windows paths
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    ]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate

    return None

def get_tesseract_languages(tesseract_exe: Optional[str]) -> List[str]:
    if not tesseract_exe:
        return []
    try:
        res = subprocess.run(
            [tesseract_exe, "--list-langs"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        if res.returncode == 0:
            lines = res.stdout.strip().splitlines()
            langs = [line.strip() for line in lines[1:] if line.strip()]
            return langs
    except Exception:
        pass
    return []

def get_tesseract_version(tess_exe: Optional[str]) -> Optional[str]:
    if not tess_exe:
        return None
    try:
        res = subprocess.run(
            [tess_exe, "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        )
        if res.stdout.strip():
            return res.stdout.strip().splitlines()[0]
    except Exception:
        pass
    return "Detected"

def get_system_status(force_refresh: bool = False) -> Dict[str, Any]:
    global _status_cache, _status_cache_time, _status_cache_key
    settings = load_settings()
    cache_key = (
        settings.libreoffice_path,
        settings.tesseract_path,
        settings.default_output_dir,
    )

    now = time.time()
    if (
        not force_refresh
        and _status_cache is not None
        and _status_cache_key == cache_key
        and (now - _status_cache_time) < CACHE_TTL
    ):
        return _status_cache

    lo_exe = find_libreoffice_binary(settings.libreoffice_path)
    tess_exe = find_tesseract_binary(settings.tesseract_path)
    tess_langs = get_tesseract_languages(tess_exe)

    lo_version = get_libreoffice_version(lo_exe)
    tess_version = get_tesseract_version(tess_exe)

    is_prod = (ENVIRONMENT == "production")

    raw_settings = settings.model_dump()
    if is_prod:
        if raw_settings.get("libreoffice_path"):
            raw_settings["libreoffice_path"] = "managed-binary"
        if raw_settings.get("tesseract_path"):
            raw_settings["tesseract_path"] = "managed-binary"
        raw_settings["default_output_dir"] = "managed-storage"

    status = {
        "libreoffice": {
            "installed": lo_exe is not None,
            "path": ("managed-binary" if lo_exe else None) if is_prod else lo_exe,
            "version": lo_version,
            "setup_guide": "Install LibreOffice for Windows (free & open source) from https://www.libreoffice.org/download/download-libreoffice/ to enable DOCX, PPTX, and XLSX to PDF conversion."
        },
        "tesseract": {
            "installed": tess_exe is not None,
            "path": ("managed-binary" if tess_exe else None) if is_prod else tess_exe,
            "version": tess_version,
            "languages": tess_langs,
            "has_english": "eng" in tess_langs,
            "has_bangla": "ben" in tess_langs,
            "setup_guide": "Install Tesseract OCR for Windows from https://github.com/UB-Mannheim/tesseract/wiki and select English and Bengali language packs during installation."
        },
        "settings": raw_settings,
        "paths": {
            "default_output_dir": "managed-storage" if is_prod else settings.default_output_dir,
            "temp_dir": "managed-temp" if is_prod else str(TEMP_DIR),
        }
    }

    _status_cache = status
    _status_cache_time = now
    _status_cache_key = cache_key
    return status

def open_in_file_explorer(target_path: str) -> Dict[str, Any]:
    if ENVIRONMENT == "production":
        return {"success": False, "error": "Opening local folders is only available in local desktop mode."}

    path_obj = Path(target_path).resolve()
    if not path_obj.exists():
        if path_obj.parent.exists():
            path_obj = path_obj.parent
        else:
            return {"success": False, "error": f"Path not found: {target_path}"}

    try:
        if sys.platform == "win32":
            if path_obj.is_file():
                subprocess.Popen(f'explorer /select,"{path_obj}"')
            else:
                subprocess.Popen(f'explorer "{path_obj}"')
        else:
            subprocess.Popen(["xdg-open", str(path_obj.parent if path_obj.is_file() else path_obj)])
        return {"success": True, "path": str(path_obj)}
    except Exception as e:
        return {"success": False, "error": str(e)}

def cleanup_temp_files(max_age_hours: Optional[float] = None) -> int:
    """
    Safely clean up temporary files in TEMP_DIR.
    If max_age_hours is specified, only removes files older than that threshold,
    preventing active conversions and pending downloads from being prematurely deleted.
    If max_age_hours is None, removes all files while recreating required temp subdirectories.
    """
    removed_count = 0
    if not TEMP_DIR.exists():
        return 0

    now = time.time()
    cutoff = (now - (max_age_hours * 3600)) if (max_age_hours is not None and max_age_hours > 0) else None

    # Walk through TEMP_DIR and delete expired/all files
    for root, dirs, files in os.walk(str(TEMP_DIR), topdown=False):
        root_path = Path(root)
        for f in files:
            f_path = root_path / f
            try:
                if cutoff is not None:
                    mtime = f_path.stat().st_mtime
                    if mtime < cutoff:
                        f_path.unlink()
                        removed_count += 1
                else:
                    f_path.unlink()
                    removed_count += 1
            except Exception:
                pass

        # If directory is not the root TEMP_DIR itself, remove if empty
        if root_path != TEMP_DIR.resolve():
            try:
                if not any(root_path.iterdir()):
                    root_path.rmdir()
            except Exception:
                pass

    # Ensure required temporary subdirectories exist
    from backend.config import TEMP_OUTPUT_DIR
    TEMP_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return removed_count
