import React, { useState } from "react";
import { FileType, Loader2, Play, Info } from "lucide-react";
import { DropZone } from "../components/DropZone";
import { ResultCard } from "../components/ResultCard";
import type { SystemStatus, ConversionResult } from "../api/client";
import { api } from "../api/client";

interface PdfToWordViewProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
}

export const PdfToWordView: React.FC<PdfToWordViewProps> = ({
  systemStatus,
  onOpenFolder,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [customOutputDir, setCustomOutputDir] = useState<string>("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConvert = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setResult(null);
    setErrorMsg(null);

    try {
      const res = await api.convertPdfToDocx(files[0], customOutputDir || undefined);
      setResult(res);
    } catch (err: any) {
      setErrorMsg(err.message || "PDF to Word conversion failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-sky-600/20 text-sky-400 flex items-center justify-center">
            <FileType className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">PDF to Word Converter</h2>
            <p className="text-xs text-gray-400">
              Convert PDF files into editable Microsoft Word (.docx) documents locally
            </p>
          </div>
        </div>
      </div>

      {/* Info notice about PDF to Word expectations */}
      <div className="rounded-xl bg-[#131520] border border-[#23273c] p-4 text-xs text-gray-300 flex items-start gap-3">
        <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-[11px] leading-relaxed text-gray-400">
          <p className="text-gray-200 font-medium text-xs">Fidelity & Formatting Expectation</p>
          <p>
            PDF is a print-fixed layout format, whereas DOCX is a flowable document format. Standard text, headings, and images convert cleanly. Intricate multi-column layouts, nested tables, or proprietary embedded fonts may require minor layout adjustments in Microsoft Word.
          </p>
          <p className="text-amber-400">
            For scanned documents containing photographed pages, use the <strong>OCR & Text Extraction</strong> tool.
          </p>
        </div>
      </div>

      {/* Upload DropZone */}
      <DropZone
        files={files}
        setFiles={setFiles}
        accept=".pdf"
        multiple={false}
        title="Drop a PDF file to convert to Word (.docx)"
        hint="Supports multipage PDF documents"
        customOutputDir={customOutputDir}
        setCustomOutputDir={setCustomOutputDir}
        defaultOutputDir={systemStatus?.paths?.default_output_dir}
      />

      {/* Action */}
      {files.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleConvert}
            disabled={isProcessing}
            className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-sky-900/30 transition"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Converting to Word (.docx)...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Convert to Word</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Error */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 text-rose-300 text-xs">
          {errorMsg}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="pt-4 border-t border-[#222538] space-y-3">
          <h3 className="font-semibold text-sm text-gray-200">Generated Word Document</h3>
          <ResultCard result={result} onOpenExplorer={onOpenFolder} />
        </div>
      )}
    </div>
  );
};
