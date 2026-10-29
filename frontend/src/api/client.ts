// Determine the API base URL.
// When VITE_API_BASE_URL is configured (e.g. deployed frontend calling a separate backend service),
// it is used as the base.
// In local dev with Vite proxy or unified deployments, relative "" is used.
const getApiBase = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return "";
};

const API_BASE = getApiBase();

/**
 * Robust fetch wrapper that intercepts low-level network errors (such as ERR_CONNECTION_REFUSED
 * when the backend is offline) and raises an actionable, human-friendly error message
 * instead of the opaque browser default "Failed to fetch".
 */
async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    return res;
  } catch (err: any) {
    if (
      err instanceof TypeError ||
      err.name === "TypeError" ||
      err.message?.includes("Failed to fetch") ||
      err.message?.includes("NetworkError") ||
      err.message?.includes("Network request failed")
    ) {
      const targetServer = API_BASE ? API_BASE : "the backend API";
      throw new Error(
        `Cannot connect to the File Convo backend service at ${targetServer}. ` +
        `Please ensure the backend server is running and accessible.`
      );
    }
    throw err;
  }
}

async function handleResponse<T = any>(res: Response, fallbackError: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const json = await res.json();
      detail = json.detail || json.error || json.message;
    } catch {
      try {
        detail = await res.text();
      } catch {
        // ignore
      }
    }
    throw new Error(detail || `${fallbackError} (HTTP ${res.status}: ${res.statusText})`);
  }
  return res.json();
}

export interface SystemStatus {
  libreoffice: {
    installed: boolean;
    path: string | null;
    version: string | null;
    setup_guide: string;
  };
  tesseract: {
    installed: boolean;
    path: string | null;
    version: string | null;
    languages: string[];
    has_english: boolean;
    has_bangla: boolean;
    setup_guide: string;
  };
  settings: AppSettings;
  paths: {
    default_output_dir: string;
    temp_dir: string;
  };
}

export interface AppSettings {
  default_output_dir: string;
  default_image_quality: number;
  default_image_format: string;
  preserve_exif: boolean;
  pdf_compression_level: string;
  max_file_size_mb: number;
  libreoffice_path?: string | null;
  tesseract_path?: string | null;
  ocr_language: string;
  temp_cleanup_policy: string;
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  original_filename: string;
  conversion_type: string;
  status: "success" | "error";
  output_location?: string | null;
  details?: Record<string, any>;
  error_message?: string | null;
}

export interface ConversionResult {
  success: boolean;
  output_path?: string;
  output_filename?: string;
  output_folder?: string;
  extracted_count?: number;
  extracted_text?: string;
  created_files?: string[];
  stats?: Record<string, any>;
  error?: string;
  missing_dependency?: string;
  target_achieved?: boolean;
  target_explanation?: string;
  fidelity_warning?: string;
}

export interface OrganizerPageData {
  page_index: number;
  page_number: number;
  width: number;
  height: number;
  rotation: number;
  thumbnail: string;
}

export interface OrganizerUploadResponse {
  success: boolean;
  file_id: string;
  filename: string;
  total_pages: number;
  pages: OrganizerPageData[];
}

export interface OrganizerThumbnailsResponse {
  success: boolean;
  file_id: string;
  start_page: number;
  total_pages: number;
  pages: OrganizerPageData[];
}

export interface OrganizerPageExportItem {
  file_id: string;
  page_index: number;
  rotation?: number;
}


export type ScannerFilterType =
  | "original"
  | "magic_color"
  | "auto_enhance"
  | "grayscale"
  | "black_white"
  | "document"
  | "enhanced";

export interface ScannerPageConfig {
  rotation?: number;
  filter_type?: ScannerFilterType;
  crop_quad?: number[] | null;
}

export interface ScannerExportOptions {
  paper_size: "a4" | "letter" | "fit";
  page_fit?: "fit" | "fill";
  orientation: "portrait" | "landscape" | "auto";
  margin: "normal" | "narrow" | "none";
  quality: "standard" | "high";
  add_page_numbers: boolean;
  output_filename: string;
  custom_output_dir?: string;
}

export interface ScannerPreviewResponse {
  success: boolean;
  thumbnail: string;
  original_thumbnail?: string;
  width: number;
  height: number;
  filename: string;
  detected_corners?: number[] | null;
  detection_confidence?: number;
}

