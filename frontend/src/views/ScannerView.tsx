import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera,
  UploadCloud,
  RotateCw,
  Crop,
  Trash2,
  MoveLeft,
  MoveRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  X,
  Sparkles,
  Settings2,
  Eye,
  SwitchCamera,
  RotateCcw,
  Wand2,
  Maximize2,
  FileCheck
} from "lucide-react";
import {
  api,
  type SystemStatus,
  type ConversionResult,
  type ScannerPageConfig,
  type ScannerExportOptions,
  type ScannerFilterType
} from "../api/client";
import { ResultCard } from "../components/ResultCard";

export interface ScannerPage {
  id: string;
  file: File | Blob;
  originalFilename: string;
  previewUrl: string;
  originalPreviewUrl: string;
  rotation: number; // 0, 90, 180, 270
  filterType: ScannerFilterType;
  cropQuad: number[] | null; // [tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y] in 0..1 normalized coords
  detectedCorners?: number[] | null;
  detectionConfidence?: number;
  isAutoDetected?: boolean;
  width: number;
  height: number;
}

interface ScannerViewProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
}

export const ScannerView: React.FC<ScannerViewProps> = ({
  systemStatus,
  onOpenFolder,
}) => {
  // Pages state
  const [pages, setPages] = useState<ScannerPage[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // PDF Export Settings
  const [paperSize, setPaperSize] = useState<"a4" | "letter" | "fit">("a4");
  const [pageFit, setPageFit] = useState<"fit" | "fill">("fit");
  const [orientation, setOrientation] = useState<"portrait" | "landscape" | "auto">("auto");
  const [margin, setMargin] = useState<"normal" | "narrow" | "none">("normal");
  const [quality, setQuality] = useState<"standard" | "high">("high");
  const [addPageNumbers, setAddPageNumbers] = useState<boolean>(false);
  const [outputFilename, setOutputFilename] = useState<string>("scanned_document.pdf");
  const [customOutputDir, setCustomOutputDir] = useState<string>(
    systemStatus?.paths?.default_output_dir || ""
  );

  // Process & UI state
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [previewZoomPage, setPreviewZoomPage] = useState<ScannerPage | null>(null);

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------
  // Camera Modal State & Handlers
  // -------------------------------------------------------------
  const [showCameraModal, setShowCameraModal] = useState<boolean>(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [cameraFacingMode, setCameraFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);
  const [sessionCapturedCount, setSessionCapturedCount] = useState<number>(0);
  const [isShutterFlashing, setIsShutterFlashing] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopActiveStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startCamera = async (deviceId?: string, facing?: "environment" | "user") => {
    stopActiveStream();
    setCameraError(null);
    setIsCameraLoading(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera access is not supported by your browser or current connection.");
      setIsCameraLoading(false);
      return;
    }

    try {
      const mode = facing || cameraFacingMode;
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : {
              facingMode: { ideal: mode },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Enumerate available camera devices
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevs = devices.filter((d) => d.kind === "videoinput");
        setCameraDevices(videoDevs);
        if (!deviceId && videoDevs.length > 0) {
          const activeTrack = stream.getVideoTracks()[0];
          const settings = activeTrack.getSettings ? activeTrack.getSettings() : null;
          if (settings && settings.deviceId) {
            setSelectedDeviceId(settings.deviceId);
          }
        }
      } catch {
        // ignore enumeration errors
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setCameraError("Camera permission was denied. Please allow camera access in your browser settings to scan documents.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setCameraError("No connected camera was found on your device.");
      } else {
        setCameraError(`Unable to start camera: ${err.message || "Unknown hardware error"}`);
      }
    } finally {
      setIsCameraLoading(false);
    }
  };

  const openCameraModal = () => {
    setShowCameraModal(true);
    setSessionCapturedCount(0);
    startCamera();
  };

  const closeCameraModal = () => {
    stopActiveStream();
    setShowCameraModal(false);
  };

  const toggleCameraFacingMode = () => {
    const nextMode = cameraFacingMode === "environment" ? "user" : "environment";
    setCameraFacingMode(nextMode);
    setSelectedDeviceId("");
    startCamera(undefined, nextMode);
  };

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    startCamera(deviceId);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    // Trigger visual flash animation
    setIsShutterFlashing(true);
    setTimeout(() => setIsShutterFlashing(false), 200);

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const pageId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const localPreviewUrl = URL.createObjectURL(blob);
        const fileName = `Camera_Scan_${pages.length + sessionCapturedCount + 1}.jpg`;
        const fileObj = new File([blob], fileName, { type: "image/jpeg" });

        try {
          const previewData = await api.previewScannerFile(fileObj);
          const hasDetected = Boolean(
            previewData.detected_corners &&
            previewData.detected_corners.length === 8 &&
            (previewData.detection_confidence || 0) >= 0.25
          );

          const newPage: ScannerPage = {
            id: pageId,
            file: blob,
            originalFilename: fileName,
            previewUrl: previewData.thumbnail || localPreviewUrl,
            originalPreviewUrl: previewData.original_thumbnail || localPreviewUrl,
            rotation: 0,
            filterType: "magic_color",
            cropQuad: hasDetected ? previewData.detected_corners! : null,
            detectedCorners: previewData.detected_corners || null,
            detectionConfidence: previewData.detection_confidence,
            isAutoDetected: hasDetected,
            width: previewData.width || canvas.width,
            height: previewData.height || canvas.height
          };

          setPages((prev) => [...prev, newPage]);
        } catch {
          const newPage: ScannerPage = {
            id: pageId,
            file: blob,
            originalFilename: fileName,
            previewUrl: localPreviewUrl,
            originalPreviewUrl: localPreviewUrl,
            rotation: 0,
            filterType: "magic_color",
            cropQuad: null,
            width: canvas.width,
            height: canvas.height
          };
          setPages((prev) => [...prev, newPage]);
        }

        setSessionCapturedCount((prev) => prev + 1);
        setResult(null);
      },
      "image/jpeg",
      0.95
    );
  };

  // Ensure camera streams are stopped when component unmounts
  useEffect(() => {
    return () => {
      stopActiveStream();
    };
  }, []);

  // -------------------------------------------------------------
  // File Upload Handlers (Gallery)
  // -------------------------------------------------------------
  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (!filesArray.length) return;

    setErrorMsg(null);
    setResult(null);

    const supportedExts = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".bmp", ".tiff", ".tif"];
    const invalidFiles: string[] = [];
    const validFiles: File[] = [];

    filesArray.forEach((f) => {
      const ext = "." + (f.name.split(".").pop() || "").toLowerCase();
      if (supportedExts.includes(ext)) {
        validFiles.push(f);
      } else {
        invalidFiles.push(f.name);
      }
    });

    if (invalidFiles.length > 0) {
      setErrorMsg(`Skipped ${invalidFiles.length} unsupported file(s): ${invalidFiles.slice(0, 3).join(", ")}${invalidFiles.length > 3 ? "..." : ""}. Please select JPG, PNG, WebP, or HEIC images.`);
    }

    if (!validFiles.length) return;

    const newPages: ScannerPage[] = [];

    for (const file of validFiles) {
      const pageId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      try {
        const previewData = await api.previewScannerFile(file);
        const hasDetected = Boolean(
          previewData.detected_corners &&
          previewData.detected_corners.length === 8 &&
          (previewData.detection_confidence || 0) >= 0.25
        );

        newPages.push({
          id: pageId,
          file,
          originalFilename: file.name,
          previewUrl: previewData.thumbnail,
          originalPreviewUrl: previewData.original_thumbnail || previewData.thumbnail,
          rotation: 0,
          filterType: "magic_color",
          cropQuad: hasDetected ? previewData.detected_corners! : null,
          detectedCorners: previewData.detected_corners || null,
          detectionConfidence: previewData.detection_confidence,
          isAutoDetected: hasDetected,
          width: previewData.width,
          height: previewData.height
        });
      } catch (err: any) {
        setErrorMsg(`Failed to process image '${file.name}': ${err.message}`);
      }
    }

    setPages((prev) => [...prev, ...newPages]);
  };

  // -------------------------------------------------------------
  // Page Management (Rotate, Delete, Reorder, Filters)
  // -------------------------------------------------------------
  const rotatePage = async (index: number, degrees: number) => {
    const page = pages[index];
    if (!page) return;

    const newRot = (page.rotation + degrees + 360) % 360;

    setPages((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], rotation: newRot };
      return copy;
    });

    try {
      const res = await api.processScannerPreview(
        page.file,
        newRot,
        page.cropQuad,
        page.filterType
      );
      setPages((prev) => {
        const copy = [...prev];
        copy[index] = { ...copy[index], previewUrl: res.thumbnail };
        return copy;
      });
    } catch {
      // ignore
    }
  };

  const rotateAllPages = () => {
    setPages((prev) =>
      prev.map((p) => ({
        ...p,
        rotation: (p.rotation + 90) % 360
      }))
    );
  };

  const removePage = (index: number) => {
    setPages((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed && removed.previewUrl.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(removed.previewUrl);
        } catch {
          // ignore
        }
      }
      return copy;
    });
  };

  const movePage = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= pages.length) return;
    setPages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, item);
      return copy;
    });
  };

  const setPageFilter = async (index: number, filterType: ScannerFilterType) => {
    const page = pages[index];
    if (!page) return;

    setPages((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], filterType };
      return copy;
    });

    try {
      const res = await api.processScannerPreview(
        page.file,
        page.rotation,
        page.cropQuad,
        filterType
      );
      setPages((prev) => {
        const copy = [...prev];
        copy[index] = { ...copy[index], previewUrl: res.thumbnail };
        return copy;
      });
    } catch {
      // ignore
    }
  };

  const applyFilterToAll = async (filterType: ScannerFilterType) => {
    setPages((prev) =>
      prev.map((p) => ({
        ...p,
        filterType
      }))
    );

    // Refresh thumbnails for all pages
    pages.forEach(async (p, idx) => {
      try {
        const res = await api.processScannerPreview(
          p.file,
          p.rotation,
          p.cropQuad,
          filterType
        );
        setPages((prev) => {
          const copy = [...prev];
          if (copy[idx]) {
            copy[idx] = { ...copy[idx], previewUrl: res.thumbnail };
          }
          return copy;
        });
      } catch {
        // ignore
      }
    });
  };

  const resetPageEdits = (index: number) => {
    setPages((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        cropQuad: null,
        rotation: 0,
        filterType: "original",
        isAutoDetected: false,
        previewUrl: copy[index].originalPreviewUrl
      };
      return copy;
    });
  };

  const clearAllPages = () => {
    pages.forEach((p) => {
      if (p.previewUrl.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(p.previewUrl);
        } catch {
          // ignore
        }
      }
    });
    setPages([]);
    setShowClearConfirm(false);
    setResult(null);
  };

  // Drag and drop reordering
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      movePage(draggedIndex, index);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // -------------------------------------------------------------
  // Interactive Crop & Perspective Modal State & Logic
  // -------------------------------------------------------------
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
  const [cropCorners, setCropCorners] = useState<{
    tl: [number, number];
    tr: [number, number];
    br: [number, number];
    bl: [number, number];
  }>({
    tl: [0.05, 0.05],
    tr: [0.95, 0.05],
    br: [0.95, 0.95],
    bl: [0.05, 0.95]
  });
  const [activeCornerDrag, setActiveCornerDrag] = useState<"tl" | "tr" | "br" | "bl" | null>(null);
  const [showWarpPreview, setShowWarpPreview] = useState<boolean>(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState<boolean>(false);
  const [detectionNotice, setDetectionNotice] = useState<string | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 600, height: 800 });

  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const warpPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const openCropModal = (index: number) => {
    const page = pages[index];
    if (!page) return;
    setEditingPageIndex(index);
    setShowWarpPreview(false);
    setDetectionNotice(null);

    if (page.cropQuad && page.cropQuad.length === 8) {
      setCropCorners({
        tl: [page.cropQuad[0], page.cropQuad[1]],
        tr: [page.cropQuad[2], page.cropQuad[3]],
        br: [page.cropQuad[4], page.cropQuad[5]],
        bl: [page.cropQuad[6], page.cropQuad[7]]
      });
      if (page.isAutoDetected) {
        setDetectionNotice("Document boundary automatically detected. Adjust corner pins if needed.");
      }
    } else if (page.detectedCorners && page.detectedCorners.length === 8) {
      setCropCorners({
        tl: [page.detectedCorners[0], page.detectedCorners[1]],
        tr: [page.detectedCorners[2], page.detectedCorners[3]],
        br: [page.detectedCorners[4], page.detectedCorners[5]],
        bl: [page.detectedCorners[6], page.detectedCorners[7]]
      });
      setDetectionNotice("Document boundary automatically detected. Adjust corner pins if needed.");
    } else {
      // Default 5% margin corners
      setCropCorners({
        tl: [0.05, 0.05],
        tr: [0.95, 0.05],
        br: [0.95, 0.95],
        bl: [0.05, 0.95]
      });
    }
  };

  const closeCropModal = () => {
    setEditingPageIndex(null);
    setActiveCornerDrag(null);
    setDetectionNotice(null);
  };

  const resetCropToFull = () => {
    setCropCorners({
      tl: [0.0, 0.0],
      tr: [1.0, 0.0],
      br: [1.0, 1.0],
      bl: [0.0, 1.0]
    });
    setDetectionNotice("Corners expanded to full photograph boundary.");
  };

  const resetCornersToDefault = () => {
    if (editingPageIndex === null) return;
    const page = pages[editingPageIndex];
    if (page?.detectedCorners && page.detectedCorners.length === 8) {
      setCropCorners({
        tl: [page.detectedCorners[0], page.detectedCorners[1]],
        tr: [page.detectedCorners[2], page.detectedCorners[3]],
        br: [page.detectedCorners[4], page.detectedCorners[5]],
        bl: [page.detectedCorners[6], page.detectedCorners[7]]
      });
      setDetectionNotice("Restored auto-detected document corners.");
    } else {
      setCropCorners({
        tl: [0.05, 0.05],
        tr: [0.95, 0.05],
        br: [0.95, 0.95],
        bl: [0.05, 0.95]
      });
      setDetectionNotice("Corners reset to standard margins.");
    }
  };

  const triggerAutoDetectInModal = async () => {
    if (editingPageIndex === null) return;
    const page = pages[editingPageIndex];
    if (!page) return;

    setIsAutoDetecting(true);
    setDetectionNotice(null);

    try {
      const res = await api.detectScannerCorners(page.file);
      if (res.success && res.detected && res.corners && res.corners.length === 8) {
        setCropCorners({
          tl: [res.corners[0], res.corners[1]],
          tr: [res.corners[2], res.corners[3]],
          br: [res.corners[4], res.corners[5]],
          bl: [res.corners[6], res.corners[7]]
        });
        const confPct = Math.round(res.confidence * 100);
        setDetectionNotice(`Document boundary detected successfully (${confPct}% confidence).`);
      } else {
        setDetectionNotice("No distinct paper boundary detected. Position the 4 corner pins manually or use Full Page.");
      }
    } catch (err: any) {
      setDetectionNotice(`Auto-detection failed: ${err.message || "Unknown error"}. Use manual corner selection.`);
    } finally {
      setIsAutoDetecting(false);
    }
  };

  // Draw the interactive canvas
  const drawCropCanvas = useCallback(() => {
    const canvas = cropCanvasRef.current;
    const img = cropImageRef.current;
    if (!canvas || !img || !img.complete) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;

    // Track display size for the magnifying loupe
    if (canvas.clientWidth && canvas.clientHeight) {
      setCanvasDimensions({ width: canvas.clientWidth, height: canvas.clientHeight });
    }

    ctx.clearRect(0, 0, cw, ch);

    // Draw background document image
    ctx.drawImage(img, 0, 0, cw, ch);

    // Pixel coordinates of 4 corners
    const tl = [cropCorners.tl[0] * cw, cropCorners.tl[1] * ch];
    const tr = [cropCorners.tr[0] * cw, cropCorners.tr[1] * ch];
    const br = [cropCorners.br[0] * cw, cropCorners.br[1] * ch];
    const bl = [cropCorners.bl[0] * cw, cropCorners.bl[1] * ch];

    // Darkened semi-transparent overlay outside document quad
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    // Cut out inner quad
    ctx.moveTo(tl[0], tl[1]);
    ctx.lineTo(bl[0], bl[1]);
    ctx.lineTo(br[0], br[1]);
    ctx.lineTo(tr[0], tr[1]);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();

    // Quad boundary stroke
    ctx.save();
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2.5;
    ctx.shadowColor = "rgba(6, 182, 212, 0.8)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(tl[0], tl[1]);
    ctx.lineTo(tr[0], tr[1]);
    ctx.lineTo(br[0], br[1]);
    ctx.lineTo(bl[0], bl[1]);
    ctx.closePath();
    ctx.stroke();

    // Draw grid lines inside quad (3x3 document guide)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    for (let i = 1; i <= 2; i++) {
      const frac = i / 3;
      // Horizontal grid
      const leftX = tl[0] + (bl[0] - tl[0]) * frac;
      const leftY = tl[1] + (bl[1] - tl[1]) * frac;
      const rightX = tr[0] + (br[0] - tr[0]) * frac;
      const rightY = tr[1] + (br[1] - tr[1]) * frac;
      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.stroke();

      // Vertical grid
      const topX = tl[0] + (tr[0] - tl[0]) * frac;
      const topY = tl[1] + (tr[1] - tr[1]) * frac;
      const botX = bl[0] + (br[0] - bl[0]) * frac;
      const botY = bl[1] + (br[1] - botX) * frac;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(botX, botY);
      ctx.stroke();
    }

    // Draw corner handles
    const corners = [
      { key: "tl", pos: tl },
      { key: "tr", pos: tr },
      { key: "br", pos: br },
      { key: "bl", pos: bl }
    ];

    corners.forEach((c) => {
      const isDragging = activeCornerDrag === c.key;
      ctx.beginPath();
      ctx.arc(c.pos[0], c.pos[1], isDragging ? 20 : 15, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? "rgba(147, 51, 234, 0.45)" : "rgba(6, 182, 212, 0.35)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(c.pos[0], c.pos[1], isDragging ? 12 : 9, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#06b6d4";
      ctx.shadowBlur = 8;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(c.pos[0], c.pos[1], isDragging ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? "#9333ea" : "#0891b2";
      ctx.fill();
    });

    ctx.restore();
  }, [cropCorners, activeCornerDrag]);

  useEffect(() => {
    drawCropCanvas();
  }, [drawCropCanvas]);

  // Corner Drag Interaction: Unified Mouse & Touch Handlers
  const startCornerDrag = (clientX: number, clientY: number) => {
    const canvas = cropCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = x * scaleX;
    const clickY = y * scaleY;

    const cw = canvas.width;
    const ch = canvas.height;

    const corners = [
      { key: "tl" as const, x: cropCorners.tl[0] * cw, y: cropCorners.tl[1] * ch },
      { key: "tr" as const, x: cropCorners.tr[0] * cw, y: cropCorners.tr[1] * ch },
      { key: "br" as const, x: cropCorners.br[0] * cw, y: cropCorners.br[1] * ch },
      { key: "bl" as const, x: cropCorners.bl[0] * cw, y: cropCorners.bl[1] * ch }
    ];

    let nearest: "tl" | "tr" | "br" | "bl" | null = null;
    let minDist = 55;

    corners.forEach((c) => {
      const d = Math.hypot(clickX - c.x, clickY - c.y);
      if (d < minDist) {
        minDist = d;
        nearest = c.key;
      }
    });

    if (nearest) {
      setActiveCornerDrag(nearest);
    }
  };

  const updateCornerDrag = (clientX: number, clientY: number) => {
    if (!activeCornerDrag) return;
    const canvas = cropCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const normX = Math.max(0.0, Math.min(1.0, (clientX - rect.left) / rect.width));
    const normY = Math.max(0.0, Math.min(1.0, (clientY - rect.top) / rect.height));

    setCropCorners((prev) => ({
      ...prev,
      [activeCornerDrag]: [normX, normY]
    }));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    startCornerDrag(e.clientX, e.clientY);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    updateCornerDrag(e.clientX, e.clientY);
  };

  const handleCanvasMouseUp = () => {
    setActiveCornerDrag(null);
  };

  const handleCanvasTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      startCornerDrag(touch.clientX, touch.clientY);
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!activeCornerDrag) return;
    if (e.touches.length === 1) {
      if (e.cancelable) e.preventDefault();
      const touch = e.touches[0];
      updateCornerDrag(touch.clientX, touch.clientY);
    }
  };

  const handleCanvasTouchEnd = () => {
    setActiveCornerDrag(null);
  };

  // Render Real-Time Straightened Warp Preview Canvas
  useEffect(() => {
    if (!showWarpPreview) return;
    const warpCanvas = warpPreviewCanvasRef.current;
    const img = cropImageRef.current;
    if (!warpCanvas || !img || !img.complete) return;

    const ctx = warpCanvas.getContext("2d");
    if (!ctx) return;

    const cw = img.naturalWidth || 800;
    const ch = img.naturalHeight || 1000;

    const tlX = cropCorners.tl[0] * cw;
    const tlY = cropCorners.tl[1] * ch;
    const trX = cropCorners.tr[0] * cw;
    const trY = cropCorners.tr[1] * ch;
    const brX = cropCorners.br[0] * cw;
    const brY = cropCorners.br[1] * ch;
    const blX = cropCorners.bl[0] * cw;
    const blY = cropCorners.bl[1] * ch;

    const wTop = Math.hypot(trX - tlX, trY - tlY);
    const wBot = Math.hypot(brX - blX, brY - blY);
    const docW = Math.max(20, Math.max(wTop, wBot));

    const hLeft = Math.hypot(blX - tlX, blY - tlY);
    const hRight = Math.hypot(brX - trX, brY - trY);
    const docH = Math.max(20, Math.max(hLeft, hRight));

    const aspect = docW / docH;
    let outW = 340;
    let outH = Math.round(outW / aspect);
    if (outH > 440) {
      outH = 440;
      outW = Math.round(outH * aspect);
    }

    warpCanvas.width = outW;
    warpCanvas.height = outH;

    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = cw;
    sampleCanvas.height = ch;
    const sampleCtx = sampleCanvas.getContext("2d");
    if (!sampleCtx) return;
    sampleCtx.drawImage(img, 0, 0);

    const srcImgData = sampleCtx.getImageData(0, 0, cw, ch);
    const srcBuf = new Uint32Array(srcImgData.data.buffer);

    const dstImgData = ctx.createImageData(outW, outH);
    const dstBuf = new Uint32Array(dstImgData.data.buffer);

    for (let y = 0; y < outH; y++) {
      const v = y / Math.max(1, outH - 1);
      const leftX = tlX + (blX - tlX) * v;
      const leftY = tlY + (blY - tlY) * v;
      const rightX = trX + (brX - trX) * v;
      const rightY = trY + (brY - trY) * v;

      for (let x = 0; x < outW; x++) {
        const u = x / Math.max(1, outW - 1);
        const sampleX = Math.round(leftX + (rightX - leftX) * u);
        const sampleY = Math.round(leftY + (rightY - leftY) * u);

        if (sampleX >= 0 && sampleX < cw && sampleY >= 0 && sampleY < ch) {
          dstBuf[y * outW + x] = srcBuf[sampleY * cw + sampleX];
        } else {
          dstBuf[y * outW + x] = 0xffffffff;
        }
      }
    }

    ctx.putImageData(dstImgData, 0, 0);
  }, [showWarpPreview, cropCorners]);

  const applyCropEdits = async () => {
    if (editingPageIndex === null) return;
    const quad = [
      cropCorners.tl[0], cropCorners.tl[1],
      cropCorners.tr[0], cropCorners.tr[1],
      cropCorners.br[0], cropCorners.br[1],
      cropCorners.bl[0], cropCorners.bl[1]
    ];

    const idx = editingPageIndex;
    const currentPage = pages[idx];
    closeCropModal();

    if (!currentPage) return;

    try {
      const res = await api.processScannerPreview(
        currentPage.file,
        currentPage.rotation,
        quad,
        currentPage.filterType
      );
      setPages((prev) => {
        const copy = [...prev];
        if (copy[idx]) {
          copy[idx] = {
            ...copy[idx],
            cropQuad: quad,
            previewUrl: res.thumbnail
          };
        }
        return copy;
      });
    } catch {
      setPages((prev) => {
        const copy = [...prev];
        if (copy[idx]) {
          copy[idx] = {
            ...copy[idx],
            cropQuad: quad
          };
        }
        return copy;
      });
    }
  };

  // -------------------------------------------------------------
  // Final PDF Export Flow
  // -------------------------------------------------------------
  const handleExportPdf = async () => {
    if (!pages.length) {
      setErrorMsg("Please scan or upload at least one page before exporting.");
      return;
    }

    setIsExporting(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const filesToSend = pages.map((p) => p.file);
      const pagesConfig: ScannerPageConfig[] = pages.map((p) => ({
        rotation: p.rotation,
        filter_type: p.filterType,
        crop_quad: p.cropQuad
      }));

      const exportOptions: ScannerExportOptions = {
        paper_size: paperSize,
        page_fit: pageFit,
        orientation,
        margin,
        quality,
        add_page_numbers: addPageNumbers,
        output_filename: outputFilename.trim() || "scanned_document.pdf",
        custom_output_dir: customOutputDir.trim() || undefined
      };

      const res = await api.exportScannedPdf(filesToSend, pagesConfig, exportOptions);
      setResult(res);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to generate scanned PDF. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* Top Banner / Hero */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-[#171a2b] via-[#141624] to-[#12131f] border border-[#262a42]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                Document Scanner → PDF
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold tracking-wide">
                  CAMSCANNER MODE
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                Automatic paper boundary detection, genuine 4-point homography perspective straightening, shadow removal, and professional PDF export.
              </p>
            </div>
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={openCameraModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs shadow-lg shadow-cyan-900/30 transition hover:scale-[1.02] active:scale-[0.98]"
          >
            <Camera className="w-4 h-4" />
            <span>Scan with Camera</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#202438] hover:bg-[#282d47] border border-[#333959] text-gray-200 font-medium text-xs transition hover:scale-[1.02] active:scale-[0.98]"
          >
            <UploadCloud className="w-4 h-4 text-cyan-400" />
            <span>Upload Images</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,image/bmp,image/tiff"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleUploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="p-1 hover:text-white transition">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Result Card when PDF has been generated */}
      {result && (
        <div className="space-y-4">
          <ResultCard result={result} onOpenExplorer={onOpenFolder} />
        </div>
      )}

      {/* Empty State / Dropzone when no pages are uploaded yet */}
      {pages.length === 0 && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) handleUploadFiles(e.dataTransfer.files);
          }}
          className="border-2 border-dashed border-[#262a42] hover:border-cyan-500/50 rounded-2xl p-12 text-center bg-[#111320]/60 transition group flex flex-col items-center justify-center space-y-4 cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-16 h-16 rounded-2xl bg-cyan-600/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition duration-300">
            <Camera className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-sm text-gray-200">
              No document pages added yet
            </h3>
            <p className="text-xs text-gray-400 max-w-sm">
              Use your device camera to take photos of documents, or drag and drop images here (JPG, PNG, WebP, HEIC).
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium pt-2">
            <Wand2 className="w-3.5 h-3.5" />
            <span>Automatic edge detection, perspective homography, and shadow removal</span>
          </div>
        </div>
      )}

      {/* Page Gallery and Management Section */}
      {pages.length > 0 && (
        <div className="space-y-4">
          {/* Gallery Header Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[#131522] border border-[#22263d]">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold text-gray-200">
                Document Pages ({pages.length})
              </span>
              <span className="text-[11px] text-gray-500">|</span>
              <span className="text-[11px] text-gray-400">
                Drag cards to reorder resulting PDF pages
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={rotateAllPages}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1c1f30] hover:bg-[#252940] text-gray-300 text-xs transition"
                title="Rotate all pages 90 degrees clockwise"
              >
                <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                <span>Rotate All</span>
              </button>

              <button
                onClick={() => applyFilterToAll("magic_color")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1c1f30] hover:bg-[#252940] text-gray-300 text-xs transition"
                title="Apply Magic Color shadow-removal filter to all pages"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Magic Color All</span>
              </button>

              <button
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-950/60 border border-rose-800/40 text-rose-300 text-xs transition"
                title="Clear all pages"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>
          </div>

          {/* Thumbnails Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {pages.map((page, idx) => (
              <div
                key={page.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                className={`relative group flex flex-col rounded-xl bg-[#141624] border transition duration-200 overflow-hidden ${
                  dragOverIndex === idx
                    ? "border-cyan-400 ring-2 ring-cyan-500/30 scale-[1.02]"
                    : "border-[#252942] hover:border-[#3b4269]"
                }`}
              >
                {/* Page Number & Badges */}
                <div className="flex items-center justify-between p-2.5 bg-[#10121d] border-b border-[#1e2238] text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-md bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center font-bold text-[10px]">
                      {idx + 1}
                    </span>
                    <span className="text-gray-300 font-medium text-[11px] truncate max-w-[110px]" title={page.originalFilename}>
                      {page.originalFilename}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {page.cropQuad && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                        {page.isAutoDetected ? <Wand2 className="w-2.5 h-2.5 text-blue-400" /> : null}
                        <span>{page.isAutoDetected ? "Auto-Cropped" : "Cropped"}</span>
                      </span>
                    )}
                    {page.rotation > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                        {page.rotation}°
                      </span>
                    )}
                  </div>
                </div>

                {/* Thumbnail Display showing real processed image */}
                <div
                  className="relative h-56 bg-[#0c0d15] flex items-center justify-center p-2 cursor-pointer overflow-hidden"
                  onClick={() => setPreviewZoomPage(page)}
                  title="Click to zoom preview"
                >
                  <img
                    src={page.previewUrl}
                    alt={`Page ${idx + 1}`}
                    className="max-h-full max-w-full object-contain rounded shadow transition duration-200"
                  />

                  {/* Hover Overlay Button to View Large */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition duration-150 backdrop-blur-[1px]">
                    <div className="px-2.5 py-1.5 rounded-lg bg-black/70 text-white text-[11px] flex items-center gap-1.5 shadow">
                      <Eye className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Zoom Preview</span>
                    </div>
                  </div>
                </div>

                {/* Per-Page Filter Switcher */}
                <div className="px-2 py-1.5 bg-[#0f111c] border-t border-[#1e2238] flex items-center justify-between text-[10px]">
                  <span className="text-gray-400">Filter:</span>
                  <div className="flex items-center gap-0.5">
                    {[
                      { key: "original", label: "Orig" },
                      { key: "magic_color", label: "Magic" },
                      { key: "auto_enhance", label: "Auto" },
                      { key: "grayscale", label: "Gray" },
                      { key: "black_white", label: "B&W" }
                    ].map((f) => (
                      <button
                        key={f.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPageFilter(idx, f.key as ScannerFilterType);
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] transition ${
                          page.filterType === f.key
                            ? "bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 font-semibold"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Bottom Actions Bar */}
                <div className="flex items-center justify-between p-2 bg-[#121422] border-t border-[#1e2238]">
                  {/* Left: Reorder buttons */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => movePage(idx, idx - 1)}
                      disabled={idx === 0}
                      className="p-1 rounded text-gray-400 hover:text-cyan-300 hover:bg-[#1f2338] disabled:opacity-30 disabled:pointer-events-none transition"
                      title="Move left"
                    >
                      <MoveLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => movePage(idx, idx + 1)}
                      disabled={idx === pages.length - 1}
                      className="p-1 rounded text-gray-400 hover:text-cyan-300 hover:bg-[#1f2338] disabled:opacity-30 disabled:pointer-events-none transition"
                      title="Move right"
                    >
                      <MoveRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Center: Rotate & Crop Edit */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => rotatePage(idx, 90)}
                      className="p-1 rounded text-gray-300 hover:text-cyan-400 hover:bg-[#1f2338] transition"
                      title="Rotate 90 degrees clockwise"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => openCropModal(idx)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-[11px] font-medium transition"
                      title="Crop & straighten perspective"
                    >
                      <Crop className="w-3 h-3" />
                      <span>Crop</span>
                    </button>

                    {(page.cropQuad || page.rotation > 0 || page.filterType !== "original") && (
                      <button
                        onClick={() => resetPageEdits(idx)}
                        className="p-1 rounded text-gray-400 hover:text-amber-300 hover:bg-[#1f2338] transition"
                        title="Reset page edits"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Right: Delete Page */}
                  <button
                    onClick={() => removePage(idx)}
                    className="p-1 rounded text-rose-400 hover:text-rose-200 hover:bg-rose-950/40 transition"
                    title="Remove page"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* PDF Settings & Export Box */}
          <div className="p-6 rounded-2xl bg-[#131522] border border-[#22263d] space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#22263d]">
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-cyan-400" />
                <h3 className="font-semibold text-sm text-gray-200">PDF Document Layout & Print Settings</h3>
              </div>
              <span className="text-xs text-gray-400">{pages.length} page(s) ready</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
              {/* Paper Size */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Paper Format</label>
                <select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-[#1a1d2e] border border-[#2d3252] text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="a4">A4 (Standard Document)</option>
                  <option value="letter">US Letter</option>
                  <option value="fit">Fit to Document Dimensions</option>
                </select>
              </div>

              {/* Page Fit Mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Page Fitting</label>
                <select
                  value={pageFit}
                  onChange={(e) => setPageFit(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-[#1a1d2e] border border-[#2d3252] text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="fit">Fit Document (Preserve Entire Page)</option>
                  <option value="fill">Fill Page (Borderless Bleed, Trim Margins)</option>
                </select>
              </div>

              {/* Orientation */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Orientation</label>
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-[#1a1d2e] border border-[#2d3252] text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="auto">Auto (Adapts to Document)</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>

              {/* Margins */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Margins</label>
                <select
                  value={margin}
                  onChange={(e) => setMargin(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-[#1a1d2e] border border-[#2d3252] text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="normal">Normal (24 pt)</option>
                  <option value="narrow">Narrow (12 pt)</option>
                  <option value="none">None (0 pt - Borderless)</option>
                </select>
              </div>

              {/* Image Quality */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Image Quality</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-[#1a1d2e] border border-[#2d3252] text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="high">High (Maximum Text & Notes Fidelity)</option>
                  <option value="standard">Standard (Compact)</option>
                </select>
              </div>
            </div>

            {/* Explanatory helper for Page Fit */}
            {pageFit === "fill" && (
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>
                  <strong>Fill Page:</strong> Document is scaled proportionally to cover the full page with zero letterboxing margins. Slight excess edge margins may be trimmed if the document aspect ratio differs slightly from standard paper.
                </span>
              </div>
            )}

            {/* Additional Options: Page Numbers & Filename & Custom Output Dir */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Output PDF Filename</label>
                <input
                  type="text"
                  value={outputFilename}
                  onChange={(e) => setOutputFilename(e.target.value)}
                  placeholder="scanned_document.pdf"
                  className="w-full px-3 py-2 rounded-xl bg-[#1a1d2e] border border-[#2d3252] text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-300">Custom Output Folder (Optional)</label>
                <input
                  type="text"
                  value={customOutputDir}
                  onChange={(e) => setCustomOutputDir(e.target.value)}
                  placeholder="Default Downloads folder"
                  className="w-full px-3 py-2 rounded-xl bg-[#1a1d2e] border border-[#2d3252] text-xs text-gray-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center h-full pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 select-none">
                  <input
                    type="checkbox"
                    checked={addPageNumbers}
                    onChange={(e) => setAddPageNumbers(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#1a1d2e] border-[#2d3252] text-cyan-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <span>Add page numbers footer ("Page X of Y")</span>
                </label>
              </div>
            </div>

            {/* Export Trigger */}
            <div className="pt-3 flex justify-end">
              <button
                onClick={handleExportPdf}
                disabled={isExporting || pages.length === 0}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold text-xs shadow-xl shadow-cyan-950/40 disabled:opacity-40 disabled:pointer-events-none transition hover:scale-[1.02] active:scale-[0.98]"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Compiling PDF Document...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Generate Scanned PDF ({pages.length} Pages)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* CAMERA CAPTURE MODAL */}
      {/* ------------------------------------------------------------- */}
      {showCameraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-2xl bg-[#121422] border border-[#262b45] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#22263d] bg-[#161828]">
              <div className="flex items-center gap-2.5">
                <Camera className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="font-semibold text-sm text-gray-100">Document Camera Viewfinder</h3>
                  <p className="text-[11px] text-gray-400">Position page inside the frame and snap photo</p>
                </div>
              </div>
              <button
                onClick={closeCameraModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-[#202438] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Viewport Area */}
            <div className="relative flex-1 bg-black min-h-[360px] flex items-center justify-center overflow-hidden">
              {cameraError ? (
                <div className="p-6 text-center space-y-3 max-w-sm">
                  <div className="w-12 h-12 mx-auto rounded-full bg-rose-950/40 border border-rose-800/60 flex items-center justify-center text-rose-400">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <h4 className="font-semibold text-sm text-rose-300">Camera Unavailable</h4>
                  <p className="text-xs text-gray-400">{cameraError}</p>
                  <button
                    onClick={() => startCamera()}
                    className="px-4 py-2 rounded-xl bg-[#1f2338] hover:bg-[#2a2f4c] text-xs text-gray-200 transition"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <>
                  {isCameraLoading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                      <span className="text-xs text-gray-300">Initializing camera feed...</span>
                    </div>
                  )}

                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />

                  {/* Shutter flash effect */}
                  {isShutterFlashing && (
                    <div className="absolute inset-0 bg-white z-20 animate-out fade-out duration-200 pointer-events-none" />
                  )}

                  {/* Document Grid Alignment Overlay */}
                  <div className="absolute inset-6 border border-white/20 rounded-xl pointer-events-none flex flex-col justify-between p-4">
                    <div className="flex justify-between">
                      <div className="w-6 h-6 border-t-2 border-l-2 border-cyan-400" />
                      <div className="w-6 h-6 border-t-2 border-r-2 border-cyan-400" />
                    </div>
                    <div className="flex justify-between">
                      <div className="w-6 h-6 border-b-2 border-l-2 border-cyan-400" />
                      <div className="w-6 h-6 border-b-2 border-r-2 border-cyan-400" />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bottom Camera Toolbar */}
            <div className="px-5 py-4 bg-[#141626] border-t border-[#22263d] flex items-center justify-between gap-4">
              {/* Device Selector / Flip */}
              <div className="flex items-center gap-2">
                {cameraDevices.length > 1 ? (
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => handleDeviceChange(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#1e2236] border border-[#2f3554] text-xs text-gray-300 focus:outline-none"
                  >
                    {cameraDevices.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    onClick={toggleCameraFacingMode}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e2236] hover:bg-[#272c44] text-xs text-gray-300 transition"
                    title="Flip camera"
                  >
                    <SwitchCamera className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Flip</span>
                  </button>
                )}

                {sessionCapturedCount > 0 && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/40 text-cyan-300">
                    {sessionCapturedCount} captured
                  </span>
                )}
              </div>

              {/* Shutter Button */}
              <button
                onClick={capturePhoto}
                disabled={Boolean(cameraError) || isCameraLoading}
                className="w-14 h-14 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 p-1 shadow-lg shadow-cyan-900/50 flex items-center justify-center transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                title="Capture Document Page"
              >
                <div className="w-full h-full rounded-full border-2 border-white/80 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-white" />
                </div>
              </button>

              {/* Done Button */}
              <button
                onClick={closeCameraModal}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow transition"
              >
                Done ({pages.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* INTERACTIVE CROP & PERSPECTIVE MODAL (CAMSCANNER STYLE) */}
      {/* ------------------------------------------------------------- */}
      {editingPageIndex !== null && pages[editingPageIndex] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-4xl rounded-2xl bg-[#121422] border border-[#262b45] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#22263d] bg-[#161828]">
              <div className="flex items-center gap-2.5">
                <Crop className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="font-semibold text-sm text-gray-100 flex items-center gap-2">
                    Crop & Perspective Correction (Page {editingPageIndex + 1})
                    {pages[editingPageIndex].isAutoDetected && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 font-medium">
                        <Wand2 className="w-2.5 h-2.5" />
                        <span>Auto-Detected</span>
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-gray-400">
                    Drag the 4 corner pins to match the sheet boundary. Works with mouse or touchscreen.
                  </p>
                </div>
              </div>
              <button
                onClick={closeCropModal}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-[#202438] transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Notification / Detection Feedback Banner */}
            {detectionNotice && (
              <div className="px-5 py-2 bg-cyan-950/40 border-b border-cyan-800/40 text-cyan-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{detectionNotice}</span>
                </div>
                <button
                  onClick={() => setDetectionNotice(null)}
                  className="p-0.5 hover:text-white transition"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Hidden Source Image (uses originalPreviewUrl for pristine crop adjustment) */}
            <img
              ref={cropImageRef}
              src={pages[editingPageIndex].originalPreviewUrl || pages[editingPageIndex].previewUrl}
              alt="Source for crop"
              className="hidden"
              onLoad={drawCropCanvas}
            />

            {/* Main Interactive Canvas Area */}
            <div className="relative flex-1 bg-[#0b0c14] p-4 flex items-center justify-center overflow-hidden min-h-[420px]">
              {showWarpPreview ? (
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="flex items-center gap-2 text-xs text-cyan-300 font-medium">
                    <FileCheck className="w-4 h-4 text-cyan-400" />
                    <span>Straightened Perspective Preview</span>
                  </div>
                  <div className="p-2 rounded-xl bg-[#141624] border border-[#2b304c] shadow-2xl">
                    <canvas ref={warpPreviewCanvasRef} className="rounded max-h-[380px] object-contain shadow" />
                  </div>
                </div>
              ) : (
                <div className="relative max-h-full max-w-full flex items-center justify-center">
                  <canvas
                    ref={cropCanvasRef}
                    width={pages[editingPageIndex].width || 800}
                    height={pages[editingPageIndex].height || 1000}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                    onTouchStart={handleCanvasTouchStart}
                    onTouchMove={handleCanvasTouchMove}
                    onTouchEnd={handleCanvasTouchEnd}
                    onTouchCancel={handleCanvasTouchEnd}
                    className="max-h-[500px] max-w-full rounded-lg shadow-2xl cursor-crosshair select-none touch-none"
                    style={{ maxHeight: "calc(80vh - 180px)", touchAction: "none" }}
                  />

                  {/* Magnifying Loupe Near Active Drag Corner */}
                  {activeCornerDrag && (
                    <div
                      className="absolute pointer-events-none z-30 w-28 h-28 rounded-full border-2 border-cyan-400 shadow-2xl overflow-hidden bg-black/90 flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
                      style={{
                        left: Math.max(70, Math.min(canvasDimensions.width - 70, (cropCorners[activeCornerDrag][0] * canvasDimensions.width))),
                        top: Math.max(70, (cropCorners[activeCornerDrag][1] * canvasDimensions.height) - 85)
                      }}
                    >
                      <div
                        className="w-full h-full"
                        style={{
                          backgroundImage: `url(${pages[editingPageIndex].originalPreviewUrl || pages[editingPageIndex].previewUrl})`,
                          backgroundSize: `${canvasDimensions.width * 2.5}px ${canvasDimensions.height * 2.5}px`,
                          backgroundPosition: `${-cropCorners[activeCornerDrag][0] * canvasDimensions.width * 2.5 + 56}px ${-cropCorners[activeCornerDrag][1] * canvasDimensions.height * 2.5 + 56}px`,
                          backgroundRepeat: "no-repeat"
                        }}
                      />
                      <div className="absolute w-2.5 h-2.5 rounded-full border border-cyan-400/80 bg-cyan-400/20" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="px-5 py-3.5 bg-[#141626] border-t border-[#22263d] flex flex-wrap items-center justify-between gap-3">
              {/* Presets & Auto Detect */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={triggerAutoDetectInModal}
                  disabled={isAutoDetecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition disabled:opacity-50"
                  title="Detect document paper boundary with computer vision"
                >
                  {isAutoDetecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="w-3.5 h-3.5" />
                  )}
                  <span>Auto Detect</span>
                </button>

                <button
                  onClick={resetCropToFull}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e2236] hover:bg-[#272c44] text-xs text-gray-300 transition"
                  title="Expand crop to full photograph"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-gray-400" />
                  <span>Full Page</span>
                </button>

                <button
                  onClick={resetCornersToDefault}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e2236] hover:bg-[#272c44] text-xs text-gray-300 transition"
                  title="Reset corners"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                  <span>Reset</span>
                </button>

                <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer pl-2">
                  <input
                    type="checkbox"
                    checked={showWarpPreview}
                    onChange={(e) => setShowWarpPreview(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-[#1e2236] border-[#2f3554] text-cyan-500"
                  />
                  <span>Straighten Preview</span>
                </label>
              </div>

              {/* Apply / Cancel */}
              <div className="flex items-center gap-2">
                <button
                  onClick={closeCropModal}
                  className="px-4 py-2 rounded-xl bg-[#1e2236] hover:bg-[#282d47] text-gray-300 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  onClick={applyCropEdits}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs shadow-lg shadow-cyan-950/40 transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Apply Correction</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* FULLSCREEN PREVIEW MODAL */}
      {/* ------------------------------------------------------------- */}
      {previewZoomPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setPreviewZoomPage(null)}
              className="absolute -top-10 right-0 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={previewZoomPage.previewUrl}
              alt="Zoomed view"
              className="max-h-[82vh] max-w-full object-contain rounded-xl shadow-2xl"
            />
            <p className="text-xs text-gray-400 pt-3">
              {previewZoomPage.originalFilename} (Filter: {previewZoomPage.filterType.toUpperCase()}, Rotation: {previewZoomPage.rotation}°)
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* CONFIRM CLEAR ALL MODAL */}
      {/* ------------------------------------------------------------- */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#141624] border border-[#2b304c] shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-center justify-center text-rose-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-gray-100">Clear all pages?</h3>
                <p className="text-xs text-gray-400">
                  This will remove all {pages.length} scanned and uploaded pages.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-xl bg-[#1e2236] hover:bg-[#282d47] text-gray-300 text-xs transition"
              >
                Cancel
              </button>
              <button
                onClick={clearAllPages}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs shadow transition"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScannerView;
