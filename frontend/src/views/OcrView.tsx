import React, { useState } from "react";
import {
  ScanText,
  FileImage,
  FileText,
  Search,
  FileType,
  Loader2,
  Play,
  AlertTriangle,
  ExternalLink,
  Languages
} from "lucide-react";
import { DropZone } from "../components/DropZone";
import { ResultCard } from "../components/ResultCard";
import type { SystemStatus, ConversionResult } from "../api/client";
import { api } from "../api/client";

interface OcrViewProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
}

type OcrOperation = "image-to-text" | "pdf-to-text" | "searchable-pdf" | "pdf-to-docx";

export const OcrView: React.FC<OcrViewProps> = ({
  systemStatus,
  onOpenFolder,
}) => {
  const [operation, setOperation] = useState<OcrOperation>("image-to-text");
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState<string>("eng");
  const [customOutputDir, setCustomOutputDir] = useState<string>("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isTesseractMissing = !systemStatus?.tesseract?.installed;

  const operations = [
    {
      id: "image-to-text" as OcrOperation,
      label: "Image → TXT",
      icon: FileImage,
      desc: "Extract text from photos, scans, screenshots",
      accept: ".png,.jpg,.jpeg,.webp,.bmp,.tiff",
    },
    {
      id: "pdf-to-text" as OcrOperation,
      label: "Scanned PDF → TXT",
      icon: FileText,
      desc: "Extract text from scanned PDF pages",
      accept: ".pdf",
    },
    {
      id: "searchable-pdf" as OcrOperation,
      label: "Searchable PDF",
      icon: Search,
      desc: "Overlay selectable invisible text on PDF",
      accept: ".pdf",
    },
    {
      id: "pdf-to-docx" as OcrOperation,
      label: "Scanned PDF → Word",
      icon: FileType,
      desc: "OCR scanned PDF directly into editable DOCX",
      accept: ".pdf",
    },
  ];

  const currentOp = operations.find((o) => o.id === operation)!;

  const handleRunOcr = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setResult(null);
    setErrorMsg(null);

    try {
      let res: ConversionResult;
      const file = files[0];
      const outDir = customOutputDir || undefined;

      if (operation === "image-to-text") {
        res = await api.ocrImageToText(file, language, outDir);
      } else if (operation === "pdf-to-text") {
        res = await api.ocrPdfToText(file, language, outDir);
      } else if (operation === "searchable-pdf") {
        res = await api.ocrPdfToSearchablePdf(file, language, outDir);
      } else {
        res = await api.ocrPdfToDocx(file, language, outDir);
      }

      setResult(res);
    } catch (err: any) {
      setErrorMsg(err.message || "OCR execution failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-pink-600/20 text-pink-400 flex items-center justify-center">
            <ScanText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">OCR & Text Extraction</h2>
            <p className="text-xs text-gray-400">
              Offline optical character recognition for images and scanned PDFs with English & Bangla support
            </p>
          </div>
        </div>
      </div>

      {/* Tesseract missing warning */}
      {isTesseractMissing && (
        <div className="rounded-xl bg-amber-950/30 border border-amber-800/40 p-4 space-y-2 text-amber-200 text-xs">
          <div className="flex items-center gap-2 font-semibold text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Tesseract OCR Engine Not Detected</span>
          </div>
          <p className="leading-relaxed">
            Local OCR requires the Tesseract OCR engine. Please install it on Windows to enable offline character recognition.
          </p>
          <div className="pt-1">
            <a
              href="https://github.com/UB-Mannheim/tesseract/wiki"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 underline font-medium"
            >
              Download Tesseract OCR for Windows <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {/* Mode Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {operations.map((op) => {
          const Icon = op.icon;
          const isActive = operation === op.id;
          return (
            <button
              key={op.id}
              onClick={() => {
                setOperation(op.id);
                setFiles([]);
                setResult(null);
                setErrorMsg(null);
              }}
              className={`p-3 rounded-xl border text-left transition ${
                isActive
                  ? "bg-pink-950/40 border-pink-500/50 text-pink-200 shadow-sm"
                  : "bg-[#131522] border-[#23273c] text-gray-400 hover:text-gray-200 hover:border-[#323752]"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mb-2 ${
                  isActive ? "bg-pink-600/30 text-pink-300" : "bg-[#1a1d2e] text-gray-400"
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <p className="font-semibold text-xs">{op.label}</p>
              <p className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">{op.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Language Selector */}
      <div className="p-4 rounded-xl bg-[#131522] border border-[#23273c] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Languages className="w-4 h-4 text-pink-400 shrink-0" />
          <span className="text-gray-300 font-medium">Recognition Language:</span>
        </div>

        <div className="flex items-center gap-2">
          {[
            { id: "eng", label: "English (eng)" },
            { id: "ben", label: "Bengali (ben)" },
            { id: "eng+ben", label: "English + Bangla" },
          ].map((lang) => (
            <button
              key={lang.id}
              type="button"
              onClick={() => setLanguage(lang.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                language === lang.id
                  ? "bg-pink-600 text-white border-pink-500"
                  : "bg-[#181a28] text-gray-400 border-[#272b42] hover:text-gray-200"
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* DropZone */}
      <DropZone
        files={files}
        setFiles={setFiles}
        accept={currentOp.accept}
        multiple={false}
        title={`Drop file for ${currentOp.label}`}
        hint={currentOp.desc}
        customOutputDir={customOutputDir}
        setCustomOutputDir={setCustomOutputDir}
        defaultOutputDir={systemStatus?.paths?.default_output_dir}
      />

      {/* Action Button */}
      {files.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={handleRunOcr}
            disabled={isProcessing}
            className="px-6 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-pink-900/30 transition"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Running OCR engine...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Execute OCR</span>
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

      {/* Results */}
      {result && (
        <div className="pt-4 border-t border-[#222538] space-y-3">
          <h3 className="font-semibold text-sm text-gray-200">OCR Result</h3>
          <ResultCard result={result} onOpenExplorer={onOpenFolder} />
        </div>
      )}
    </div>
  );
};
