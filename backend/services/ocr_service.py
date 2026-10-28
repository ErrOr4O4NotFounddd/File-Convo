import io
import os
import pymupdf as fitz
import pytesseract
from PIL import Image
from pathlib import Path
from typing import Dict, Any, Optional, List
from backend.config import load_settings, DEFAULT_OUTPUT_DIR, get_output_dir
from backend.services.system_service import find_tesseract_binary, get_tesseract_languages
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

def ensure_tesseract(configured_lang: str = "eng") -> Optional[str]:
    settings = load_settings()
    tess_exe = find_tesseract_binary(settings.tesseract_path)
    if not tess_exe:
        return (
            "Tesseract OCR was not found on your system. Please install Tesseract OCR for Windows "
            "from https://github.com/UB-Mannheim/tesseract/wiki and specify its path in Settings if not in standard directory."
        )

    pytesseract.pytesseract.tesseract_cmd = tess_exe
    langs = get_tesseract_languages(tess_exe)

    required_langs = [l.strip() for l in configured_lang.split("+") if l.strip()]
    missing_langs = [l for l in required_langs if l not in langs]
    if missing_langs:
        return (
            f"Tesseract is installed, but language data for '{', '.join(missing_langs)}' is missing. "
            f"Available languages: {', '.join(langs) if langs else 'None'}. "
            "Download additional .traineddata language files from https://github.com/tesseract-ocr/tessdata "
            "and place them in the 'tessdata' folder of your Tesseract installation."
        )

    return None

