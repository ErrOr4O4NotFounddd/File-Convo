import React, { useState } from "react";
import {
  FileStack,
  Layers,
  Scissors,
  Bookmark,
  Minimize2,
  Loader2,
  Play,
  LayoutGrid
} from "lucide-react";
import { DropZone } from "../components/DropZone";
import { ResultCard } from "../components/ResultCard";
import { PdfPageOrganizer } from "../components/PdfPageOrganizer";
import type { SystemStatus, ConversionResult } from "../api/client";
import { api } from "../api/client";

export type PdfSubTool = "organize" | "merge" | "split" | "extract" | "compress";

interface PdfToolsViewProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
  refreshHistory: () => void;
  initialSubTool?: PdfSubTool;
}

export const PdfToolsView: React.FC<PdfToolsViewProps> = ({
  systemStatus,
  onOpenFolder,
  refreshHistory,
  initialSubTool = "organize",
}) => {
  const [prevInitialSubTool, setPrevInitialSubTool] = useState<PdfSubTool>(initialSubTool);
  const [activeSubTool, setActiveSubTool] = useState<PdfSubTool>(initialSubTool);
  const [files, setFiles] = useState<File[]>([]);
  const [customOutputDir, setCustomOutputDir] = useState<string>("");

  if (initialSubTool !== prevInitialSubTool) {
    setPrevInitialSubTool(initialSubTool);
    setActiveSubTool(initialSubTool);
  }

  // Subtool specific states
  const [mergeOutputName, setMergeOutputName] = useState<string>("merged_document.pdf");
  const [pageRanges, setPageRanges] = useState<string>("1-3, 5");
  const [compressionLevel, setCompressionLevel] = useState<string>("medium");

  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const subTools = [
    { id: "organize" as PdfSubTool, label: "Page Organizer", icon: LayoutGrid, desc: "Visual thumbnail reordering, delete & add pages" },
    { id: "merge" as PdfSubTool, label: "Merge PDFs", icon: Layers, desc: "Combine multiple PDFs in exact order" },
    { id: "split" as PdfSubTool, label: "Split PDF", icon: Scissors, desc: "Split every page into a standalone PDF" },
    { id: "extract" as PdfSubTool, label: "Extract Pages", icon: Bookmark, desc: "Extract selected page numbers or ranges" },
    { id: "compress" as PdfSubTool, label: "Compress PDF", icon: Minimize2, desc: "Optimize streams and reduce file size" },
  ];

  const handleExecute = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setResult(null);
    setErrorMsg(null);

    try {
      if (activeSubTool === "merge") {
        if (files.length < 2) {
          setErrorMsg("Please upload at least 2 PDF files to merge.");
          setIsProcessing(false);
          return;
        }
        const res = await api.mergePdfs(files, mergeOutputName, customOutputDir || undefined);
        setResult(res);
      } else if (activeSubTool === "split") {
        const res = await api.splitPdf(files[0], customOutputDir || undefined);
        setResult(res);
      } else if (activeSubTool === "extract") {
        if (!pageRanges.trim()) {
          setErrorMsg("Please provide page ranges (e.g. 1-3, 5).");
          setIsProcessing(false);
          return;
        }
        const res = await api.extractPdfPages(files[0], pageRanges, customOutputDir || undefined);
        setResult(res);
      } else if (activeSubTool === "compress") {
        const res = await api.compressPdf(files[0], compressionLevel, customOutputDir || undefined);
        setResult(res);
      }
      refreshHistory();
    } catch (err: any) {
      setErrorMsg(err.message || "PDF operation failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
            <FileStack className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">PDF Tools Suite</h2>
            <p className="text-xs text-gray-400">
              Interactive Page Organizer, multi-PDF merger, page splitter, range extractor, and compressor
            </p>
          </div>
        </div>
      </div>

      {/* Subtool Navigation Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
        {subTools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeSubTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => {
                setActiveSubTool(tool.id);
                setFiles([]);
                setResult(null);
                setErrorMsg(null);
              }}
              className={`p-3 rounded-xl border text-left transition flex items-center gap-3 ${
                isActive
                  ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200 shadow-sm"
                  : "bg-[#131522] border-[#23273c] text-gray-400 hover:text-gray-200 hover:border-[#323752]"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  isActive ? "bg-emerald-600/30 text-emerald-300" : "bg-[#1a1d2e] text-gray-400"
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-xs truncate">{tool.label}</p>
                <p className="text-[10px] text-gray-400 line-clamp-1">{tool.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Organizer Subtool View */}
      {activeSubTool === "organize" ? (
        <PdfPageOrganizer
          systemStatus={systemStatus}
          onOpenFolder={onOpenFolder}
          refreshHistory={refreshHistory}
        />
      ) : (
        /* Standard Merge, Split, Extract, Compress Workspace */
        <div className="space-y-6">
          {/* Upload Zone */}
          <DropZone
            files={files}
            setFiles={setFiles}
            accept=".pdf"
            multiple={activeSubTool === "merge"}
            title={
              activeSubTool === "merge"
                ? "Drop multiple PDF files to merge (reorderable)"
                : "Drop a PDF file to process"
            }
            hint={
              activeSubTool === "merge"
                ? "You can drag or use up/down buttons to reorder the merging sequence"
                : "Select one PDF document"
            }
            allowReorder={activeSubTool === "merge"}
            customOutputDir={customOutputDir}
            setCustomOutputDir={setCustomOutputDir}
            defaultOutputDir={systemStatus?.paths?.default_output_dir}
          />

          {/* Subtool Configuration Area */}
          {files.length > 0 && (
            <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-5 space-y-4">
              {activeSubTool === "merge" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-300">Merged Output Filename:</label>
                  <input
                    type="text"
                    value={mergeOutputName}
                    onChange={(e) => setMergeOutputName(e.target.value)}
                    className="w-full sm:w-80 px-3 py-1.5 text-xs rounded-lg bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[11px] text-gray-400">
                    Files will be merged in the exact order shown in the list above.
                  </p>
                </div>
              )}

              {activeSubTool === "extract" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-300">Page Ranges to Extract:</label>
                  <input
                    type="text"
                    placeholder="e.g. 1, 3-5, 8"
                    value={pageRanges}
                    onChange={(e) => setPageRanges(e.target.value)}
                    className="w-full sm:w-80 px-3 py-1.5 text-xs rounded-lg bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[11px] text-gray-400">
                    Specify individual pages separated by commas or ranges with hyphens (e.g. 1-4, 7, 9-12).
                  </p>
                </div>
              )}

              {activeSubTool === "compress" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-300">Optimization Preset:</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      { id: "low", label: "Light Clean", desc: "Deflate stream objects safely" },
                      { id: "medium", label: "Balanced (Recommended)", desc: "Compress fonts, streams & images" },
                      { id: "high", label: "High Compression", desc: "Downsample images & maximum deflation" },
                    ].map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setCompressionLevel(preset.id)}
                        className={`p-3 rounded-xl border text-left transition ${
                          compressionLevel === preset.id
                            ? "bg-emerald-950/40 border-emerald-500 text-emerald-200"
                            : "bg-[#181a28] border-[#292d44] text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        <p className="font-semibold text-xs">{preset.label}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{preset.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeSubTool === "split" && (
                <p className="text-xs text-gray-400">
                  Each page of this PDF will be saved as an independent PDF file inside a dedicated subfolder.
                </p>
              )}

              <div className="flex justify-end pt-2 border-t border-[#1e2133]">
                <button
                  onClick={handleExecute}
                  disabled={isProcessing}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing PDF...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Execute {subTools.find((t) => t.id === activeSubTool)?.label}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 text-rose-300 text-xs">
              {errorMsg}
            </div>
          )}

          {/* Result Card */}
          {result && (
            <div className="pt-4 border-t border-[#222538] space-y-3">
              <h3 className="font-semibold text-sm text-gray-200">Operation Result</h3>
              <ResultCard result={result} onOpenExplorer={onOpenFolder} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