export const api = {
  async getSystemStatus(): Promise<SystemStatus> {
    const res = await safeFetch(`${API_BASE}/api/system/status`);
    return handleResponse<SystemStatus>(res, "Failed to load system status");
  },

  async getSettings(): Promise<AppSettings> {
    const res = await safeFetch(`${API_BASE}/api/system/settings`);
    return handleResponse<AppSettings>(res, "Failed to load settings");
  },

  async updateSettings(settings: AppSettings): Promise<{ success: boolean; settings: AppSettings }> {
    const res = await safeFetch(`${API_BASE}/api/system/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    return handleResponse<{ success: boolean; settings: AppSettings }>(res, "Failed to update settings");
  },

  async openInExplorer(path: string): Promise<{ success: boolean; path?: string }> {
    const res = await safeFetch(`${API_BASE}/api/system/open-explorer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return handleResponse<{ success: boolean; path?: string }>(res, "Failed to open explorer");
  },

  async cleanupTemp(): Promise<{ success: boolean; files_removed: number }> {
    const res = await safeFetch(`${API_BASE}/api/system/cleanup-temp`, { method: "POST" });
    return handleResponse<{ success: boolean; files_removed: number }>(res, "Failed to cleanup temp");
  },

  async convertDocuments(files: File[], customOutputDir?: string): Promise<{ results: ConversionResult[] }> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/documents/convert`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<{ results: ConversionResult[] }>(res, "Document conversion failed");
  },

  async mergePdfs(files: File[], outputFilename: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    formData.append("output_filename", outputFilename);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/pdf/merge`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "PDF merge failed");
  },

  async splitPdf(file: File, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/pdf/split`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "PDF split failed");
  },

  async extractPdfPages(file: File, pageRanges: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("page_ranges", pageRanges);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/pdf/extract-pages`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "Extract pages failed");
  },

  async compressPdf(file: File, compressionLevel: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("compression_level", compressionLevel);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/pdf/compress`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "PDF compression failed");
  },

  async uploadPdfForOrganizer(file: File): Promise<OrganizerUploadResponse> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await safeFetch(`${API_BASE}/api/pdf/organizer/upload`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<OrganizerUploadResponse>(res, "Failed to upload PDF for organization");
  },

  async getOrganizerThumbnails(fileId: string, startPage: number = 0, count: number = 50): Promise<OrganizerThumbnailsResponse> {
    const formData = new FormData();
    formData.append("file_id", fileId);
    formData.append("start_page", startPage.toString());
    formData.append("count", count.toString());

    const res = await safeFetch(`${API_BASE}/api/pdf/organizer/thumbnails`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<OrganizerThumbnailsResponse>(res, "Failed to fetch page thumbnails");
  },

  async exportOrganizedPdf(
    pages: OrganizerPageExportItem[],
    outputFilename: string = "organized_document.pdf",
    customOutputDir?: string
  ): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("pages", JSON.stringify(pages));
    formData.append("output_filename", outputFilename);
    if (customOutputDir) {
      formData.append("custom_output_dir", customOutputDir);
    }

    const res = await safeFetch(`${API_BASE}/api/pdf/organizer/export`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "Failed to export organized PDF");
  },

  async processImages(
    files: File[],
    options: {
      target_format: string;
      quality: number;
      enable_resize: boolean;
      resize_mode: string;
      target_width?: number;
      target_height?: number;
      resize_percentage?: number;
      maintain_aspect_ratio: boolean;
      enable_target_size?: boolean;
      target_size_kb?: number;
      allow_png_fallback?: boolean;
      auto_downscale?: boolean;
      preserve_exif: boolean;
      bg_color_hex: string;
      custom_output_dir?: string;
    }
  ): Promise<{ results: ConversionResult[] }> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    formData.append("target_format", options.target_format);
    formData.append("quality", options.quality.toString());
    formData.append("enable_resize", options.enable_resize ? "true" : "false");
    formData.append("resize_mode", options.resize_mode);
    if (options.target_width) formData.append("target_width", options.target_width.toString());
    if (options.target_height) formData.append("target_height", options.target_height.toString());
    if (options.resize_percentage) formData.append("resize_percentage", options.resize_percentage.toString());
    formData.append("maintain_aspect_ratio", options.maintain_aspect_ratio ? "true" : "false");
    formData.append("enable_target_size", options.enable_target_size ? "true" : "false");
    if (options.target_size_kb) formData.append("target_size_kb", options.target_size_kb.toString());
    formData.append("allow_png_fallback", options.allow_png_fallback !== false ? "true" : "false");
    formData.append("auto_downscale", options.auto_downscale ? "true" : "false");
    formData.append("preserve_exif", options.preserve_exif ? "true" : "false");
    formData.append("bg_color_hex", options.bg_color_hex);
    if (options.custom_output_dir) formData.append("custom_output_dir", options.custom_output_dir);

    const res = await safeFetch(`${API_BASE}/api/images/process`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<{ results: ConversionResult[] }>(res, "Image processing failed");
  },

  async compressImagesTargetSize(
    files: File[],
    options: {
      target_size_kb: number;
      output_format: string;
      max_width?: number;
      max_height?: number;
      allow_png_fallback: boolean;
      auto_downscale: boolean;
      custom_output_dir?: string;
    }
  ): Promise<{ results: ConversionResult[] }> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    formData.append("target_size_kb", options.target_size_kb.toString());
    formData.append("output_format", options.output_format);
    if (options.max_width) formData.append("max_width", options.max_width.toString());
    if (options.max_height) formData.append("max_height", options.max_height.toString());
    formData.append("allow_png_fallback", options.allow_png_fallback ? "true" : "false");
    formData.append("auto_downscale", options.auto_downscale ? "true" : "false");
    if (options.custom_output_dir) formData.append("custom_output_dir", options.custom_output_dir);

    const res = await safeFetch(`${API_BASE}/api/images/compress-target-size`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<{ results: ConversionResult[] }>(res, "Target size compression failed");
  },


  async previewScannerFile(file: File): Promise<ScannerPreviewResponse> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await safeFetch(`${API_BASE}/api/scanner/preview-file`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ScannerPreviewResponse>(res, "Failed to preview scanner image");
  },

  async detectScannerCorners(file: File | Blob): Promise<{
    success: boolean;
    detected: boolean;
    corners: number[] | null;
    confidence: number;
    filename?: string;
  }> {
    const formData = new FormData();
    const f = file instanceof File ? file : new File([file], "page.jpg", { type: "image/jpeg" });
    formData.append("file", f);
    const res = await safeFetch(`${API_BASE}/api/scanner/detect-corners`, {
      method: "POST",
      body: formData,
    });
    return handleResponse(res, "Failed to detect document corners");
  },

  async processScannerPreview(
    file: File | Blob,
    rotation: number,
    cropQuad: number[] | null,
    filterType: string
  ): Promise<{ success: boolean; thumbnail: string; width: number; height: number }> {
    const formData = new FormData();
    const f = file instanceof File ? file : new File([file], "page.jpg", { type: "image/jpeg" });
    formData.append("file", f);
    formData.append("rotation", rotation.toString());
    if (cropQuad) {
      formData.append("crop_quad", JSON.stringify(cropQuad));
    }
    formData.append("filter_type", filterType);

    const res = await safeFetch(`${API_BASE}/api/scanner/process-preview`, {
      method: "POST",
      body: formData,
    });
    return handleResponse(res, "Failed to render preview");
  },

  async exportScannedPdf(
    files: (File | Blob)[],
    pagesConfig: ScannerPageConfig[],
    options: ScannerExportOptions
  ): Promise<ConversionResult> {
    const formData = new FormData();
    files.forEach((f, idx) => {
      const fname = (f as File).name || `page_${idx + 1}.jpg`;
      formData.append("files", f, fname);
    });
    formData.append("pages_config", JSON.stringify(pagesConfig));
    formData.append("paper_size", options.paper_size);
    if (options.page_fit) {
      formData.append("page_fit", options.page_fit);
    }
    formData.append("orientation", options.orientation);
    formData.append("margin", options.margin);
    formData.append("quality", options.quality);
    formData.append("add_page_numbers", options.add_page_numbers ? "true" : "false");
    formData.append("output_filename", options.output_filename);
    if (options.custom_output_dir) {
      formData.append("custom_output_dir", options.custom_output_dir);
    }

    const res = await safeFetch(`${API_BASE}/api/scanner/export-pdf`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "Document Scanner export failed");
  },

  getDownloadUrl(path: string, filename?: string): string {
    const params = new URLSearchParams({ path });
    if (filename) params.set("filename", filename);
    return `${API_BASE}/api/system/download?${params.toString()}`;
  },

  async downloadFile(path: string, filename?: string): Promise<void> {
    let resolvedFilename = filename?.trim() || "";
    if (!resolvedFilename && path) {
      const parts = path.split(/[/\\]/);
      resolvedFilename = parts[parts.length - 1] || "";
    }

    // Normalize .jpeg extension to .jpg
    if (resolvedFilename.toLowerCase().endsWith(".jpeg")) {
      resolvedFilename = resolvedFilename.slice(0, -5) + ".jpg";
    }

    // Ensure extension is present from path if filename is extensionless
    if (path && !resolvedFilename.includes(".")) {
      const match = path.match(/\.([a-zA-Z0-9]+)$/);
      if (match) {
        const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
        resolvedFilename = `${resolvedFilename}.${ext}`;
      }
    }

    const url = this.getDownloadUrl(path, resolvedFilename || undefined);

    // Modern browsers: Try File System Access API (showSaveFilePicker) to let user choose location
    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      try {
        const ext = resolvedFilename.includes(".") ? resolvedFilename.split(".").pop()?.toLowerCase() : "";
        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
          pdf: "application/pdf",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          zip: "application/zip",
          txt: "text/plain",
        };
        const mime = (ext && mimeTypes[ext]) ? mimeTypes[ext] : "application/octet-stream";

        const handle = await (window as any).showSaveFilePicker({
          suggestedName: resolvedFilename,
          types: ext ? [{
            description: `${ext.toUpperCase()} File`,
            accept: { [mime]: [`.${ext}`] }
          }] : []
        });

        const res = await safeFetch(url);
        if (!res.ok) throw new Error("Failed to fetch file content for download");
        const blob = await res.blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err: any) {
        if (err.name === "AbortError") {
          // User cancelled the file picker dialog
          return;
        }
        // Fallback to standard <a> download below
      }
    }

    const a = document.createElement("a");
    a.href = url;
    if (resolvedFilename) a.download = resolvedFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  async createZip(files: File[], zipName: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    formData.append("zip_name", zipName);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/archives/create-zip`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "ZIP creation failed");
  },

  async extractZip(file: File, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/archives/extract-zip`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "ZIP extraction failed");
  },

  async convertPdfToDocx(file: File, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/pdf-to-word/convert`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "PDF to Word conversion failed");
  },

  async ocrImageToText(file: File, language: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("language", language);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/ocr/image-to-text`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "Image OCR failed");
  },

  async ocrPdfToText(file: File, language: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("language", language);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/ocr/pdf-to-text`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "PDF OCR failed");
  },

  async ocrPdfToSearchablePdf(file: File, language: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("language", language);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/ocr/searchable-pdf`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "Searchable PDF OCR failed");
  },

  async ocrPdfToDocx(file: File, language: string, customOutputDir?: string): Promise<ConversionResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("language", language);
    if (customOutputDir) formData.append("custom_output_dir", customOutputDir);

    const res = await safeFetch(`${API_BASE}/api/ocr/pdf-to-docx`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<ConversionResult>(res, "PDF to DOCX OCR failed");
  },

  async getHistory(): Promise<{ history: HistoryItem[] }> {
    const res = await safeFetch(`${API_BASE}/api/history`);
    return handleResponse<{ history: HistoryItem[] }>(res, "Failed to load history");
  },

  async clearHistory(): Promise<{ success: boolean }> {
    const res = await safeFetch(`${API_BASE}/api/history`, { method: "DELETE" });
    return handleResponse<{ success: boolean }>(res, "Failed to clear history");
  },

  async deleteHistory(id: string): Promise<{ success: boolean }> {
    const res = await safeFetch(`${API_BASE}/api/history/${id}`, { method: "DELETE" });
    return handleResponse<{ success: boolean }>(res, "Failed to delete history item");
  },
};

export const downloadFile = (path: string, filename?: string) => api.downloadFile(path, filename);
