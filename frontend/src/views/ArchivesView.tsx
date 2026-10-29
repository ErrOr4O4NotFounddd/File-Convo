import React, { useState } from "react";
import { Archive, FolderArchive, FolderOutput, Loader2, Play, ShieldCheck } from "lucide-react";
import { DropZone } from "../components/DropZone";
import { ResultCard } from "../components/ResultCard";
import type { SystemStatus, ConversionResult } from "../api/client";
import { api } from "../api/client";

interface ArchivesViewProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
}

export const ArchivesView: React.FC<ArchivesViewProps> = ({
  systemStatus,
  onOpenFolder,
}) => {
  const [mode, setMode] = useState<"create" | "extract">("create");
  const [files, setFiles] = useState<File[]>([]);
  const [zipName, setZipName] = useState<string>("archive.zip");
  const [customOutputDir, setCustomOutputDir] = useState<string>("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAction = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setResult(null);
    setErrorMsg(null);

    try {
      if (mode === "create") {
        const res = await api.createZip(files, zipName, customOutputDir || undefined);
        setResult(res);
      } else {
        const res = await api.extractZip(files[0], customOutputDir || undefined);
        setResult(res);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Archive operation failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-600/20 text-amber-400 flex items-center justify-center">
            <Archive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">ZIP Archive Suite</h2>
            <p className="text-xs text-gray-400">
              Create and extract ZIP archives locally with built-in path-traversal protection
            </p>
          </div>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => {
            setMode("create");
            setFiles([]);
            setResult(null);
            setErrorMsg(null);
          }}
          className={`p-4 rounded-2xl border text-left transition flex items-center gap-3 ${
            mode === "create"
              ? "bg-amber-950/40 border-amber-500/50 text-amber-200 shadow-sm"
              : "bg-[#131522] border-[#23273c] text-gray-400 hover:text-gray-200"
          }`}
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              mode === "create" ? "bg-amber-600/30 text-amber-300" : "bg-[#1a1d2e] text-gray-400"
            }`}
          >
            <FolderArchive className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-sm">Create ZIP Archive</p>
            <p className="text-xs text-gray-400 mt-0.5">Compress multiple files into a single .zip</p>
          </div>
        </button>

        <button
          onClick={() => {
            setMode("extract");
            setFiles([]);
            setResult(null);
            setErrorMsg(null);
          }}
          className={`p-4 rounded-2xl border text-left transition flex items-center gap-3 ${
            mode === "extract"
              ? "bg-amber-950/40 border-amber-500/50 text-amber-200 shadow-sm"
              : "bg-[#131522] border-[#23273c] text-gray-400 hover:text-gray-200"
          }`}
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              mode === "extract" ? "bg-amber-600/30 text-amber-300" : "bg-[#1a1d2e] text-gray-400"
            }`}
          >
            <FolderOutput className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-sm">Extract ZIP Archive</p>
            <p className="text-xs text-gray-400 mt-0.5">Safely unpack ZIP contents to folder</p>
          </div>
        </button>
      </div>

      {/* Security Badge */}
      <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#131520] border border-[#23273c] text-[11px] text-gray-400">
        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>
          Protected against Zip Slip attacks. Every archive path is strictly validated within the extraction boundary.
        </span>
      </div>

      {/* DropZone */}
      <DropZone
        files={files}
        setFiles={setFiles}
        accept={mode === "create" ? undefined : ".zip"}
        multiple={mode === "create"}
        title={mode === "create" ? "Drop files to bundle into ZIP" : "Drop a .zip file to extract"}
        hint={mode === "create" ? "Add multiple files of any type" : "Select a single ZIP archive"}
        customOutputDir={customOutputDir}
        setCustomOutputDir={setCustomOutputDir}
        defaultOutputDir={systemStatus?.paths?.default_output_dir}
      />

      {/* Options when files selected */}
      {files.length > 0 && (
        <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-5 space-y-4">
          {mode === "create" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-300">Archive Name:</label>
              <input
                type="text"
                value={zipName}
                onChange={(e) => setZipName(e.target.value)}
                className="w-full sm:w-80 px-3 py-1.5 text-xs rounded-lg bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-amber-500"
              />
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-[#1e2133]">
            <button
              onClick={handleAction}
              disabled={isProcessing}
              className="px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-amber-900/30 transition"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing ZIP...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>{mode === "create" ? "Create ZIP" : "Extract ZIP"}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 text-rose-300 text-xs">
          {errorMsg}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="pt-4 border-t border-[#222538] space-y-3">
          <h3 className="font-semibold text-sm text-gray-200">Result</h3>
          <ResultCard result={result} onOpenExplorer={onOpenFolder} />
        </div>
      )}
    </div>
  );
};
