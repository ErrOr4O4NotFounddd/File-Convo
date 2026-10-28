import os
import zipfile
import io
from pathlib import Path
from typing import List, Dict, Any, Optional
from backend.config import load_settings, DEFAULT_OUTPUT_DIR, get_output_dir
from backend.services.history_service import add_history_entry

def get_unique_output_path(output_dir: Path, filename: str) -> Path:
    stem = Path(filename).stem
    ext = Path(filename).suffix
    candidate = output_dir / f"{stem}{ext}"
    counter = 1
    while candidate.exists():
        candidate = output_dir / f"{stem}_{counter}{ext}"
        counter += 1
    return candidate

def is_safe_zip_member(target_dir: Path, member_name: str) -> bool:
    """
    Prevents directory traversal (Zip Slip) vulnerability.
    """
    dest = (target_dir / member_name).resolve()
    base = target_dir.resolve()
    return base in dest.parents or dest == base

def create_zip(
    file_bytes_list: List[bytes],
    filenames: List[str],
    zip_name: str = "archive.zip",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    if not file_bytes_list:
        return {"success": False, "error": "No files provided to archive"}

    if not zip_name.lower().endswith(".zip"):
        zip_name += ".zip"

    output_dir = get_output_dir(custom_output_dir)
    out_path = get_unique_output_path(output_dir, zip_name)

    total_orig_size = sum(len(b) for b in file_bytes_list)

    try:
        with zipfile.ZipFile(out_path, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            used_names: set[str] = set()
            for b, fname in zip(file_bytes_list, filenames):
                safe_name = Path(fname).name
                # Avoid duplicate names in zip
                final_name = safe_name
                counter = 1
                while final_name in used_names:
                    final_name = f"{Path(safe_name).stem}_{counter}{Path(safe_name).suffix}"
                    counter += 1
                used_names.add(final_name)
                zf.writestr(final_name, b)

        out_size = out_path.stat().st_size
        bytes_saved = total_orig_size - out_size
        pct_saved = round((bytes_saved / total_orig_size) * 100, 2) if total_orig_size > 0 else 0

        stats = {
            "files_count": len(filenames),
            "files_archived": filenames,
            "original_total_size": total_orig_size,
            "output_size": out_size,
            "bytes_saved": bytes_saved,
            "percent_saved": pct_saved
        }

        add_history_entry(
            original_filename=f"{len(filenames)} files",
            conversion_type="Create ZIP",
            status="success",
            output_location=str(out_path),
            details=stats
        )

        return {
            "success": True,
            "output_path": str(out_path),
            "output_filename": out_path.name,
            "stats": stats
        }
    except Exception as e:
        err = f"Failed to create ZIP: {str(e)}"
        add_history_entry("Multiple Files", "Create ZIP", "error", error_message=err)
        return {"success": False, "error": err}

def extract_zip(
    zip_bytes: bytes,
    original_filename: str,
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    output_dir = get_output_dir(custom_output_dir)
    stem = Path(original_filename).stem
    extract_folder = output_dir / f"{stem}_extracted"
    extract_folder.mkdir(parents=True, exist_ok=True)

    try:
        with io.BytesIO(zip_bytes) as bio:
            if not zipfile.is_zipfile(bio):
                err = "Uploaded file is not a valid or supported ZIP archive."
                add_history_entry(original_filename, "Extract ZIP", "error", error_message=err)
                return {"success": False, "error": err}

            bio.seek(0)
            with zipfile.ZipFile(bio, "r") as zf:
                # Security: inspect all names for Zip Slip
                namelist = zf.namelist()
                for name in namelist:
                    if not is_safe_zip_member(extract_folder, name):
                        err = f"Security error: Archive contains unsafe relative path '{name}'."
                        add_history_entry(original_filename, "Extract ZIP", "error", error_message=err)
                        return {"success": False, "error": err}

                extracted_files = []
                for member in zf.infolist():
                    target_path = extract_folder / member.filename
                    if member.is_dir():
                        target_path.mkdir(parents=True, exist_ok=True)
                    else:
                        target_path.parent.mkdir(parents=True, exist_ok=True)
                        with zf.open(member) as source, open(target_path, "wb") as target:
                            target.write(source.read())
                        extracted_files.append(member.filename)

        stats = {
            "archive_size": len(zip_bytes),
            "extracted_count": len(extracted_files),
            "extracted_folder": str(extract_folder),
            "file_list": extracted_files[:50]
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="Extract ZIP",
            status="success",
            output_location=str(extract_folder),
            details=stats
        )

        return {
            "success": True,
            "output_folder": str(extract_folder),
            "extracted_count": len(extracted_files),
            "files": extracted_files,
            "stats": stats
        }
    except zipfile.BadZipFile:
        err = "Corrupted or invalid ZIP archive."
        add_history_entry(original_filename, "Extract ZIP", "error", error_message=err)
        return {"success": False, "error": err}
    except Exception as e:
        err = f"Extraction failed: {str(e)}"
        add_history_entry(original_filename, "Extract ZIP", "error", error_message=err)
        return {"success": False, "error": err}
