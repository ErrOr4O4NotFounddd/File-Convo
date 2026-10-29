import os
import shutil
import re
import io
import uuid
import base64
import pymupdf as fitz
from pathlib import Path
from typing import List, Dict, Any, Optional
from pypdf import PdfReader, PdfWriter
from backend.config import load_settings, DEFAULT_OUTPUT_DIR, get_output_dir, TEMP_DIR
from backend.services.history_service import add_history_entry

def _get_organizer_dir() -> Path:
    try:
        p = TEMP_DIR / "organizer"
        p.mkdir(parents=True, exist_ok=True)
        return p
    except Exception:
        import tempfile
        fallback = Path(tempfile.gettempdir()) / ".fileconvo" / "temp" / "organizer"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback

ORGANIZER_TEMP_DIR = _get_organizer_dir()

def get_unique_output_path(output_dir: Path, filename: str) -> Path:
    stem = Path(filename).stem
    ext = Path(filename).suffix
    candidate = output_dir / f"{stem}{ext}"
    counter = 1
    while candidate.exists():
        candidate = output_dir / f"{stem}_{counter}{ext}"
        counter += 1
    return candidate

def parse_page_ranges(range_str: str, max_pages: int) -> List[int]:
    """
    Parses a page range string like '1, 3-5, 8' into 0-indexed page integers.
    Ensures pages are strictly within 1..max_pages and sorted.
    """
    pages: set[int] = set()
    parts = [p.strip() for p in range_str.split(",") if p.strip()]
    if not parts:
        raise ValueError("No pages specified")

    for part in parts:
        if "-" in part:
            bounds = part.split("-")
            if len(bounds) != 2:
                raise ValueError(f"Invalid page range token: '{part}'")
            start_str, end_str = bounds[0].strip(), bounds[1].strip()
            if not start_str.isdigit() or not end_str.isdigit():
                raise ValueError(f"Invalid numbers in range: '{part}'")
            start, end = int(start_str), int(end_str)
            if start < 1 or end > max_pages or start > end:
                raise ValueError(f"Range {start}-{end} out of bounds (document has {max_pages} pages)")
            for p in range(start, end + 1):
                pages.add(p - 1)  # 0-indexed
        else:
            if not part.isdigit():
                raise ValueError(f"Invalid page number: '{part}'")
            p = int(part)
            if p < 1 or p > max_pages:
                raise ValueError(f"Page {p} out of bounds (document has {max_pages} pages)")
            pages.add(p - 1)

    return sorted(list(pages))

