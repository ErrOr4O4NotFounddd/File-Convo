import React, { useState, useRef } from "react";
import {
  LayoutGrid,
  Plus,
  Trash2,
  Undo2,
  RotateCw,
  MoveLeft,
  MoveRight,
  ChevronsLeft,
  ChevronsRight,
  UploadCloud,
  FileText,
  AlertTriangle,
  CheckSquare,
  Square,
  Loader2,
  Play,
  RotateCcw,
  X,
  FolderOpen
} from "lucide-react";
import { api, type SystemStatus, type ConversionResult, type OrganizerPageData } from "../api/client";
import { ResultCard } from "./ResultCard";

interface PdfPageOrganizerProps {
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
  refreshHistory: () => void;
}

export interface OrganizerItem {
  instanceId: string;
  fileId: string;
  sourceFilename: string;
  pageIndex: number;
  originalPageNumber: number;
  width: number;
  height: number;
  rotation: number;
  thumbnail: string;
}

export const PdfPageOrganizer: React.FC<PdfPageOrganizerProps> = ({
  systemStatus,
  onOpenFolder,
  refreshHistory,
}) => {
  // Main PDF state
  const [mainFilename, setMainFilename] = useState<string>("");
  const [items, setItems] = useState<OrganizerItem[]>([]);
  const [initialItems, setInitialItems] = useState<OrganizerItem[]>([]);
  const [undoStack, setUndoStack] = useState<OrganizerItem[][]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // UI state
  const [isUploadingMain, setIsUploadingMain] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [outputFilename, setOutputFilename] = useState<string>("organized_document.pdf");
  const [customOutputDir, setCustomOutputDir] = useState<string>("");
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Modal dialog states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [showChangeDocConfirm, setShowChangeDocConfirm] = useState<boolean>(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Add PDF Modal state
  const [showAddPdfModal, setShowAddPdfModal] = useState<boolean>(false);
  const [isUploadingAddPdf, setIsUploadingAddPdf] = useState<boolean>(false);
  const [addPdfData, setAddPdfData] = useState<{
    file_id: string;
    filename: string;
    total_pages: number;
    pages: OrganizerPageData[];
  } | null>(null);
  const [addPdfSelectedIndices, setAddPdfSelectedIndices] = useState<Set<number>>(new Set());
  const [insertPlacement, setInsertPlacement] = useState<"end" | "start" | "after" | "before">("end");
  const [insertTargetIndex, setInsertTargetIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addPdfInputRef = useRef<HTMLInputElement>(null);

  // Push state to undo stack
  const pushToUndo = (currentItems: OrganizerItem[]) => {
    setUndoStack((prev) => [...prev.slice(-19), currentItems]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, prev.length - 1));
    setItems(previous);
    setSelectedIds(new Set());
  };

  // Check if there are unsaved edits compared to initialItems
  const hasUnsavedChanges = (): boolean => {
    if (items.length !== initialItems.length) return true;
    for (let i = 0; i < items.length; i++) {
      if (
        items[i].instanceId !== initialItems[i].instanceId ||
        items[i].rotation !== initialItems[i].rotation
      ) {
        return true;
      }
    }
    return false;
  };

  // Upload and parse the primary PDF
  const handleUploadMain = async (file: File) => {
    setIsUploadingMain(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const data = await api.uploadPdfForOrganizer(file);
      const newItems: OrganizerItem[] = data.pages.map((p, idx) => ({
        instanceId: `page_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`,
        fileId: data.file_id,
        sourceFilename: data.filename,
        pageIndex: p.page_index,
        originalPageNumber: p.page_number,
        width: p.width,
        height: p.height,
        rotation: p.rotation || 0,
        thumbnail: p.thumbnail,
      }));

      setMainFilename(data.filename);
      setItems(newItems);
      setInitialItems(newItems);
      setUndoStack([]);
      setSelectedIds(new Set());

      // Auto-populate reasonable default output filename
      const stem = data.filename.replace(/\.pdf$/i, "");
      setOutputFilename(`${stem}_organized.pdf`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load PDF document.");
    } finally {
      setIsUploadingMain(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (items.length > 0 && hasUnsavedChanges()) {
      setPendingFile(file);
      setShowChangeDocConfirm(true);
    } else {
      handleUploadMain(file);
    }
    // Clear input value so same file can be re-selected if needed
    e.target.value = "";
  };

  // Reordering: Drag and Drop
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    pushToUndo(items);
    const updated = [...items];
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, moved);
    setItems(updated);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Reordering via Buttons
  const movePage = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return;
    pushToUndo(items);
    const updated = [...items];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setItems(updated);
  };

  // Page rotation (+90 degrees)
  const rotatePage = (index: number) => {
    pushToUndo(items);
    const updated = [...items];
    const current = updated[index];
    updated[index] = {
      ...current,
      rotation: (current.rotation + 90) % 360,
    };
    setItems(updated);
  };

  // Single page delete
  const deleteSinglePage = (index: number) => {
    pushToUndo(items);
    const updated = [...items];
    const removed = updated.splice(index, 1)[0];
    setItems(updated);
    if (selectedIds.has(removed.instanceId)) {
      const nextSelected = new Set(selectedIds);
      nextSelected.delete(removed.instanceId);
      setSelectedIds(nextSelected);
    }
  };

  // Multi-selection
  const toggleSelectPage = (instanceId: string) => {
    const next = new Set(selectedIds);
    if (next.has(instanceId)) {
      next.delete(instanceId);
    } else {
      next.add(instanceId);
    }
    setSelectedIds(next);
  };

  const selectAll = () => {
    setSelectedIds(new Set(items.map((it) => it.instanceId)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // Delete selected pages
  const confirmDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    pushToUndo(items);
    const remaining = items.filter((it) => !selectedIds.has(it.instanceId));
    setItems(remaining);
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  };

  // Reset to original sequence
  const confirmReset = () => {
    pushToUndo(items);
    setItems(initialItems);
    setSelectedIds(new Set());
    setShowResetConfirm(false);
  };

  // Add PDF: Upload handler
  const handleUploadAddPdf = async (file: File) => {
    setIsUploadingAddPdf(true);
    setAddPdfData(null);
    setAddPdfSelectedIndices(new Set());

    try {
      const data = await api.uploadPdfForOrganizer(file);
      setAddPdfData(data);
      // Default: select all pages from the additional PDF
      setAddPdfSelectedIndices(new Set(data.pages.map((p) => p.page_index)));
    } catch (err: any) {
      setErrorMsg(`Failed to load additional PDF: ${err.message || "Unknown error"}`);
      setShowAddPdfModal(false);
    } finally {
      setIsUploadingAddPdf(false);
    }
  };

  // Add PDF: Insert selected pages into main items
  const handleInsertAddPdfPages = () => {
    if (!addPdfData || addPdfSelectedIndices.size === 0) return;

    pushToUndo(items);

    const selectedPages = addPdfData.pages
      .filter((p) => addPdfSelectedIndices.has(p.page_index))
      .sort((a, b) => a.page_index - b.page_index);

    const newOrganizedPages: OrganizerItem[] = selectedPages.map((p, idx) => ({
      instanceId: `page_add_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`,
      fileId: addPdfData.file_id,
      sourceFilename: addPdfData.filename,
      pageIndex: p.page_index,
      originalPageNumber: p.page_number,
      width: p.width,
      height: p.height,
      rotation: p.rotation || 0,
      thumbnail: p.thumbnail,
    }));

    let updated = [...items];
    if (insertPlacement === "start") {
      updated = [...newOrganizedPages, ...updated];
    } else if (insertPlacement === "end") {
      updated = [...updated, ...newOrganizedPages];
    } else if (insertPlacement === "before") {
      const idx = Math.max(0, Math.min(insertTargetIndex, updated.length));
      updated.splice(idx, 0, ...newOrganizedPages);
    } else if (insertPlacement === "after") {
      const idx = Math.max(0, Math.min(insertTargetIndex + 1, updated.length));
      updated.splice(idx, 0, ...newOrganizedPages);
    }

    setItems(updated);
    setShowAddPdfModal(false);
    setAddPdfData(null);
    setAddPdfSelectedIndices(new Set());
  };

  // Export the organized PDF
  const handleExport = async () => {
    if (items.length === 0) {
      setErrorMsg("Cannot export an empty PDF. Please include at least one page.");
      return;
    }

    setIsExporting(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const exportItems = items.map((it) => ({
        file_id: it.fileId,
        page_index: it.pageIndex,
        rotation: it.rotation,
      }));

      const res = await api.exportOrganizedPdf(
        exportItems,
        outputFilename || "organized_document.pdf",
        customOutputDir || undefined
      );

      setResult(res);
      refreshHistory();
    } catch (err: any) {
      setErrorMsg(err.message || "Exporting organized PDF failed.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#222538]">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-gray-100">PDF Page Organizer</h3>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Rearrange pages with drag-and-drop, delete unwanted pages, and insert pages from additional PDFs offline
          </p>
        </div>

        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (hasUnsavedChanges()) {
                  setShowChangeDocConfirm(true);
                } else {
                  fileInputRef.current?.click();
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-[#181a28] hover:bg-[#202438] text-xs font-medium text-gray-300 border border-[#2a2e46] transition flex items-center gap-1.5"
            >
              <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
              <span>Change PDF</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}
      </div>

      {/* Primary Upload Drop Area (Shown when no PDF is loaded) */}
      {items.length === 0 && !isUploadingMain && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[#282d44] hover:border-emerald-500/60 rounded-3xl p-12 text-center cursor-pointer bg-[#11131e]/50 hover:bg-[#141724]/70 transition-all duration-200 group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="w-16 h-16 rounded-2xl bg-emerald-950/40 text-emerald-400 flex items-center justify-center mx-auto mb-4 group-hover:scale-105 transition shadow-lg shadow-emerald-950/30">
            <UploadCloud className="w-8 h-8" />
          </div>
          <h4 className="text-base font-semibold text-gray-200 mb-1">
            Select or Drop a PDF to Organize
          </h4>
          <p className="text-xs text-gray-400 max-w-md mx-auto mb-4">
            Upload any PDF document. All pages will be extracted as interactive visual thumbnails for reordering, deletion, and merging.
          </p>
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs shadow-lg shadow-emerald-950/40 transition inline-flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            <span>Choose PDF File</span>
          </button>
        </div>
      )}

      {/* Loading state for main PDF */}
      {isUploadingMain && (
        <div className="rounded-3xl bg-[#131522] border border-[#23273c] p-12 text-center space-y-4">
          <Loader2 className="w-10 h-10 text-emerald-400 animate-spin mx-auto" />
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-gray-200">Analyzing PDF & Rendering Thumbnails...</h4>
            <p className="text-xs text-gray-400">Processing pages offline with high visual fidelity</p>
          </div>
        </div>
      )}

      {/* Main Workspace (Visible once a document is loaded) */}
      {items.length > 0 && (
        <div className="space-y-5">
          {/* Document Stats & Control Toolbar */}
          <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-4 flex flex-wrap items-center justify-between gap-3 shadow-md">
            {/* Left: Document info badges */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="px-3 py-1 rounded-lg bg-[#181a28] border border-[#262a40] flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-gray-200 truncate max-w-[200px]" title={mainFilename}>
                  {mainFilename}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 font-medium">
                  {items.length} {items.length === 1 ? "page" : "pages"}
                </span>
              </div>

              {selectedIds.size > 0 && (
                <div className="px-2.5 py-1 rounded-lg bg-emerald-950/50 border border-emerald-800/40 text-[11px] text-emerald-300 font-medium">
                  {selectedIds.size} selected
                </div>
              )}
            </div>

            {/* Right: Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Select All / Deselect All */}
              {selectedIds.size === items.length ? (
                <button
                  onClick={deselectAll}
                  className="px-2.5 py-1.5 rounded-lg bg-[#181a28] hover:bg-[#202438] border border-[#2a2e46] text-xs text-gray-300 flex items-center gap-1.5 transition"
                >
                  <Square className="w-3.5 h-3.5 text-gray-400" />
                  <span>Deselect All</span>
                </button>
              ) : (
                <button
                  onClick={selectAll}
                  className="px-2.5 py-1.5 rounded-lg bg-[#181a28] hover:bg-[#202438] border border-[#2a2e46] text-xs text-gray-300 flex items-center gap-1.5 transition"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Select All</span>
                </button>
              )}

              {/* Delete Selected Pages */}
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={selectedIds.size === 0}
                className="px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/50 disabled:opacity-40 disabled:pointer-events-none text-xs text-rose-300 font-medium flex items-center gap-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span>Delete Selected ({selectedIds.size})</span>
              </button>

              {/* Add Pages from PDF */}
              <button
                onClick={() => {
                  setAddPdfData(null);
                  setAddPdfSelectedIndices(new Set());
                  setShowAddPdfModal(true);
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-700/50 text-xs text-indigo-300 font-medium flex items-center gap-1.5 transition"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                <span>Add PDF</span>
              </button>

              {/* Undo Button */}
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                className="px-2.5 py-1.5 rounded-lg bg-[#181a28] hover:bg-[#202438] border border-[#2a2e46] disabled:opacity-40 disabled:pointer-events-none text-xs text-gray-300 flex items-center gap-1.5 transition"
                title="Undo last action"
              >
                <Undo2 className="w-3.5 h-3.5 text-gray-400" />
                <span>Undo</span>
              </button>

              {/* Reset Order */}
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={!hasUnsavedChanges()}
                className="px-2.5 py-1.5 rounded-lg bg-[#181a28] hover:bg-[#202438] border border-[#2a2e46] disabled:opacity-40 disabled:pointer-events-none text-xs text-gray-300 flex items-center gap-1.5 transition"
                title="Reset to original order"
              >
                <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Page Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5">
            {items.map((page, index) => {
              const isSelected = selectedIds.has(page.instanceId);
              const isDragged = draggedIndex === index;
              const isDragOver = dragOverIndex === index;
              const isFromSecondaryPdf = page.sourceFilename !== mainFilename;

              return (
                <div
                  key={page.instanceId}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  className={`group relative rounded-xl border flex flex-col bg-[#141624] transition-all duration-200 select-none overflow-hidden ${
                    isSelected
                      ? "border-emerald-500 ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-950/20"
                      : isDragOver
                      ? "border-emerald-400 scale-[1.02] shadow-xl"
                      : "border-[#25293e] hover:border-[#3a4060]"
                  } ${isDragged ? "opacity-40" : "opacity-100"}`}
                >
                  {/* Top Bar on Thumbnail Card */}
                  <div className="p-2 flex items-center justify-between bg-[#10121d]/90 border-b border-[#202438]">
                    {/* Current Page Number */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-gray-100">
                        P.{index + 1}
                      </span>
                      {isFromSecondaryPdf && (
                        <span
                          className="text-[9px] px-1 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/40 truncate max-w-[70px]"
                          title={`Added from: ${page.sourceFilename}`}
                        >
                          + {page.sourceFilename}
                        </span>
                      )}
                    </div>

                    {/* Selection Checkbox */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectPage(page.instanceId);
                      }}
                      className="text-gray-400 hover:text-emerald-400 transition"
                      title={isSelected ? "Deselect page" : "Select page"}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-500 hover:text-gray-300" />
                      )}
                    </button>
                  </div>

                  {/* Thumbnail Image Container */}
                  <div
                    onClick={() => toggleSelectPage(page.instanceId)}
                    className="relative flex-1 p-2 flex items-center justify-center bg-[#0d0e17] cursor-pointer min-h-[160px] overflow-hidden"
                  >
                    <div
                      className="transition-transform duration-200 max-h-[160px] flex items-center justify-center"
                      style={{
                        transform: `rotate(${page.rotation}deg)`,
                      }}
                    >
                      <img
                        src={page.thumbnail}
                        alt={`Page ${index + 1}`}
                        loading="lazy"
                        className="max-h-[145px] max-w-full object-contain rounded shadow-sm pointer-events-none"
                      />
                    </div>

                    {/* Original page reference tag */}
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[9px] text-gray-400">
                      Orig p.{page.originalPageNumber}
                    </div>
                  </div>

                  {/* Card Action Controls Footer */}
                  <div className="p-1.5 bg-[#10121d] border-t border-[#1e2236] flex items-center justify-between text-gray-400">
                    {/* Quick Move Left / Start */}
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePage(index, 0);
                        }}
                        disabled={index === 0}
                        className="p-1 rounded hover:bg-[#1f2336] hover:text-gray-200 disabled:opacity-20 transition"
                        title="Move to Beginning"
                      >
                        <ChevronsLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePage(index, index - 1);
                        }}
                        disabled={index === 0}
                        className="p-1 rounded hover:bg-[#1f2336] hover:text-gray-200 disabled:opacity-20 transition"
                        title="Move Left"
                      >
                        <MoveLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Rotate & Delete */}
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          rotatePage(index);
                        }}
                        className="p-1 rounded hover:bg-[#1f2336] hover:text-emerald-400 text-gray-400 transition"
                        title="Rotate 90° Clockwise"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSinglePage(index);
                        }}
                        className="p-1 rounded hover:bg-rose-950/40 hover:text-rose-400 text-gray-500 transition"
                        title="Delete Page"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Quick Move Right / End */}
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePage(index, index + 1);
                        }}
                        disabled={index === items.length - 1}
                        className="p-1 rounded hover:bg-[#1f2336] hover:text-gray-200 disabled:opacity-20 transition"
                        title="Move Right"
                      >
                        <MoveRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePage(index, items.length - 1);
                        }}
                        disabled={index === items.length - 1}
                        className="p-1 rounded hover:bg-[#1f2336] hover:text-gray-200 disabled:opacity-20 transition"
                        title="Move to End"
                      >
                        <ChevronsRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Export Options & Button */}
          <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-5 space-y-4 shadow-lg">
            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
              Export Configuration
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-300">
                  Export Filename:
                </label>
                <input
                  type="text"
                  value={outputFilename}
                  onChange={(e) => setOutputFilename(e.target.value)}
                  placeholder="organized_document.pdf"
                  className="w-full px-3 py-2 text-xs rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-300">
                  Output Directory (Optional):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customOutputDir}
                    onChange={(e) => setCustomOutputDir(e.target.value)}
                    placeholder={systemStatus?.paths?.default_output_dir || "Temporary downloads directory"}
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  />
                  {systemStatus?.paths?.default_output_dir && (
                    <button
                      type="button"
                      onClick={() => onOpenFolder(systemStatus.paths.default_output_dir)}
                      className="px-3 py-2 rounded-xl bg-[#181a28] hover:bg-[#202438] border border-[#2c3048] text-gray-300 text-xs flex items-center gap-1 transition"
                      title="Reveal in Explorer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#1e2133]">
              <div className="text-xs text-gray-400">
                <span>Output will contain </span>
                <span className="font-semibold text-emerald-400">{items.length}</span>
                <span> pages assembled with pristine vector quality.</span>
              </div>

              <button
                onClick={handleExport}
                disabled={isExporting || items.length === 0}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 transition shrink-0"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Compiling PDF...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Export PDF</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Operation Error</p>
            <p className="mt-0.5 text-rose-300/90">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Result Card */}
      {result && (
        <div className="pt-4 border-t border-[#222538] space-y-3">
          <h4 className="font-semibold text-sm text-gray-200">Export Result</h4>
          <ResultCard result={result} onOpenExplorer={onOpenFolder} />
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#141624] border border-[#2a2e46] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-800/50 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-gray-100">Delete Selected Pages</h4>
                <p className="text-xs text-gray-400">Confirm page deletion</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Are you sure you want to delete <span className="font-bold text-rose-400">{selectedIds.size}</span> selected page(s)? You can undo this change anytime before exporting.
            </p>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl bg-[#1b1e2e] hover:bg-[#23273c] text-gray-300 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteSelected}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium shadow-lg shadow-rose-950/40 transition"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reset Order Confirmation */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#141624] border border-[#2a2e46] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-800/50 flex items-center justify-center">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-gray-100">Reset Document Order</h4>
                <p className="text-xs text-gray-400">Discard custom arrangement</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Reset all pages back to the original order from when this PDF was first uploaded?
            </p>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-xl bg-[#1b1e2e] hover:bg-[#23273c] text-gray-300 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmReset}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow-lg shadow-amber-950/40 transition"
              >
                Reset Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Change Document Confirmation */}
      {showChangeDocConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#141624] border border-[#2a2e46] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-800/50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-sm text-gray-100">Unsaved Changes</h4>
                <p className="text-xs text-gray-400">Confirm document switch</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              You have unsaved changes in your current page arrangement. Loading a new PDF will discard these changes.
            </p>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => {
                  setShowChangeDocConfirm(false);
                  setPendingFile(null);
                }}
                className="px-4 py-2 rounded-xl bg-[#1b1e2e] hover:bg-[#23273c] text-gray-300 text-xs font-medium transition"
              >
                Keep Current
              </button>
              <button
                onClick={() => {
                  setShowChangeDocConfirm(false);
                  if (pendingFile) {
                    handleUploadMain(pendingFile);
                    setPendingFile(null);
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow-lg shadow-amber-950/40 transition"
              >
                Discard & Upload New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Pages from Another PDF */}
      {showAddPdfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] rounded-3xl bg-[#141624] border border-[#2a2e46] p-6 flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-[#23273c] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-950/60 border border-indigo-700/50 text-indigo-400 flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-gray-100">Add Pages from Another PDF</h4>
                  <p className="text-xs text-gray-400">Select and insert pages from an additional document</p>
                </div>
              </div>

              <button
                onClick={() => setShowAddPdfModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#202438] text-gray-400 hover:text-gray-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              {/* File selector if no file loaded */}
              {!addPdfData && !isUploadingAddPdf && (
                <div
                  onClick={() => addPdfInputRef.current?.click()}
                  className="border-2 border-dashed border-[#282d44] hover:border-indigo-500/60 rounded-2xl p-8 text-center cursor-pointer bg-[#10121d]/50 hover:bg-[#141724]/70 transition group"
                >
                  <input
                    ref={addPdfInputRef}
                    type="file"
                    accept=".pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadAddPdf(f);
                    }}
                    className="hidden"
                  />
                  <UploadCloud className="w-8 h-8 text-indigo-400 mx-auto mb-2 group-hover:scale-105 transition" />
                  <p className="text-xs font-semibold text-gray-200">
                    Click to select an additional PDF
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Its pages will be rendered so you can choose which to include
                  </p>
                </div>
              )}

              {/* Uploading progress indicator */}
              {isUploadingAddPdf && (
                <div className="p-8 text-center space-y-2">
                  <Loader2 className="w-7 h-7 text-indigo-400 animate-spin mx-auto" />
                  <p className="text-xs text-gray-300">Loading additional PDF pages...</p>
                </div>
              )}

              {/* Pages Grid in Modal */}
              {addPdfData && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-gray-200">{addPdfData.filename}</span>
                      <span className="text-gray-400">({addPdfData.total_pages} pages)</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setAddPdfSelectedIndices(new Set(addPdfData.pages.map((p) => p.page_index)))
                        }
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        Select All
                      </button>
                      <span className="text-gray-600">|</span>
                      <button
                        onClick={() => setAddPdfSelectedIndices(new Set())}
                        className="text-[11px] text-gray-400 hover:text-gray-300 font-medium"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  {/* Thumbnail selection grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-60 overflow-y-auto p-1">
                    {addPdfData.pages.map((p) => {
                      const isSel = addPdfSelectedIndices.has(p.page_index);
                      return (
                        <div
                          key={p.page_index}
                          onClick={() => {
                            const next = new Set(addPdfSelectedIndices);
                            if (next.has(p.page_index)) {
                              next.delete(p.page_index);
                            } else {
                              next.add(p.page_index);
                            }
                            setAddPdfSelectedIndices(next);
                          }}
                          className={`relative rounded-xl border p-1.5 bg-[#0f111a] cursor-pointer transition select-none flex flex-col items-center ${
                            isSel
                              ? "border-indigo-500 ring-2 ring-indigo-500/30"
                              : "border-[#23273c] hover:border-[#383d5a]"
                          }`}
                        >
                          <div className="w-full flex items-center justify-between text-[10px] pb-1 border-b border-[#1b1e2e] mb-1">
                            <span className="font-bold text-gray-200">Page {p.page_number}</span>
                            {isSel ? (
                              <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                            ) : (
                              <Square className="w-3.5 h-3.5 text-gray-500" />
                            )}
                          </div>
                          <img
                            src={p.thumbnail}
                            alt={`Page ${p.page_number}`}
                            className="max-h-24 object-contain rounded"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Insertion Destination Selection */}
                  <div className="p-3.5 rounded-xl bg-[#0f111a] border border-[#23273c] space-y-2.5">
                    <label className="text-xs font-semibold text-gray-300">
                      Where should these pages be inserted in your document?
                    </label>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: "end", label: "At End" },
                        { id: "start", label: "At Beginning" },
                        { id: "after", label: "After Page" },
                        { id: "before", label: "Before Page" },
                      ].map((pos) => (
                        <button
                          key={pos.id}
                          type="button"
                          onClick={() => setInsertPlacement(pos.id as any)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                            insertPlacement === pos.id
                              ? "bg-indigo-950/60 border-indigo-500 text-indigo-200"
                              : "bg-[#141624] border-[#25293e] text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>

                    {(insertPlacement === "after" || insertPlacement === "before") && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-xs text-gray-400">
                          Target Page in Main Document:
                        </span>
                        <select
                          value={insertTargetIndex}
                          onChange={(e) => setInsertTargetIndex(Number(e.target.value))}
                          className="px-2.5 py-1 text-xs rounded-lg bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-indigo-500"
                        >
                          {items.map((_, i) => (
                            <option key={i} value={i}>
                              Page {i + 1}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-[#23273c] flex items-center justify-between shrink-0">
              <div className="text-xs text-gray-400">
                {addPdfData ? (
                  <span>
                    <strong className="text-indigo-300">{addPdfSelectedIndices.size}</strong> of {addPdfData.total_pages} pages selected
                  </span>
                ) : null}
              </div>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddPdfModal(false)}
                  className="px-4 py-2 rounded-xl bg-[#1b1e2e] hover:bg-[#23273c] text-gray-300 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!addPdfData || addPdfSelectedIndices.size === 0}
                  onClick={handleInsertAddPdfPages}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium shadow-lg shadow-indigo-950/40 transition"
                >
                  Insert Selected Pages
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
