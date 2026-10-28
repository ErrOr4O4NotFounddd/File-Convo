import os
import subprocess
import sys
import shutil
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional
import pymupdf as fitz
from backend.config import load_settings, DEFAULT_OUTPUT_DIR, get_output_dir
from backend.services.system_service import find_libreoffice_binary
from backend.services.history_service import add_history_entry

SUPPORTED_DOC_EXTENSIONS = {".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".odt", ".odp", ".ods", ".rtf", ".txt"}

def get_unique_output_path(output_dir: Path, filename: str) -> Path:
    stem = Path(filename).stem
    ext = Path(filename).suffix
    candidate = output_dir / f"{stem}{ext}"
    counter = 1
    while candidate.exists():
        candidate = output_dir / f"{stem}_{counter}{ext}"
        counter += 1
    return candidate

def convert_document_to_pdf(
    file_bytes: bytes,
    original_filename: str,
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    settings = load_settings()
    ext = Path(original_filename).suffix.lower()

    if ext not in SUPPORTED_DOC_EXTENSIONS:
        error_msg = f"Unsupported document format '{ext}'. Supported formats: {', '.join(sorted(SUPPORTED_DOC_EXTENSIONS))}"
        add_history_entry(original_filename, "Document → PDF", "error", error_message=error_msg)
        return {"success": False, "error": error_msg, "original_filename": original_filename}

    output_dir = get_output_dir(custom_output_dir)
    stem = Path(original_filename).stem

    # Special native conversion for .txt files: rendered directly to PDF with PyMuPDF
    if ext == ".txt":
        try:
            text_content = file_bytes.decode("utf-8", errors="replace")
            doc = fitz.open()
            page = doc.new_page(width=595, height=842)
            # Add text with wrapping
            rect = fitz.Rect(50, 50, 545, 792)
            page.insert_textbox(rect, text_content, fontsize=11, fontname="helv")
            out_path = get_unique_output_path(output_dir, f"{stem}.pdf")
            doc.save(str(out_path))
            doc.close()

            stats = {
                "original_size": len(file_bytes),
                "output_size": out_path.stat().st_size,
                "page_count": 1,
                "output_format": "PDF"
            }
            add_history_entry(original_filename, "Document → PDF", "success", str(out_path), stats)
            return {
                "success": True,
                "output_path": str(out_path),
                "output_filename": out_path.name,
                "stats": stats
            }
        except Exception:
            pass

    lo_exe = find_libreoffice_binary(settings.libreoffice_path)

    if not lo_exe:
        error_msg = (
            "LibreOffice was not found on your system. Document conversion (DOCX/PPTX/XLSX → PDF) requires "
            "LibreOffice headless. Please install LibreOffice from https://www.libreoffice.org/download/ "
            "or configure its executable path in Settings."
        )
        add_history_entry(
            original_filename=original_filename,
            conversion_type="Document → PDF",
            status="error",
            error_message=error_msg
        )
        return {
            "success": False,
            "error": error_msg,
            "missing_dependency": "LibreOffice",
            "original_filename": original_filename
        }

    # Use unique isolated temp directory for conversion to prevent race conditions
    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        temp_input = temp_dir / original_filename
        temp_input.write_bytes(file_bytes)

        cmd = [
            lo_exe,
            "--headless",
            "--invisible",
            "--nodefault",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            str(temp_dir),
            str(temp_input)
        ]

        try:
            res = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            )

            generated_pdf = temp_dir / f"{stem}.pdf"
            if not generated_pdf.exists():
                candidates = list(temp_dir.glob("*.pdf"))
                if candidates:
                    generated_pdf = candidates[0]
                else:
                    stderr = res.stderr.strip() or res.stdout.strip()
                    error_msg = f"LibreOffice failed to generate PDF. Return code: {res.returncode}. {stderr}"
                    add_history_entry(original_filename, "Document → PDF", "error", error_message=error_msg)
                    return {"success": False, "error": error_msg, "original_filename": original_filename}

            final_out_path = get_unique_output_path(output_dir, f"{stem}.pdf")
            shutil.copy2(str(generated_pdf), str(final_out_path))

            orig_size = len(file_bytes)
            out_size = final_out_path.stat().st_size

            page_count = 0
            try:
                doc = fitz.open(str(final_out_path))
                page_count = len(doc)
                doc.close()
            except Exception:
                pass

            stats = {
                "original_size": orig_size,
                "output_size": out_size,
                "page_count": page_count,
                "output_format": "PDF"
            }

            add_history_entry(
                original_filename=original_filename,
                conversion_type="Document → PDF",
                status="success",
                output_location=str(final_out_path),
                details=stats
            )

            return {
                "success": True,
                "output_path": str(final_out_path),
                "output_filename": final_out_path.name,
                "stats": stats
            }

        except subprocess.TimeoutExpired:
            error_msg = "Conversion timed out after 60 seconds."
            add_history_entry(original_filename, "Document → PDF", "error", error_message=error_msg)
            return {"success": False, "error": error_msg, "original_filename": original_filename}
        except Exception as e:
            error_msg = f"Unexpected error during document conversion: {str(e)}"
            add_history_entry(original_filename, "Document → PDF", "error", error_message=error_msg)
            return {"success": False, "error": error_msg, "original_filename": original_filename}