def merge_pdfs(
    file_bytes_list: List[bytes],
    filenames: List[str],
    output_filename: str = "merged.pdf",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    if not file_bytes_list:
        return {"success": False, "error": "No PDF files provided"}

    output_dir = get_output_dir(custom_output_dir)
    out_path = get_unique_output_path(output_dir, output_filename)

    total_orig_size = sum(len(b) for b in file_bytes_list)
    merged_doc = fitz.open()

    try:
        for idx, (b, fname) in enumerate(zip(file_bytes_list, filenames)):
            try:
                sub_doc = fitz.open(stream=b, filetype="pdf")
                merged_doc.insert_pdf(sub_doc)
                sub_doc.close()
            except Exception as e:
                merged_doc.close()
                err = f"Failed to read PDF '{fname}': {str(e)}"
                add_history_entry("Multiple Files", "PDF Merge", "error", error_message=err)
                return {"success": False, "error": err}

        merged_doc.save(str(out_path), garbage=4, deflate=True)
        total_pages = len(merged_doc)
        merged_doc.close()

        output_size = out_path.stat().st_size
        stats = {
            "file_count": len(filenames),
            "total_pages": total_pages,
            "original_total_size": total_orig_size,
            "output_size": output_size,
            "files_merged": filenames
        }

        add_history_entry(
            original_filename=", ".join(filenames[:3]) + (f" +{len(filenames)-3} more" if len(filenames) > 3 else ""),
            conversion_type="PDF Merge",
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
        if 'out_path' in locals() and out_path.exists():
            out_path.unlink(missing_ok=True)
        if merged_doc:
            merged_doc.close()
        err = f"Merge failed: {str(e)}"
        add_history_entry("Multiple Files", "PDF Merge", "error", error_message=err)
        return {"success": False, "error": err}

def split_pdf(
    file_bytes: bytes,
    original_filename: str,
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    output_dir = get_output_dir(custom_output_dir)
    stem = Path(original_filename).stem
    split_folder = output_dir / f"{stem}_pages"
    split_folder.mkdir(parents=True, exist_ok=True)

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            return {"success": False, "error": "PDF has no pages"}

        created_files = []
        for i in range(total_pages):
            single_page_doc = fitz.open()
            single_page_doc.insert_pdf(doc, from_page=i, to_page=i)
            out_file = split_folder / f"{stem}_page_{i+1}.pdf"
            single_page_doc.save(str(out_file), garbage=4, deflate=True)
            single_page_doc.close()
            created_files.append(out_file.name)

        doc.close()
        stats = {
            "total_pages": total_pages,
            "output_folder": str(split_folder),
            "created_files_count": len(created_files)
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="PDF Split",
            status="success",
            output_location=str(split_folder),
            details=stats
        )

        return {
            "success": True,
            "output_folder": str(split_folder),
            "created_files": created_files,
            "stats": stats
        }
    except Exception as e:
        if 'split_folder' in locals() and split_folder.exists():
            shutil.rmtree(split_folder, ignore_errors=True)
        err = f"PDF split failed: {str(e)}"
        add_history_entry(original_filename, "PDF Split", "error", error_message=err)
        return {"success": False, "error": err}

def extract_pdf_pages(
    file_bytes: bytes,
    original_filename: str,
    page_ranges: str,
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    output_dir = get_output_dir(custom_output_dir)

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            return {"success": False, "error": "PDF has no pages"}

        target_pages = parse_page_ranges(page_ranges, total_pages)
        if not target_pages:
            doc.close()
            return {"success": False, "error": "No valid pages to extract"}

        extracted_doc = fitz.open()
        for p in target_pages:
            extracted_doc.insert_pdf(doc, from_page=p, to_page=p)

        stem = Path(original_filename).stem
        out_filename = f"{stem}_extracted.pdf"
        out_path = get_unique_output_path(output_dir, out_filename)

        extracted_doc.save(str(out_path), garbage=4, deflate=True)
        doc.close()
        extracted_doc.close()

        output_size = out_path.stat().st_size
        stats = {
            "original_pages": total_pages,
            "extracted_pages_count": len(target_pages),
            "extracted_page_numbers": [p + 1 for p in target_pages],
            "original_size": len(file_bytes),
            "output_size": output_size
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="PDF Extract Pages",
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
        if 'out_path' in locals() and out_path.exists():
            out_path.unlink(missing_ok=True)
        err = f"Extraction failed: {str(e)}"
        add_history_entry(original_filename, "PDF Extract Pages", "error", error_message=err)
        return {"success": False, "error": err}

def compress_pdf(
    file_bytes: bytes,
    original_filename: str,
    compression_level: str = "medium",  # "low", "medium", "high"
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    output_dir = get_output_dir(custom_output_dir)
    orig_size = len(file_bytes)

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        stem = Path(original_filename).stem
        out_filename = f"{stem}_compressed.pdf"
        out_path = get_unique_output_path(output_dir, out_filename)

        if compression_level == "high":
            for page in doc:
                image_list = page.get_images(full=True)
                for img_info in image_list:
                    xref = img_info[0]
                    try:
                        base_image = doc.extract_image(xref)
                        if base_image:
                            from PIL import Image
                            image_data = base_image["image"]
                            im = Image.open(io.BytesIO(image_data))
                            if im.width > 1200 or im.height > 1200:
                                im.thumbnail((1200, 1200))
                                out_img = io.BytesIO()
                                if im.mode in ("RGBA", "P"):
                                    im = im.convert("RGB")
                                im.save(out_img, format="JPEG", quality=65, optimize=True)
                            im.close()
                    except Exception:
                        pass

        doc.save(
            str(out_path),
            garbage=4,
            deflate=True,
            deflate_images=True,
            deflate_fonts=True,
            clean=True
        )
        total_pages = len(doc)
        doc.close()

        out_size = out_path.stat().st_size
        bytes_saved = orig_size - out_size
        pct_saved = round((bytes_saved / orig_size) * 100, 2) if orig_size > 0 else 0

        stats = {
            "original_size": orig_size,
            "output_size": out_size,
            "bytes_saved": bytes_saved,
            "percent_saved": pct_saved,
            "compression_level": compression_level,
            "total_pages": total_pages,
            "further_compression_possible": bytes_saved > 0
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="PDF Compress",
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
        if 'out_path' in locals() and out_path.exists():
            out_path.unlink(missing_ok=True)
        err = f"PDF compression failed: {str(e)}"
        add_history_entry(original_filename, "PDF Compress", "error", error_message=err)
        return {"success": False, "error": err}


def _render_thumbnails_for_doc(doc: fitz.Document, start_page: int = 0, count: int = 50) -> List[Dict[str, Any]]:
    """
    Renders visual thumbnails for a given slice of pages in a PyMuPDF document.
    Outputs JPEG encoded thumbnails in base64 data URIs.
    """
    total = len(doc)
    pages_data: List[Dict[str, Any]] = []
    end_page = min(total, start_page + count)

    for idx in range(start_page, end_page):
        page = doc[idx]
        rect = page.rect
        rot = page.rotation

        # Scale so the thumbnail maximum bounding dimension is ~220px
        scale = min(220.0 / max(rect.width, 1), 220.0 / max(rect.height, 1), 1.5)
        scale = max(scale, 0.2)
        mat = fitz.Matrix(scale, scale)

        pix = page.get_pixmap(matrix=mat, alpha=False)
        jpeg_bytes = pix.tobytes("jpeg")
        b64_str = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")

        pages_data.append({
            "page_index": idx,
            "page_number": idx + 1,
            "width": round(rect.width, 1),
            "height": round(rect.height, 1),
            "rotation": rot,
            "thumbnail": b64_str
        })

    return pages_data


def load_pdf_for_organizer(
    file_bytes: bytes,
    original_filename: str,
    initial_thumbnails_count: int = 100
) -> Dict[str, Any]:
    """
    Validates and stores a PDF into the temporary organizer workspace,
    and returns its document metadata alongside initial visual thumbnails.
    """
    if not file_bytes:
        return {"success": False, "error": "Uploaded file is empty"}

    # 1. Validate stream in memory first (no file locking or stray disk files on error)
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        return {"success": False, "error": f"Invalid or corrupted PDF file: {str(e)}"}

    try:
        if doc.is_encrypted:
            doc.close()
            return {
                "success": False,
                "error": "The uploaded PDF is password-protected. Please remove password protection before organizing pages."
            }

        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            return {"success": False, "error": "The uploaded PDF contains no pages."}

        pages_data = _render_thumbnails_for_doc(doc, start_page=0, count=initial_thumbnails_count)
        doc.close()
    except Exception as e:
        try:
            doc.close()
        except Exception:
            pass
        return {"success": False, "error": f"Failed to process PDF: {str(e)}"}

    # 2. Save validated PDF to temporary organizer workspace
    organizer_dir = _get_organizer_dir()
    file_id = f"org_{uuid.uuid4().hex[:12]}"
    file_path = organizer_dir / f"{file_id}.pdf"
    try:
        file_path.write_bytes(file_bytes)
    except Exception as e:
        return {"success": False, "error": f"Failed to save temporary PDF: {str(e)}"}

    return {
        "success": True,
        "file_id": file_id,
        "filename": original_filename,
        "total_pages": total_pages,
        "pages": pages_data
    }


def get_organizer_thumbnails(
    file_id: str,
    start_page: int = 0,
    count: int = 50
) -> Dict[str, Any]:
    """
    Renders and returns additional thumbnails for lazy loading / pagination.
    """
    # Sanitize file_id to prevent directory traversal
    clean_id = re.sub(r"[^a-zA-Z0-9_\-]", "", file_id)
    organizer_dir = _get_organizer_dir()
    file_path = organizer_dir / f"{clean_id}.pdf"

    if not file_path.is_file():
        return {"success": False, "error": f"Document session expired or not found: {file_id}"}

    try:
        doc = fitz.open(str(file_path))
        pages_data = _render_thumbnails_for_doc(doc, start_page=max(0, start_page), count=max(1, count))
        total_pages = len(doc)
        doc.close()

        return {
            "success": True,
            "file_id": clean_id,
            "start_page": start_page,
            "total_pages": total_pages,
            "pages": pages_data
        }
    except Exception as e:
        return {"success": False, "error": f"Failed to load thumbnails: {str(e)}"}


def export_organized_pdf(
    pages: List[Dict[str, Any]],
    output_filename: str = "organized_document.pdf",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Compiles rearranged, added, or deleted pages into a pristine vector PDF.
    Maintains original page dimensions, fonts, vectors, rotation, and content.
    """
    if not pages or len(pages) == 0:
        return {"success": False, "error": "Cannot export an empty PDF. Please include at least one page."}

    # Normalize output filename to ensure .pdf extension
    raw_stem = Path(output_filename).stem.strip() or "organized_document"
    clean_stem = re.sub(r'[^a-zA-Z0-9_\-\. ]', '_', raw_stem).strip() or "organized_document"
    safe_filename = f"{clean_stem}.pdf"

    output_dir = get_output_dir(custom_output_dir)
    out_path = get_unique_output_path(output_dir, safe_filename)

    out_doc = fitz.open()
    opened_docs: Dict[str, fitz.Document] = {}
    organizer_dir = _get_organizer_dir()

    try:
        for idx, item in enumerate(pages):
            raw_fid = item.get("file_id", "")
            fid = re.sub(r"[^a-zA-Z0-9_\-]", "", str(raw_fid))
            if not fid:
                return {"success": False, "error": f"Page item at position {idx+1} is missing a valid file_id"}

            try:
                p_idx = int(item.get("page_index", 0))
            except (ValueError, TypeError):
                return {"success": False, "error": f"Invalid page index in position {idx+1}"}

            if fid not in opened_docs:
                fpath = organizer_dir / f"{fid}.pdf"
                if not fpath.is_file():
                    return {"success": False, "error": f"Source document expired or not found for page {idx+1}"}
                opened_docs[fid] = fitz.open(str(fpath))

            src_doc = opened_docs[fid]
            if p_idx < 0 or p_idx >= len(src_doc):
                return {
                    "success": False,
                    "error": f"Page index {p_idx} out of range for document (total: {len(src_doc)} pages)"
                }

            # Insert exact PDF page (lossless vector merge)
            out_doc.insert_pdf(src_doc, from_page=p_idx, to_page=p_idx)

            # Apply any custom rotation if specified
            custom_rot = item.get("rotation")
            if custom_rot is not None:
                try:
                    out_doc[-1].set_rotation(int(custom_rot) % 360)
                except Exception:
                    pass

        # Save output document
        out_doc.save(str(out_path), garbage=4, deflate=True)
        total_pages = len(out_doc)
        output_size = out_path.stat().st_size

        stats = {
            "total_pages": total_pages,
            "source_files_count": len(opened_docs),
            "output_size": output_size,
            "output_filename": out_path.name
        }

        add_history_entry(
            original_filename=safe_filename,
            conversion_type="PDF Page Organizer",
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
        if 'out_path' in locals() and out_path.exists():
            out_path.unlink(missing_ok=True)
        err = f"Export failed: {str(e)}"
        add_history_entry(safe_filename, "PDF Page Organizer", "error", error_message=err)
        return {"success": False, "error": err}
    finally:
        out_doc.close()
        for doc in opened_docs.values():
            try:
                doc.close()
            except Exception:
                pass
