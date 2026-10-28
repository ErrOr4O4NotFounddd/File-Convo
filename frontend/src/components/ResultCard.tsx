import React, { useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  Copy,
  Check,
  TrendingDown,
  TrendingUp,
  Info,
  Download,
  CheckCircle,
  AlertTriangle
} from "lucide-react";
import type { ConversionResult } from "../api/client";
import { api } from "../api/client";

interface ResultCardProps {
  result: ConversionResult;
  onOpenExplorer?: (path: string) => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ result, onOpenExplorer }) => {
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const formatBytes = (bytes?: number): string => {
    if (bytes === undefined || bytes === null) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const copyPath = (text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpen = async (path?: string) => {
    if (!path) return;
    setOpenError(null);
    try {
      if (onOpenExplorer) {
        onOpenExplorer(path);
      } else {
        await api.openInExplorer(path);
      }
    } catch (err: any) {
      setOpenError(err.message || "Failed to open in Explorer");
    }
  };

  const handleDownload = (path?: string, filename?: string) => {
    if (!path) return;
    api.downloadFile(path, filename);
  };

  const stats = result.stats || {};
  const isSuccess = result.success;
  const targetPath = result.output_path || result.output_folder;

  if (!isSuccess) {
    return (
      <div className="rounded-xl bg-rose-950/20 border border-rose-800/40 p-4 text-rose-300 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-rose-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>Conversion Failed</span>
        </div>
        <p className="text-xs text-rose-200/90 whitespace-pre-wrap">{result.error || "Unknown error occurred."}</p>
        {result.missing_dependency && (
          <p className="text-xs text-amber-300 bg-amber-950/40 p-2 rounded border border-amber-800/30">
            Missing tool: <strong>{result.missing_dependency}</strong>. See instructions in Dashboard or Settings.
          </p>
        )}
      </div>
    );
  }

  const hasReduction = stats.bytes_saved !== undefined && stats.bytes_saved > 0;
  const hasIncrease = stats.bytes_saved !== undefined && stats.bytes_saved < 0;
  const isTargetCompression = stats.target_size !== undefined || result.target_achieved !== undefined;
  const targetAchieved = result.target_achieved ?? stats.target_achieved;

  const isTempPath = !targetPath || targetPath.includes("temp") || targetPath.includes("Temp") || targetPath.includes(".fileconvo");

  return (
    <div className="rounded-xl bg-[#141624] border border-[#272b42] p-4 space-y-4 glow-card transition">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#24283d]">
        <div className="flex items-center gap-2">
          {targetAchieved === false ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-sm text-gray-100">
                {result.output_filename || "Processing Complete"}
              </h4>
              {isTargetCompression && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium border flex items-center gap-1 ${
                    targetAchieved
                      ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/50"
                      : "bg-amber-950/80 text-amber-300 border-amber-800/50"
                  }`}
                >
                  {targetAchieved ? (
                    <>
                      <CheckCircle className="w-3 h-3" />
                      <span>Target Achieved</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3 h-3" />
                      <span>Closest Result</span>
                    </>
                  )}
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 flex items-center gap-1.5 mt-0.5">
              <span className="text-emerald-400 font-medium">Ready</span>
              <span>•</span>
              <span>{stats.output_format || (result.output_filename?.split('.').pop()?.toUpperCase() || 'FILE')}</span>
              {stats.output_size !== undefined && (
                <>
                  <span>•</span>
                  <span>{formatBytes(stats.output_size)}</span>
                </>
              )}
              {!isTempPath && (
                <>
                  <span>•</span>
                  <span className="font-mono truncate max-w-xs">{targetPath}</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {targetPath && (
            <>
              {!isTempPath && (
                <>
                  <button
                    onClick={() => copyPath(targetPath)}
                    className="px-2.5 py-1.5 rounded-lg bg-[#1c1f30] hover:bg-[#252940] text-gray-300 text-xs flex items-center gap-1.5 border border-[#2d324e] transition cursor-pointer"
                    title="Copy File Path"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied" : "Copy Path"}
                  </button>

                  <button
                    onClick={() => handleOpen(targetPath)}
                    className="px-3 py-1.5 rounded-lg bg-[#22263d] hover:bg-[#2c3150] text-gray-200 text-xs font-medium flex items-center gap-1.5 border border-[#343a5e] transition cursor-pointer"
                    title="Reveal file in Windows Explorer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Explorer</span>
                  </button>
                </>
              )}

              <button
                onClick={() => handleDownload(targetPath, result.output_filename)}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg shadow-violet-900/30 transition cursor-pointer"
                title="Download converted file"
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </button>
            </>
          )}
        </div>
      </div>

      {openError && (
        <p className="text-xs text-rose-400 bg-rose-950/30 p-2 rounded border border-rose-800/30">
          {openError}
        </p>
      )}

      {/* Target Explanation Banner */}
      {(stats.target_explanation || result.target_explanation) && (
        <div
          className={`p-3 rounded-lg text-xs flex items-start gap-2 border ${
            targetAchieved
              ? "bg-emerald-950/30 border-emerald-800/40 text-emerald-200"
              : "bg-amber-950/30 border-amber-800/40 text-amber-200"
          }`}
        >
          {targetAchieved ? (
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          )}
          <span>{result.target_explanation || stats.target_explanation}</span>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.original_size !== undefined && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Original Size</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">{formatBytes(stats.original_size)}</p>
          </div>
        )}

        {stats.target_size !== undefined && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Target Size</p>
            <p className="text-sm font-semibold text-violet-300 mt-0.5">{formatBytes(stats.target_size)}</p>
          </div>
        )}

        {stats.output_size !== undefined && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Output Size</p>
            <p
              className={`text-sm font-semibold mt-0.5 ${
                isTargetCompression
                  ? targetAchieved
                    ? "text-emerald-400"
                    : "text-amber-400"
                  : "text-gray-200"
              }`}
            >
              {formatBytes(stats.output_size)}
            </p>
          </div>
        )}

        {stats.bytes_saved !== undefined && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Space Saved</p>
            <p
              className={`text-sm font-semibold flex items-center gap-1 mt-0.5 ${
                hasReduction ? "text-emerald-400" : hasIncrease ? "text-amber-400" : "text-gray-300"
              }`}
            >
              {hasReduction && <TrendingDown className="w-3.5 h-3.5" />}
              {hasIncrease && <TrendingUp className="w-3.5 h-3.5" />}
              {formatBytes(Math.abs(stats.bytes_saved))} ({stats.percent_saved}%)
            </p>
          </div>
        )}

        {stats.output_format && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Format</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">
              {stats.output_format}
              {stats.quality_used && (
                <span className="text-xs font-normal text-gray-400 ml-1">({stats.quality_used}% Q)</span>
              )}
            </p>
          </div>
        )}

        {stats.output_dimensions && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Dimensions</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">
              {stats.output_dimensions.width} × {stats.output_dimensions.height}
            </p>
          </div>
        )}

        {stats.page_count !== undefined && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Pages</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">{stats.page_count}</p>
          </div>
        )}

        {stats.extracted_count !== undefined && (
          <div className="p-2.5 rounded-lg bg-[#181a28] border border-[#222538]">
            <p className="text-[11px] text-gray-400">Extracted Files</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">{stats.extracted_count}</p>
          </div>
        )}
      </div>

      {/* Warnings & Notices */}
      {(stats.fidelity_warning || result.fidelity_warning) && (
        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-200 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{result.fidelity_warning || stats.fidelity_warning}</span>
        </div>
      )}

      {stats.scanned_warning && (
        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-200 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{stats.scanned_warning}</span>
        </div>
      )}

      {stats.fidelity_notice && (
        <p className="text-[11px] text-gray-400 italic">{stats.fidelity_notice}</p>
      )}

      {/* Before and After Image Preview */}
      {stats.before_preview && stats.after_preview ? (
        <div className="pt-3 border-t border-[#222538] space-y-2">
          <p className="text-xs font-medium text-gray-300">Before & After Comparison</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Before */}
            <div className="p-2.5 rounded-xl bg-[#10121d] border border-[#22263d] space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span className="font-medium text-gray-300">Original Image</span>
                <span>{formatBytes(stats.original_size)}</span>
              </div>
              <div className="w-full h-36 rounded-lg bg-black/50 border border-[#1f2235] flex items-center justify-center overflow-hidden">
                <img
                  src={stats.before_preview}
                  alt="Original preview"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="text-[10px] text-gray-500 text-center">
                {stats.original_dimensions?.width} × {stats.original_dimensions?.height} px
              </div>
            </div>

            {/* After */}
            <div className="p-2.5 rounded-xl bg-[#10121d] border border-violet-900/40 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span className="font-medium text-violet-300">Compressed Output</span>
                <span
                  className={
                    targetAchieved ? "font-semibold text-emerald-400" : "font-semibold text-amber-400"
                  }
                >
                  {formatBytes(stats.output_size)}
                </span>
              </div>
              <div className="w-full h-36 rounded-lg bg-black/50 border border-[#1f2235] flex items-center justify-center overflow-hidden">
                <img
                  src={stats.after_preview}
                  alt="Compressed preview"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="text-[10px] text-gray-500 text-center">
                {stats.output_dimensions?.width} × {stats.output_dimensions?.height} px ({stats.output_format})
              </div>
            </div>
          </div>
        </div>
      ) : stats.after_preview ? (
        <div className="pt-2 border-t border-[#222538] flex items-center gap-4">
          <img
            src={stats.after_preview}
            alt="Preview thumbnail"
            className="w-20 h-20 object-cover rounded-lg border border-[#2c3048] bg-black/40"
          />
          <div className="text-xs text-gray-400">
            <p className="text-gray-200 font-medium">Output Image Preview</p>
            <p>
              Original: {stats.original_dimensions?.width}×{stats.original_dimensions?.height} →{" "}
              {stats.output_dimensions?.width}×{stats.output_dimensions?.height}
            </p>
            <p>Format: {stats.output_format}</p>
          </div>
        </div>
      ) : null}

      {/* OCR Text Preview */}
      {result.extracted_text && (
        <div className="pt-2 border-t border-[#222538] space-y-1.5">
          <p className="text-xs font-medium text-gray-300">Extracted Text Preview:</p>
          <pre className="text-xs font-mono bg-[#0d0e15] p-3 rounded-lg border border-[#222538] text-gray-300 max-h-48 overflow-y-auto whitespace-pre-wrap select-text">
            {result.extracted_text}
          </pre>
        </div>
      )}
    </div>
  );
};
