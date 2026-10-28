import React, { useState } from "react";
import { FileText, Loader2, Play, AlertTriangle, ExternalLink } from "lucide-react";
import { DropZone } from "../components/DropZone";
import { ResultCard } from "../components/ResultCard";
import type { SystemStatus, ConversionResult } from "../api/client";
import { api } from "../api/client";

interface DocumentsViewProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
  refreshHistory: () => void;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({
  systemStatus,
  onOpenFolder,
  refreshHistory,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [customOutputDir, setCustomOutputDir] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ConversionResult[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const isLibreOfficeMissing = !systemStatus?.libreoffice?.installed;

  const handleConvert = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setResults([]);
    setGeneralError(null);

    try {
      const response = await api.convertDocuments(files, customOutputDir || undefined);
      setResults(response.results);
      refreshHistory();
    } catch (err: any) {
      setGeneralError(err.message || "Document conversion failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">Document to PDF Converter</h2>
            <p className="text-xs text-gray-400">
              Convert DOCX, PPTX, and XLSX files to PDF format using LibreOffice headless
            </p>
          </div>
        </div>
      </div>

      {/* Missing LibreOffice Notice */}
      {isLibreOfficeMissing && (
        <div className="rounded-xl bg-amber-950/30 border border-amber-800/40 p-4 space-y-2 text-amber-200 text-xs">
          <div className="flex items-center gap-2 font-semibold text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>LibreOffice Required for Document Conversion</span>
          </div>
          <p className="leading-relaxed">
            Document conversion (Word, PowerPoint, and Excel to PDF) requires LibreOffice to be installed on your Windows PC.
          </p>
          <div className="pt-1">
            <a
              href="https://www.libreoffice.org/download/download-libreoffice/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 underline font-medium"
            >
              Download LibreOffice for Windows (Free) <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {/* Drag & Drop Area */}
      <DropZone
        files={files}
        setFiles={setFiles}
        accept=".docx,.doc,.pptx,.ppt,.xlsx,.xls,.odt,.odp,.ods,.rtf,.txt"
        multiple={true}
        title="Drop DOCX, PPTX, or XLSX documents here"
        hint="Supports Word (.docx), PowerPoint (.pptx), Excel (.xlsx), and text formats"
        customOutputDir={customOutputDir}
        setCustomOutputDir={setCustomOutputDir}
        defaultOutputDir={systemStatus?.paths?.default_output_dir}
      />

      {/* Convert Action Button */}
      {files.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleConvert}
            disabled={isProcessing}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-violet-900/30 transition"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Converting {files.length} document{files.length > 1 ? "s" : ""}...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Convert to PDF ({files.length})</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* General Error Banner */}
      {generalError && (
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 text-rose-300 text-xs">
          {generalError}
        </div>
      )}

      {/* Conversion Results */}
      {results.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-[#222538]">
          <h3 className="font-semibold text-sm text-gray-200">Conversion Results</h3>
          <div className="space-y-3">
            {results.map((res, idx) => (
              <ResultCard key={idx} result={res} onOpenExplorer={onOpenFolder} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
