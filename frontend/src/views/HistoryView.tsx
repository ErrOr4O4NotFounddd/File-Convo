import React, { useState } from "react";
import {
  History,
  Trash2,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Search,
  Calendar,
  Download
} from "lucide-react";
import type { HistoryItem } from "../api/client";
import { api, downloadFile } from "../api/client";

interface HistoryViewProps {
  history: HistoryItem[];
  refreshHistory: () => void;
  onOpenFolder: (path: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  refreshHistory,
  onOpenFolder,
}) => {
  const [search, setSearch] = useState("");
  const [isClearing, setIsClearing] = useState(false);

  const handleClear = async () => {
    if (!window.confirm("Are you sure you want to clear your conversion history?")) return;
    setIsClearing(true);
    try {
      await api.clearHistory();
      refreshHistory();
    } catch (err) {
      console.error(err);
    } finally {
      setIsClearing(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      await api.deleteHistory(id);
      refreshHistory();
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = history.filter(
    (item) =>
      item.original_filename.toLowerCase().includes(search.toLowerCase()) ||
      item.conversion_type.toLowerCase().includes(search.toLowerCase()) ||
      (item.output_location && item.output_location.toLowerCase().includes(search.toLowerCase()))
  );

  const formatBytes = (bytes?: number): string => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-600/20 text-violet-400 flex items-center justify-center">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">Conversion History</h2>
            <p className="text-xs text-gray-400">
              Audit log of local conversion activities and generated output paths
            </p>
          </div>
        </div>

        {history.length > 0 && (
          <button
            onClick={handleClear}
            disabled={isClearing}
            className="px-3.5 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border border-rose-800/40 text-xs font-medium flex items-center gap-1.5 transition self-start sm:self-auto"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear History
          </button>
        )}
      </div>

      {/* Filter / Search Bar */}
      {history.length > 0 && (
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by filename or conversion type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl bg-[#141624] border border-[#282c44] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-violet-500 transition"
          />
        </div>
      )}

      {/* History Items List */}
      {history.length === 0 ? (
        <div className="rounded-2xl bg-[#131520] border border-[#222538] p-12 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-[#1c1f30] text-gray-500 flex items-center justify-center">
            <History className="w-6 h-6" />
          </div>
          <h3 className="font-semibold text-sm text-gray-200">No conversion history yet</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Conversions you perform locally will appear here with output locations and file size stats.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-[#131520] border border-[#222538] divide-y divide-[#1e2133] overflow-hidden">
          {filtered.map((item) => {
            const isSuccess = item.status === "success";
            const dateStr = new Date(item.timestamp).toLocaleString();
            const details = item.details || {};

            return (
              <div
                key={item.id}
                className="p-4 hover:bg-[#181a28] transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      isSuccess
                        ? "bg-emerald-950/70 text-emerald-400 border border-emerald-800/40"
                        : "bg-rose-950/70 text-rose-400 border border-rose-800/40"
                    }`}
                  >
                    {isSuccess ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-200 truncate">
                        {item.original_filename}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#202334] text-violet-300 border border-[#2d314a]">
                        {item.conversion_type}
                      </span>
                    </div>

                    {item.output_location && (
                      <p className="text-[11px] text-gray-400 font-mono truncate max-w-md">
                        {item.output_location}
                      </p>
                    )}

                    {item.error_message && (
                      <p className="text-[11px] text-rose-400 truncate max-w-md">
                        {item.error_message}
                      </p>
                    )}

                    {/* Stats summary */}
                    <div className="flex items-center gap-3 text-[10px] text-gray-500 pt-0.5">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {dateStr}
                      </span>
                      {details.output_size && (
                        <span>Size: {formatBytes(details.output_size)}</span>
                      )}
                      {details.percent_saved !== undefined && details.percent_saved > 0 && (
                        <span className="text-emerald-400 font-medium">
                          Saved {details.percent_saved}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {item.output_location && (
                    <button
                      onClick={() => {
                        const filename = item.output_location?.split(/[/\\]/).pop() || "download";
                        downloadFile(item.output_location!, filename);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600 text-violet-300 hover:text-white text-xs font-medium flex items-center gap-1.5 border border-violet-500/30 transition"
                      title="Download converted file"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                  )}

                  {item.output_location && (
                    <button
                      onClick={() => onOpenFolder(item.output_location!)}
                      className="p-1.5 rounded-lg bg-[#1e2133] hover:bg-[#272b42] text-gray-400 hover:text-gray-200 transition border border-[#2d314a]"
                      title="Reveal in File Explorer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDeleteEntry(item.id)}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                    title="Delete log entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
