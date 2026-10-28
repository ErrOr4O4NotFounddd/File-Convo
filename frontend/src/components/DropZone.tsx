import React, { useRef, useState } from "react";
import {
  UploadCloud,
  File,
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
  Folder,
  RotateCcw
} from "lucide-react";

interface DropZoneProps {
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  accept?: string;
  multiple?: boolean;
  title?: string;
  hint?: string;
  allowReorder?: boolean;
  customOutputDir?: string;
  setCustomOutputDir?: (dir: string) => void;
  defaultOutputDir?: string;
}

export const DropZone: React.FC<DropZoneProps> = ({
  files,
  setFiles,
  accept,
  multiple = true,
  title = "Drop files here or click to browse",
  hint,
  allowReorder = false,
  customOutputDir,
  setCustomOutputDir,
  defaultOutputDir,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (multiple) {
        setFiles((prev) => [...prev, ...droppedFiles]);
      } else {
        setFiles([droppedFiles[0]]);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      if (multiple) {
        setFiles((prev) => [...prev, ...selected]);
      } else {
        setFiles([selected[0]]);
      }
      e.target.value = "";
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const moveDown = (index: number) => {
    if (index === files.length - 1) return;
    setFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  return (
    <div className="space-y-4">
      {/* Drag & Drop Area */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
          isDragOver
            ? "border-violet-500 bg-violet-600/10 scale-[1.01]"
            : "border-[#2c3046] hover:border-violet-500/50 bg-[#141622]/60 hover:bg-[#181b2b]/60"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileChange}
          className="hidden"
        />

        <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-b from-violet-600/20 to-indigo-600/20 border border-violet-500/30 flex items-center justify-center mb-3">
          <UploadCloud className="w-7 h-7 text-violet-400 animate-pulse" />
        </div>

        <h3 className="text-base font-semibold text-gray-200">{title}</h3>
        <p className="text-xs text-gray-400 mt-1">
          {hint || (multiple ? "Select one or multiple files" : "Select a single file")}
        </p>

        <div className="mt-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-violet-950/60 text-violet-300 border border-violet-800/40">
            Browse files
          </span>
        </div>
      </div>

      {/* Save Mode Indicator & Optional Custom Output Folder */}
      {setCustomOutputDir && (
        <div className="p-3 rounded-xl bg-[#131520] border border-[#222538] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <Folder className="w-4 h-4 text-violet-400 shrink-0" />
            <span className="text-gray-300 font-medium">Output:</span>
            <span className="text-gray-400 font-mono truncate max-w-xs sm:max-w-md">
              {customOutputDir || defaultOutputDir || "Direct Browser Download (Prompted on completion)"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Save directly to folder (optional)"
              value={customOutputDir || ""}
              onChange={(e) => setCustomOutputDir(e.target.value)}
              className="px-2.5 py-1 text-xs rounded bg-[#1a1c2b] border border-[#2c3046] text-gray-200 focus:outline-none focus:border-violet-500 w-52"
            />
            {customOutputDir && (
              <button
                type="button"
                onClick={() => setCustomOutputDir("")}
                className="p-1 rounded text-gray-400 hover:text-gray-200"
                title="Reset to browser download"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Selected Files Queue */}
      {files.length > 0 && (
        <div className="rounded-xl bg-[#141622] border border-[#24283d] p-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#24283d] mb-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-gray-200">Selected Files</span>
              <span className="px-2 py-0.5 rounded-full text-xs bg-violet-950/80 text-violet-300 border border-violet-800/40">
                {files.length}
              </span>
            </div>
            <button
              onClick={() => setFiles([])}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 transition"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear All
            </button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {files.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center justify-between p-2.5 rounded-lg bg-[#181a28] border border-[#272b40] hover:border-[#353a54] transition text-xs"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {allowReorder && (
                    <div className="flex flex-col gap-0.5 text-gray-500">
                      <button
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        className="hover:text-violet-400 disabled:opacity-20 transition"
                        title="Move Up"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveDown(idx)}
                        disabled={idx === files.length - 1}
                        className="hover:text-violet-400 disabled:opacity-20 transition"
                        title="Move Down"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="w-7 h-7 rounded bg-violet-600/20 text-violet-400 flex items-center justify-center shrink-0">
                    <File className="w-3.5 h-3.5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-200 truncate">{file.name}</p>
                    <p className="text-[11px] text-gray-400">{formatSize(file.size)}</p>
                  </div>
                </div>

                <button
                  onClick={() => removeFile(idx)}
                  className="p-1 rounded text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition ml-2"
                  title="Remove file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