def ocr_image_to_text(
    image_bytes: bytes,
    original_filename: str,
    language: str = "eng",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    err_dep = ensure_tesseract(language)
    if err_dep:
        add_history_entry(original_filename, "Image → TXT (OCR)", "error", error_message=err_dep)
        return {"success": False, "error": err_dep, "missing_dependency": "Tesseract"}

    output_dir = get_output_dir(custom_output_dir)

    try:
        img = Image.open(io.BytesIO(image_bytes))
        extracted_text = pytesseract.image_to_string(img, lang=language)
        img.close()

        stem = Path(original_filename).stem
        out_filename = f"{stem}_ocr.txt"
        out_path = get_unique_output_path(output_dir, out_filename)
        out_path.write_text(extracted_text, encoding="utf-8")

        stats = {
            "characters_extracted": len(extracted_text),
            "word_count": len(extracted_text.split()),
            "language": language,
            "output_size": out_path.stat().st_size,
            "preview_text": extracted_text[:500]
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="Image → TXT (OCR)",
            status="success",
            output_location=str(out_path),
            details=stats
        )

        return {
            "success": True,
            "output_path": str(out_path),
            "output_filename": out_path.name,
            "extracted_text": extracted_text,
            "stats": stats
        }
    except Exception as e:
        err = f"OCR processing failed: {str(e)}"
        add_history_entry(original_filename, "Image → TXT (OCR)", "error", error_message=err)
        return {"success": False, "error": err}

def ocr_pdf_to_text(
    pdf_bytes: bytes,
    original_filename: str,
    language: str = "eng",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    err_dep = ensure_tesseract(language)
    if err_dep:
        add_history_entry(original_filename, "PDF → TXT (OCR)", "error", error_message=err_dep)
        return {"success": False, "error": err_dep, "missing_dependency": "Tesseract"}

    output_dir = get_output_dir(custom_output_dir)

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            return {"success": False, "error": "PDF has no pages"}

        page_texts: List[str] = []
        for pno in range(total_pages):
            page = doc[pno]
            text = page.get_text().strip()
            if len(text) > 40:
                page_texts.append(f"--- Page {pno + 1} ---\n" + text)
            else:
                pix = page.get_pixmap(dpi=300)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                ocr_text = pytesseract.image_to_string(img, lang=language)
                img.close()
                page_texts.append(f"--- Page {pno + 1} (OCR) ---\n" + ocr_text.strip())

        doc.close()
        full_text = "\n\n".join(page_texts)

        stem = Path(original_filename).stem
        out_filename = f"{stem}_ocr.txt"
        out_path = get_unique_output_path(output_dir, out_filename)
        out_path.write_text(full_text, encoding="utf-8")

        stats = {
            "total_pages": total_pages,
            "characters_extracted": len(full_text),
            "word_count": len(full_text.split()),
            "language": language,
            "output_size": out_path.stat().st_size,
            "preview_text": full_text[:500]
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="PDF → TXT (OCR)",
            status="success",
            output_location=str(out_path),
            details=stats
        )

        return {
            "success": True,
            "output_path": str(out_path),
            "output_filename": out_path.name,
            "extracted_text": full_text,
            "stats": stats
        }
    except Exception as e:
        err = f"PDF OCR failed: {str(e)}"
        add_history_entry(original_filename, "PDF → TXT (OCR)", "error", error_message=err)
        return {"success": False, "error": err}

def ocr_pdf_to_searchable_pdf(
    pdf_bytes: bytes,
    original_filename: str,
    language: str = "eng",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    err_dep = ensure_tesseract(language)
    if err_dep:
        add_history_entry(original_filename, "Searchable PDF (OCR)", "error", error_message=err_dep)
        return {"success": False, "error": err_dep, "missing_dependency": "Tesseract"}

    output_dir = get_output_dir(custom_output_dir)

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            return {"success": False, "error": "PDF has no pages"}

        out_pdf = fitz.open()

        for pno in range(total_pages):
            page = doc[pno]
            pix = page.get_pixmap(dpi=200)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            pdf_data = pytesseract.image_to_pdf_or_hocr(img, extension="pdf", lang=language)
            img.close()

            page_doc = fitz.open(stream=pdf_data, filetype="pdf")
            out_pdf.insert_pdf(page_doc)
            page_doc.close()

        doc.close()

        stem = Path(original_filename).stem
        out_filename = f"{stem}_searchable.pdf"
        out_path = get_unique_output_path(output_dir, out_filename)
        out_pdf.save(str(out_path), garbage=4, deflate=True)
        out_pdf.close()

        stats = {
            "total_pages": total_pages,
            "original_size": len(pdf_bytes),
            "output_size": out_path.stat().st_size,
            "language": language
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="Searchable PDF (OCR)",
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
        err = f"Searchable PDF generation failed: {str(e)}"
        add_history_entry(original_filename, "Searchable PDF (OCR)", "error", error_message=err)
        return {"success": False, "error": err}

def ocr_pdf_to_docx(
    pdf_bytes: bytes,
    original_filename: str,
    language: str = "eng",
    custom_output_dir: Optional[str] = None
) -> Dict[str, Any]:
    err_dep = ensure_tesseract(language)
    if err_dep:
        add_history_entry(original_filename, "Scanned PDF → DOCX (OCR)", "error", error_message=err_dep)
        return {"success": False, "error": err_dep, "missing_dependency": "Tesseract"}

    output_dir = get_output_dir(custom_output_dir)

    try:
        from docx import Document
        from docx.shared import Pt

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(doc)
        if total_pages == 0:
            doc.close()
            return {"success": False, "error": "PDF has no pages"}

        word_doc = Document()

        for pno in range(total_pages):
            if pno > 0:
                word_doc.add_page_break()

            page = doc[pno]
            text = page.get_text().strip()
            if len(text) < 40:
                pix = page.get_pixmap(dpi=300)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                text = pytesseract.image_to_string(img, lang=language).strip()
                img.close()

            lines = text.splitlines()
            for line in lines:
                l = line.strip()
                if l:
                    p = word_doc.add_paragraph(l)
                    p.paragraph_format.space_after = Pt(4)

        doc.close()

        stem = Path(original_filename).stem
        out_filename = f"{stem}_ocr.docx"
        out_path = get_unique_output_path(output_dir, out_filename)
        word_doc.save(str(out_path))

        stats = {
            "total_pages": total_pages,
            "original_size": len(pdf_bytes),
            "output_size": out_path.stat().st_size,
            "language": language
        }

        add_history_entry(
            original_filename=original_filename,
            conversion_type="Scanned PDF → DOCX (OCR)",
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
        err = f"Scanned PDF to DOCX OCR failed: {str(e)}"
        add_history_entry(original_filename, "Scanned PDF → DOCX (OCR)", "error", error_message=err)
        return {"success": False, "error": err}
