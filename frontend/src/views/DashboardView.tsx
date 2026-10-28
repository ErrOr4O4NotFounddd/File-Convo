import React, { useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  FileStack,
  Archive,
  FileType,
  ScanText,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  FolderOpen,
  Sparkles,
  Zap,
  Clock,
  Download,
  LayoutGrid
} from "lucide-react";
import type { SystemStatus, HistoryItem } from "../api/client";
import { downloadFile } from "../api/client";
import type { NavTab } from "../components/Sidebar";

interface DashboardViewProps {
  systemStatus: SystemStatus | null;
  history: HistoryItem[];
  setActiveTab: (tab: NavTab, subTool?: string) => void;
  onOpenFolder: (path: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  systemStatus,
  history,
  setActiveTab,
  onOpenFolder,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const tools = [
    {
      id: "documents" as NavTab,
      title: "Document to PDF",
      category: "Documents",
      desc: "Batch convert DOCX, PPTX, and XLSX to high-fidelity PDF documents using LibreOffice headless.",
      icon: FileText,
      badge: "P1",
      formats: ["DOCX", "PPTX", "XLSX"],
      color: "from-blue-600/20 to-indigo-600/20 border-blue-500/30 text-blue-400"
    },
    {
      id: "images" as NavTab,
      title: "Image Studio & HEIC",
      category: "Images",
      desc: "Convert iPhone HEIC/HEIF photos, WebP, PNG, JPG, BMP, TIFF. Quality slider, pixel/percentage resize, EXIF toggle.",
      icon: ImageIcon,
      badge: "P1",
      formats: ["HEIC", "PNG", "JPG", "WebP", "PDF"],
      color: "from-violet-600/20 to-purple-600/20 border-violet-500/30 text-violet-400"
    },
    {
      id: "pdf" as NavTab,
      subTool: "organize",
      title: "PDF Page Organizer",
      category: "PDF",
      desc: "Visually reorder pages with drag-and-drop, delete unwanted pages, and insert pages from additional PDFs offline.",
      icon: LayoutGrid,
      badge: "NEW",
      formats: ["Reorder", "Delete", "Add Pages", "Export"],
      color: "from-emerald-600/20 to-teal-600/20 border-emerald-500/30 text-emerald-400"
    },
    {
      id: "pdf" as NavTab,
      subTool: "merge",
      title: "PDF Manipulation Suite",
      category: "PDF",
      desc: "Merge multiple PDFs with custom reordering, split into individual pages, extract page ranges, and compress.",
      icon: FileStack,
      badge: "P1",
      formats: ["Merge", "Split", "Extract", "Compress"],
      color: "from-emerald-600/20 to-teal-600/20 border-emerald-500/30 text-emerald-400"
    },
    {
      id: "archives" as NavTab,
      title: "ZIP Archive Tools",
      category: "Archives",
      desc: "Create secure ZIP archives from multiple files and safely extract archives with Zip Slip traversal protection.",
      icon: Archive,
      badge: "P1",
      formats: ["ZIP Create", "ZIP Extract"],
      color: "from-amber-600/20 to-orange-600/20 border-amber-500/30 text-amber-400"
    },
    {
      id: "pdf-to-word" as NavTab,
      title: "PDF to Word (DOCX)",
      category: "PDF",
      desc: "Convert PDFs into editable Microsoft Word (.docx) documents with layout, paragraph, and table preservation.",
      icon: FileType,
      badge: "P2",
      formats: ["PDF → DOCX"],
      color: "from-sky-600/20 to-blue-600/20 border-sky-500/30 text-sky-400"
    },
    {
      id: "ocr" as NavTab,
      title: "OCR & Text Extraction",
      category: "OCR",
      desc: "Extract editable text from scanned images and PDFs. Generate searchable PDFs with English and Bengali support.",
      icon: ScanText,
      badge: "P2",
      formats: ["Image → TXT", "PDF → TXT", "Searchable PDF"],
      color: "from-pink-600/20 to-rose-600/20 border-pink-500/30 text-pink-400"
    },
  ];

  const filteredTools = tools.filter(
    (t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.formats.some((f) => f.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Welcome Heading Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#171927] via-[#151724] to-[#12131d] border border-[#262a42] p-8 shadow-xl">
        <div className="relative z-10 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-violet-600/20 text-violet-300 border border-violet-500/30">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span>Private & High-Performance File Suite</span>
          </div>

          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            Welcome to <span className="bg-gradient-to-r from-violet-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">File Convo</span>
          </h2>

          <p className="text-sm text-gray-300 leading-relaxed">
            Convert documents, organize and manipulate PDFs, compress and optimize images, manage ZIP archives, and extract text with OCR securely and seamlessly.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setActiveTab("documents")}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-violet-900/30 transition"
            >
              <Zap className="w-4 h-4" /> Start Converting
            </button>
            {systemStatus?.paths?.default_output_dir && (
              <button
                onClick={() => onOpenFolder(systemStatus.paths.default_output_dir)}
                className="px-4 py-2 rounded-xl bg-[#1c1f30] hover:bg-[#252a42] text-gray-200 text-xs font-medium flex items-center gap-2 border border-[#2c314c] transition"
              >
                <FolderOpen className="w-4 h-4 text-violet-400" /> Open Output Folder
              </button>
            )}
          </div>
        </div>

        {/* Decorative background glow */}
        <div className="absolute right-0 top-0 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* System Dependency Status Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* LibreOffice Status */}
        <div className="rounded-2xl bg-[#131520] border border-[#222538] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileText className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-sm text-gray-200">LibreOffice Engine</h3>
            </div>
            {systemStatus?.libreoffice?.installed ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/40">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/70 text-amber-300 border border-amber-800/40">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Not Detected
              </span>
            )}
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            {systemStatus?.libreoffice?.installed
              ? `Ready for DOCX, PPTX, and XLSX to PDF conversion. Path: ${systemStatus.libreoffice.path}`
              : "LibreOffice enables high-fidelity DOCX, PPTX, and XLSX to PDF conversion locally."}
          </p>

          {!systemStatus?.libreoffice?.installed && (
            <div className="pt-1">
              <a
                href="https://www.libreoffice.org/download/download-libreoffice/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 underline font-medium"
              >
                Download LibreOffice for Windows <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Tesseract OCR Status */}
        <div className="rounded-2xl bg-[#131520] border border-[#222538] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ScanText className="w-5 h-5 text-pink-400" />
              <h3 className="font-semibold text-sm text-gray-200">Tesseract OCR Engine</h3>
            </div>
            {systemStatus?.tesseract?.installed ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/40">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-950/70 text-amber-300 border border-amber-800/40">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Not Detected
              </span>
            )}
          </div>

          <p className="text-xs text-gray-400 leading-relaxed">
            {systemStatus?.tesseract?.installed
              ? `Languages: ${systemStatus.tesseract.languages.join(", ") || "eng"}. Path: ${systemStatus.tesseract.path}`
              : "Tesseract powers offline optical character recognition for images and scanned PDFs."}
          </p>

          {!systemStatus?.tesseract?.installed && (
            <div className="pt-1">
              <a
                href="https://github.com/UB-Mannheim/tesseract/wiki"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 underline font-medium"
              >
                Download Tesseract Windows Installer <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Search Bar & Tools Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-100">Conversion Tools</h3>
            <p className="text-xs text-gray-400">Select a tool below to begin processing your files</p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search tools or formats (e.g. HEIC, PDF)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs rounded-xl bg-[#141624] border border-[#282c44] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-violet-500 transition"
            />
          </div>
        </div>

        {/* Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <div
                key={tool.title}
                onClick={() => setActiveTab(tool.id, (tool as any).subTool)}
                className="group rounded-2xl bg-[#131522] border border-[#23273c] hover:border-violet-500/40 p-5 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-950/20 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div
                      className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${tool.color} flex items-center justify-center border`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[#1b1e2e] text-gray-400 border border-[#2b2f48]">
                      {tool.badge}
                    </span>
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm text-gray-100 group-hover:text-violet-300 transition">
                      {tool.title}
                    </h4>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                      {tool.desc}
                    </p>
                  </div>
                </div>

                <div className="pt-4 mt-3 border-t border-[#1d2030] flex items-center justify-between text-xs">
                  <div className="flex flex-wrap gap-1">
                    {tool.formats.slice(0, 3).map((fmt) => (
                      <span
                        key={fmt}
                        className="px-1.5 py-0.5 rounded bg-[#1a1c2b] text-[10px] text-gray-400 font-mono"
                      >
                        {fmt}
                      </span>
                    ))}
                  </div>

                  <span className="text-violet-400 group-hover:translate-x-1 transition flex items-center gap-1 font-medium">
                    Open <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Conversions Section */}
      {history.length > 0 && (
        <div className="rounded-2xl bg-[#131520] border border-[#222538] p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#222538]">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-400" />
              <h3 className="font-semibold text-sm text-gray-200">Recent Conversions</h3>
            </div>
            <button
              onClick={() => setActiveTab("history")}
              className="text-xs text-violet-400 hover:text-violet-300 font-medium"
            >
              View Full History →
            </button>
          </div>

          <div className="divide-y divide-[#1e2133]">
            {history.slice(0, 5).map((item) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      item.status === "success" ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-200 font-medium truncate">{item.original_filename}</p>
                    <p className="text-[11px] text-gray-400">{item.conversion_type}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 ml-2">
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">
                    {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {item.output_location && (
                    <>
                      <button
                        onClick={() => {
                          const filename = item.output_location?.split(/[/\\]/).pop() || "download";
                          downloadFile(item.output_location!, filename);
                        }}
                        className="p-1 rounded text-violet-400 hover:text-white hover:bg-violet-600/40 transition"
                        title="Download file"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onOpenFolder(item.output_location!)}
                        className="p-1 rounded text-gray-400 hover:text-violet-400 hover:bg-[#1f2235] transition"
                        title="Reveal in Explorer"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
