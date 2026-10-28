import React, { useState, useEffect } from "react";
import {
  Sliders,
  Target,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Layers,
  Sparkles,
  AlertCircle
} from "lucide-react";
import { DropZone } from "../components/DropZone";
import { ResultCard } from "../components/ResultCard";
import type { SystemStatus, ConversionResult } from "../api/client";
import { api } from "../api/client";

interface ImagesViewProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
  refreshHistory: () => void;
}

export const ImagesView: React.FC<ImagesViewProps> = ({
  systemStatus,
  onOpenFolder,
  refreshHistory,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [customOutputDir, setCustomOutputDir] = useState<string>("");

  // Base Format & Standard Compression (Mode A: Default)
  const [targetFormat, setTargetFormat] = useState<string>("auto");
  const [quality, setQuality] = useState<number>(80);

  // Target File Size Compression (Mode B: Optional, Disabled by Default)
  const [enableTargetSize, setEnableTargetSize] = useState<boolean>(false);
  const [targetSizeValue, setTargetSizeValue] = useState<string>("1");
  const [targetSizeUnit, setTargetSizeUnit] = useState<"KB" | "MB">("MB");
  const [allowPngFallback, setAllowPngFallback] = useState<boolean>(true);
  const [autoDownscale, setAutoDownscale] = useState<boolean>(false);

  // Image Resizing (Optional, Disabled by Default)
  const [enableResize, setEnableResize] = useState<boolean>(false);
  const [resizeMode, setResizeMode] = useState<"pixels" | "percentage" | "max_dimensions">("pixels");
  const [targetWidth, setTargetWidth] = useState<string>("");
  const [targetHeight, setTargetHeight] = useState<string>("");
  const [resizePercentage, setResizePercentage] = useState<number>(75);
  const [maintainAspectRatio, setMaintainAspectRatio] = useState<boolean>(true);

  // Advanced Options
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [preserveExif, setPreserveExif] = useState<boolean>(true);
  const [bgColorHex, setBgColorHex] = useState<string>("#ffffff");

  // Natural dimensions detected from first image
  const [naturalDims, setNaturalDims] = useState<{ width: number; height: number } | null>(null);

  // Execution State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [results, setResults] = useState<ConversionResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Presets for Custom Target Size
  const presets = [
    { label: "500 KB", val: 500, unit: "KB" as const },
    { label: "1 MB", val: 1, unit: "MB" as const },
    { label: "2 MB", val: 2, unit: "MB" as const },
    { label: "5 MB", val: 5, unit: "MB" as const },
    { label: "10 MB", val: 10, unit: "MB" as const },
    { label: "20 MB", val: 20, unit: "MB" as const },
  ];

  const formatOptions = [
    { id: "auto", label: "Auto (Match Source)", desc: "Preserve source format or optimal encoder" },
    { id: "jpg", label: "JPEG / JPG", desc: "Best for photographs & balanced file size" },
    { id: "webp", label: "WebP", desc: "Modern, highest web compression efficiency" },
    { id: "png", label: "PNG", desc: "Lossless optimization with transparency support" },
    { id: "pdf", label: "PDF Document", desc: "Embed image into a clean PDF document" },
  ];

  // Try to inspect dimensions of the first uploaded image
  useEffect(() => {
    if (files.length > 0) {
      const first = files[0];
      if (first.type.startsWith("image/") && !first.name.toLowerCase().endsWith(".heic")) {
        const objectUrl = URL.createObjectURL(first);
        const img = new Image();
        img.onload = () => {
          setNaturalDims({ width: img.naturalWidth, height: img.naturalHeight });
          URL.revokeObjectURL(objectUrl);
        };
        img.onerror = () => {
          setNaturalDims(null);
          URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
        return;
      }
    }
    setNaturalDims(null);
  }, [files]);

  // Calculate target size in KB
  const getCalculatedTargetKb = (): number => {
    const parsed = parseFloat(targetSizeValue);
    if (isNaN(parsed) || parsed <= 0) return 1024;
    return targetSizeUnit === "MB" ? parsed * 1024 : parsed;
  };

  const handleApplyPreset = (val: number, unit: "KB" | "MB") => {
    setTargetSizeValue(val.toString());
    setTargetSizeUnit(unit);
  };

  // Handle Width change with Aspect Ratio auto-calculation
  const handleWidthChange = (val: string) => {
    setTargetWidth(val);
    if (maintainAspectRatio && naturalDims && naturalDims.width > 0) {
      const parsed = parseInt(val);
      if (!isNaN(parsed) && parsed > 0) {
        const computedHeight = Math.max(1, Math.round((parsed / naturalDims.width) * naturalDims.height));
        setTargetHeight(computedHeight.toString());
      }
    }
  };

  // Handle Height change with Aspect Ratio auto-calculation
  const handleHeightChange = (val: string) => {
    setTargetHeight(val);
    if (maintainAspectRatio && naturalDims && naturalDims.height > 0) {
      const parsed = parseInt(val);
      if (!isNaN(parsed) && parsed > 0) {
        const computedWidth = Math.max(1, Math.round((parsed / naturalDims.height) * naturalDims.width));
        setTargetWidth(computedWidth.toString());
      }
    }
  };

  // Main submission handler
  const handleProcess = async () => {
    if (files.length === 0) return;

    if (enableTargetSize) {
      const targetKb = getCalculatedTargetKb();
      if (targetKb <= 0) {
        setErrorMsg("Please enter a valid target size greater than 0.");
        return;
      }
    }

    if (enableResize) {
      if (resizeMode === "percentage") {
        if (!resizePercentage || resizePercentage <= 0) {
          setErrorMsg("Please specify a valid resize percentage.");
          return;
        }
      } else {
        const w = parseInt(targetWidth);
        const h = parseInt(targetHeight);
        if ((!w || w <= 0) && (!h || h <= 0)) {
          setErrorMsg("Please enter at least one valid dimension (width or height in pixels).");
          return;
        }
      }
    }

    setIsProcessing(true);
    setResults([]);
    setErrorMsg(null);

    try {
      const response = await api.processImages(files, {
        target_format: targetFormat,
        quality: quality,
        enable_resize: enableResize,
        resize_mode: enableResize ? resizeMode : "none",
        target_width: enableResize && targetWidth ? parseInt(targetWidth) : undefined,
        target_height: enableResize && targetHeight ? parseInt(targetHeight) : undefined,
        resize_percentage: enableResize ? resizePercentage : undefined,
        maintain_aspect_ratio: maintainAspectRatio,
        enable_target_size: enableTargetSize,
        target_size_kb: enableTargetSize ? getCalculatedTargetKb() : undefined,
        allow_png_fallback: allowPngFallback,
        auto_downscale: autoDownscale,
        preserve_exif: preserveExif,
        bg_color_hex: bgColorHex,
        custom_output_dir: customOutputDir || undefined,
      });

      setResults(response.results);
      refreshHistory();
    } catch (err: any) {
      setErrorMsg(err.message || "Image processing failed. Please check backend connection.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600/20 text-violet-400 flex items-center justify-center border border-violet-500/20 shadow-md shadow-violet-950/30">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              <span>Image Optimizer & Converter</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20 font-medium">
                Standard & Target Modes
              </span>
            </h2>
            <p className="text-xs text-gray-400">
              Compress, resize, and convert images with intelligent quality optimization and HEIC support
            </p>
          </div>
        </div>
      </div>

      {/* Upload DropZone */}
      <DropZone
        files={files}
        setFiles={setFiles}
        accept=".heic,.heif,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.tif"
        multiple={true}
        title="Drop images here to compress or convert"
        hint="Supports JPG, PNG, WebP, HEIC/HEIF photos, and BMP with batch processing"
        customOutputDir={customOutputDir}
        setCustomOutputDir={setCustomOutputDir}
        defaultOutputDir={systemStatus?.paths?.default_output_dir}
      />

      {/* Main Settings Card */}
      <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-6 space-y-6 shadow-xl">
        {/* Output Format Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-violet-400" />
            <span>Output Format:</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {formatOptions.map((fmt) => (
              <button
                key={fmt.id}
                type="button"
                onClick={() => setTargetFormat(fmt.id)}
                className={`p-3 rounded-xl border text-left transition ${
                  targetFormat === fmt.id
                    ? "bg-violet-600/20 border-violet-500 text-violet-200 shadow-sm"
                    : "bg-[#181a28] border-[#292d44] text-gray-400 hover:border-[#3a3f60] hover:text-gray-200"
                }`}
              >
                <p className="font-bold text-xs">{fmt.label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{fmt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* MODE A: Standard Compression (Default Mode)                   */}
        {/* ------------------------------------------------------------- */}
        <div className="p-4 rounded-xl bg-[#181a28] border border-[#272b42] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h3 className="text-xs font-bold text-gray-200">
                Standard Compression Settings {!enableTargetSize && <span className="text-emerald-400 font-normal">(Active Mode)</span>}
              </h3>
            </div>
            <span className="text-[11px] text-gray-400">
              {targetFormat === "png"
                ? "Lossless Level 9"
                : targetFormat === "pdf"
                ? "Standard PDF"
                : `${quality}% Quality`}
            </span>
          </div>

          {targetFormat !== "png" && targetFormat !== "pdf" ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium">Compression Quality:</span>
                <span className="font-bold text-violet-300 px-2 py-0.5 rounded bg-violet-950/70 border border-violet-800/40">
                  {quality}% {quality === 80 && "(Recommended)"}
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={quality}
                onChange={(e) => setQuality(parseInt(e.target.value))}
                className="w-full accent-violet-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-500">
                <span>Smaller file size (10%)</span>
                <span>Balanced (80%)</span>
                <span>Maximum quality (100%)</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              {targetFormat === "png"
                ? "PNG compression uses maximum lossless optimization with zlib level 9 compression to preserve all pixel data."
                : "Image will be embedded into a high-fidelity PDF page without unnecessary quality loss."}
            </p>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* MODE B: Custom Target File Size (Optional)                    */}
        {/* ------------------------------------------------------------- */}
        <div
          className={`p-4 rounded-xl border transition space-y-4 ${
            enableTargetSize
              ? "bg-[#181a28] border-violet-500/50 shadow-md shadow-violet-950/20"
              : "bg-[#141624] border-[#24283d]"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="enableTargetSize"
                checked={enableTargetSize}
                onChange={(e) => setEnableTargetSize(e.target.checked)}
                className="w-4 h-4 accent-violet-600 rounded cursor-pointer"
              />
              <label
                htmlFor="enableTargetSize"
                className="text-xs font-bold text-gray-200 cursor-pointer flex items-center gap-1.5"
              >
                <Target className="w-3.5 h-3.5 text-violet-400" />
                <span>Set Target File Size</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/40 text-violet-300 border border-violet-700/30 font-normal">
                  Optional
                </span>
              </label>
            </div>
            <span className="text-[11px] text-gray-400">
              Iterative binary quality search
            </span>
          </div>

          {enableTargetSize && (
            <div className="space-y-4 pt-2 border-t border-[#23273c]">
              {/* Quick Presets */}
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-gray-300 block">
                  Quick Size Presets:
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {presets.map((preset) => {
                    const isSelected =
                      targetSizeValue === preset.val.toString() && targetSizeUnit === preset.unit;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => handleApplyPreset(preset.val, preset.unit)}
                        className={`py-1.5 px-2 rounded-lg border text-center transition font-semibold text-xs ${
                          isSelected
                            ? "bg-violet-600 text-white border-violet-500 shadow-sm"
                            : "bg-[#121420] border-[#292d44] text-gray-300 hover:border-violet-500/50 hover:text-white"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Target Input & Unit */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-[#121420] border border-[#272b42]">
                <div>
                  <span className="text-xs font-medium text-gray-200 block">
                    Desired Target File Size:
                  </span>
                  <span className="text-[11px] text-gray-400">
                    Calculated target: ~{getCalculatedTargetKb().toLocaleString()} KB ({(getCalculatedTargetKb() / 1024).toFixed(2)} MB)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={targetSizeValue}
                    onChange={(e) => setTargetSizeValue(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-28 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#181a28] border border-[#2c3048] text-violet-300 focus:outline-none focus:border-violet-500 text-right"
                  />

                  <div className="flex rounded-lg bg-[#181a28] border border-[#2c3048] p-0.5">
                    {(["KB", "MB"] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => setTargetSizeUnit(unit)}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition ${
                          targetSizeUnit === unit
                            ? "bg-violet-600 text-white shadow-sm"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* PNG fallback checkbox */}
              {(targetFormat === "png" || targetFormat === "auto") && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-[#121420] border border-[#272b42]">
                  <input
                    type="checkbox"
                    id="allowPngFallback"
                    checked={allowPngFallback}
                    onChange={(e) => setAllowPngFallback(e.target.checked)}
                    className="accent-violet-600 rounded cursor-pointer"
                  />
                  <label htmlFor="allowPngFallback" className="text-xs text-gray-300 cursor-pointer">
                    Allow conversion to WebP/JPG if lossless PNG cannot reach target size
                  </label>
                </div>
              )}

              {/* Auto downscale checkbox */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[#121420] border border-[#272b42]">
                <input
                  type="checkbox"
                  id="autoDownscale"
                  checked={autoDownscale}
                  onChange={(e) => setAutoDownscale(e.target.checked)}
                  className="accent-violet-600 rounded cursor-pointer"
                />
                <label htmlFor="autoDownscale" className="text-xs text-gray-300 cursor-pointer">
                  Auto-downscale resolution if target size cannot be reached with quality reduction alone
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* IMAGE RESIZING (Optional)                                     */}
        {/* ------------------------------------------------------------- */}
        <div
          className={`p-4 rounded-xl border transition space-y-4 ${
            enableResize
              ? "bg-[#181a28] border-violet-500/50 shadow-md shadow-violet-950/20"
              : "bg-[#141624] border-[#24283d]"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="enableResize"
                checked={enableResize}
                onChange={(e) => setEnableResize(e.target.checked)}
                className="w-4 h-4 accent-violet-600 rounded cursor-pointer"
              />
              <label
                htmlFor="enableResize"
                className="text-xs font-bold text-gray-200 cursor-pointer flex items-center gap-1.5"
              >
                <Maximize2 className="w-3.5 h-3.5 text-violet-400" />
                <span>Enable Image Resizing</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-violet-900/40 text-violet-300 border border-violet-700/30 font-normal">
                  Optional
                </span>
              </label>
            </div>
            {naturalDims && (
              <span className="text-[11px] text-gray-400 font-mono">
                Source: {naturalDims.width} × {naturalDims.height} px
              </span>
            )}
          </div>

          {enableResize && (
            <div className="space-y-4 pt-2 border-t border-[#23273c]">
              {/* Resize Mode Selector */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium">Resize Mode:</span>
                <div className="flex gap-1.5 bg-[#121420] p-1 rounded-lg border border-[#272b42]">
                  {(
                    [
                      { id: "pixels", label: "Exact Pixels" },
                      { id: "percentage", label: "Percentage" },
                      { id: "max_dimensions", label: "Fit Within Max" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setResizeMode(m.id)}
                      className={`px-2.5 py-1 rounded-md text-xs transition ${
                        resizeMode === m.id
                          ? "bg-violet-600 text-white font-semibold"
                          : "text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exact Pixels or Max Dimensions Inputs */}
              {(resizeMode === "pixels" || resizeMode === "max_dimensions") && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">
                        {resizeMode === "max_dimensions" ? "Max Width (px):" : "Width (px):"}
                      </label>
                      <input
                        type="number"
                        min="1"
                        placeholder="e.g. 1920"
                        value={targetWidth}
                        onChange={(e) => handleWidthChange(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-[#121420] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">
                        {resizeMode === "max_dimensions" ? "Max Height (px):" : "Height (px):"}
                      </label>
                      <input
                        type="number"
                        min="1"
                        placeholder="e.g. 1080"
                        value={targetHeight}
                        onChange={(e) => handleHeightChange(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-[#121420] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="maintainAspect"
                        checked={maintainAspectRatio}
                        onChange={(e) => setMaintainAspectRatio(e.target.checked)}
                        className="accent-violet-600 rounded cursor-pointer"
                      />
                      <label htmlFor="maintainAspect" className="text-xs text-gray-300 cursor-pointer">
                        Maintain aspect ratio (prevents distortion)
                      </label>
                    </div>
                    {naturalDims && (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetWidth(naturalDims.width.toString());
                          setTargetHeight(naturalDims.height.toString());
                        }}
                        className="text-[10px] text-violet-400 hover:text-violet-300 underline"
                      >
                        Reset to original
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Percentage Scaling */}
              {resizeMode === "percentage" && (
                <div className="space-y-2 p-3 rounded-lg bg-[#121420] border border-[#272b42]">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-300 font-medium">Scale Percentage:</span>
                    <span className="font-bold text-violet-400">{resizePercentage}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={200}
                    step={5}
                    value={resizePercentage}
                    onChange={(e) => setResizePercentage(parseInt(e.target.value))}
                    className="w-full accent-violet-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500">
                    <span>10% (Tiny)</span>
                    <span>50% (Half)</span>
                    <span>100% (Original)</span>
                    <span>200% (Double)</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------- */}
        {/* ADVANCED SETTINGS (EXIF & Background Color)                   */}
        {/* ------------------------------------------------------------- */}
        <div className="pt-2 border-t border-[#23273c]">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full text-xs text-gray-400 hover:text-gray-200 transition py-1"
          >
            <span>Advanced Configuration (EXIF metadata & transparency background)</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-[#181a28] border border-[#272b42]">
                <input
                  type="checkbox"
                  id="preserveExif"
                  checked={preserveExif}
                  onChange={(e) => setPreserveExif(e.target.checked)}
                  className="accent-violet-600 rounded cursor-pointer"
                />
                <label htmlFor="preserveExif" className="text-xs text-gray-300 cursor-pointer">
                  Preserve camera EXIF metadata
                </label>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[#181a28] border border-[#272b42]">
                <span className="text-xs text-gray-300">Flatten Color:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColorHex}
                    onChange={(e) => setBgColorHex(e.target.value)}
                    className="w-6 h-6 rounded border-0 cursor-pointer bg-transparent"
                  />
                  <span className="font-mono text-xs text-gray-400 uppercase">{bgColorHex}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Primary Action Button */}
      {files.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleProcess}
            disabled={isProcessing}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-violet-900/30 transition cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {enableTargetSize
                    ? `Compressing ${files.length} image${files.length > 1 ? "s" : ""} to ~${targetSizeValue} ${targetSizeUnit}...`
                    : `Optimizing ${files.length} image${files.length > 1 ? "s" : ""}...`}
                </span>
              </>
            ) : (
              <>
                {enableTargetSize ? <Target className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>
                  {enableTargetSize
                    ? `Compress to Target (~${targetSizeValue} ${targetSizeUnit})`
                    : `Compress & Optimize (${files.length} Image${files.length > 1 ? "s" : ""})`}
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {/* General Error Alert */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/50 text-rose-200 text-xs flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-rose-300">Connection or Processing Notice</p>
            <p className="text-rose-200/90 whitespace-pre-wrap">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Conversion Results List */}
      {results.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-[#222538]">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-gray-200">
              Processing & Compression Results
            </h3>
            <span className="text-xs text-gray-400">
              {results.length} item{results.length > 1 ? "s" : ""} processed
            </span>
          </div>

          <div className="space-y-4">
            {results.map((res, idx) => (
              <ResultCard key={idx} result={res} onOpenExplorer={onOpenFolder} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImagesView;
