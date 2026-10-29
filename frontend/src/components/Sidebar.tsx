import React from "react";
import {
  LayoutDashboard,
  FileText,
  Image as ImageIcon,
  FileStack,
  Archive,
  FileType,
  ScanText,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  Camera
} from "lucide-react";
import type { SystemStatus } from "../api/client";

export type NavTab =
  | "dashboard"
  | "documents"
  | "images"
  | "scanner"
  | "pdf"
  | "archives"
  | "pdf-to-word"
  | "ocr"
  | "settings";

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  systemStatus: SystemStatus | null;
  onOpenFolder: (path: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  systemStatus,
  onOpenFolder,
}) => {
  const navItems: { id: NavTab; label: string; icon: React.ElementType; badge?: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "documents", label: "Document Converter", icon: FileText, badge: "P1" },
    { id: "images", label: "Image Tools", icon: ImageIcon, badge: "HEIC" },
    { id: "scanner", label: "Document Scanner", icon: Camera, badge: "NEW" },
    { id: "pdf", label: "PDF Tools", icon: FileStack, badge: "P1" },
    { id: "archives", label: "Archive Tools", icon: Archive, badge: "ZIP" },
    { id: "pdf-to-word", label: "PDF to Word", icon: FileType, badge: "P2" },
    { id: "ocr", label: "OCR & Extraction", icon: ScanText, badge: "P2" },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <aside
      className={`h-screen bg-[#11131c] border-r border-[#222538] flex flex-col transition-all duration-300 relative select-none ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-[#222538]">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-900/30">
              <FileStack className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base text-gray-100 tracking-tight">
                File Convo
              </h1>
              <p className="text-[11px] text-gray-400">File Conversion Suite</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-900/30">
            <FileStack className="w-5 h-5 text-white" />
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-[#1c1f2e] transition ${
            collapsed ? "hidden" : "block"
          }`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Collapse Toggle for Mini Mode */}
      {collapsed && (
        <div className="pt-2 flex justify-center">
          <button
            onClick={() => setCollapsed(false)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-[#1c1f2e] transition"
            title="Expand sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Links */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition group relative ${
                isActive
                  ? "bg-violet-600/20 text-violet-300 border border-violet-500/30 shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#181a27] border border-transparent"
              } ${collapsed ? "justify-center px-0" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={`w-5 h-5 transition-transform group-hover:scale-105 shrink-0 ${
                  isActive ? "text-violet-400" : "text-gray-400 group-hover:text-gray-200"
                }`}
              />
              {!collapsed && (
                <span className="flex-1 text-left truncate">{item.label}</span>
              )}
              {!collapsed && item.badge && (
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                    isActive
                      ? "bg-violet-500/30 text-violet-200"
                      : "bg-[#202334] text-gray-400"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Status & Optional Quick Open Output Folder */}
      <div className="p-3 border-t border-[#222538] bg-[#0d0e15] space-y-2">
        {!collapsed ? (
          <>
            {systemStatus?.paths?.default_output_dir?.trim() && (
              <button
                onClick={() => {
                  onOpenFolder(systemStatus.paths.default_output_dir);
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#181a27] hover:bg-[#202334] text-xs text-gray-300 border border-[#2b2f48] transition"
                title="Open Output Folder in Windows Explorer"
              >
                <span className="flex items-center gap-2 truncate">
                  <FolderOpen className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="truncate">Output Folder</span>
                </span>
                <span className="text-[10px] text-gray-500 uppercase">Open</span>
              </button>
            )}

            {/* Quick Dependency Status */}
            <div className="text-[11px] space-y-1 pt-1 text-gray-400">
              <div className="flex items-center justify-between">
                <span>LibreOffice:</span>
                {systemStatus?.libreoffice?.installed ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3 h-3" /> Ready
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3 h-3" /> Missing
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span>Tesseract OCR:</span>
                {systemStatus?.tesseract?.installed ? (
                  <span className="text-emerald-400 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3 h-3" /> Ready
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3 h-3" /> Missing
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          systemStatus?.paths?.default_output_dir?.trim() && (
            <button
              onClick={() => {
                onOpenFolder(systemStatus.paths.default_output_dir);
              }}
              className="w-full flex justify-center p-2 rounded-lg bg-[#181a28] hover:bg-[#202334] text-gray-400 hover:text-violet-400 transition"
              title="Open Output Folder in Explorer"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )
        )}
      </div>
    </aside>
  );
};
