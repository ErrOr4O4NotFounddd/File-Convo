import React, { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import type { NavTab } from "./components/Sidebar";
import { DashboardView } from "./views/DashboardView";
import { DocumentsView } from "./views/DocumentsView";
import { ImagesView } from "./views/ImagesView";
import { ScannerView } from "./views/ScannerView";
import { PdfToolsView } from "./views/PdfToolsView";
import { ArchivesView } from "./views/ArchivesView";
import { PdfToWordView } from "./views/PdfToWordView";
import { OcrView } from "./views/OcrView";
import { SettingsView } from "./views/SettingsView";
import type { SystemStatus } from "./api/client";
import { api } from "./api/client";
import type { PdfSubTool } from "./views/PdfToolsView";
import { Shield, Check } from "lucide-react";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [activePdfSubTool, setActivePdfSubTool] = useState<PdfSubTool>("organize");
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleNavigate = (tab: NavTab, subTool?: string) => {
    setActiveTab(tab);
    if (tab === "pdf" && subTool) {
      setActivePdfSubTool(subTool as PdfSubTool);
    }
  };

  const fetchSystemStatus = async () => {
    try {
      const status = await api.getSystemStatus();
      setSystemStatus(status);
    } catch (err) {
      console.error("Backend not reachable yet", err);
    }
  };

  useEffect(() => {
    fetchSystemStatus();
  }, []);

  const handleOpenFolder = async (targetPath: string) => {
    try {
      await api.openInExplorer(targetPath);
      setToastMessage(`Revealed in Windows Explorer`);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setToastMessage(`Error: ${err.message || "Failed to open folder"}`);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  return (
    <div className="flex h-screen bg-[#0c0d12] text-gray-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        systemStatus={systemStatus}
        onOpenFolder={handleOpenFolder}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header Bar */}
        <header className="h-16 border-b border-[#1c1f30] bg-[#10121b]/80 backdrop-blur-md px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold capitalize text-gray-200">
              {activeTab.replace("-", " ")}
            </h2>
            <span className="text-gray-600">/</span>
            <span className="text-xs text-gray-400">File Convo</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Privacy and Security badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#181a28] border border-[#262a42] text-[11px] text-gray-300">
              <Shield className="w-3.5 h-3.5 text-violet-400" />
              <span>Private & Secure</span>
            </div>
          </div>
        </header>

        {/* Scrollable View Area */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8">
          {activeTab === "dashboard" && (
            <DashboardView
              systemStatus={systemStatus}
              setActiveTab={handleNavigate}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {activeTab === "documents" && (
            <DocumentsView
              systemStatus={systemStatus}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {activeTab === "images" && (
            <ImagesView
              systemStatus={systemStatus}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {activeTab === "scanner" && (
            <ScannerView
              systemStatus={systemStatus}
              onOpenFolder={handleOpenFolder}
            />
          )}


          {activeTab === "pdf" && (
            <PdfToolsView
              systemStatus={systemStatus}
              onOpenFolder={handleOpenFolder}
              initialSubTool={activePdfSubTool}
            />
          )}

          {activeTab === "archives" && (
            <ArchivesView
              systemStatus={systemStatus}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {activeTab === "pdf-to-word" && (
            <PdfToWordView
              systemStatus={systemStatus}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {activeTab === "ocr" && (
            <OcrView
              systemStatus={systemStatus}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {activeTab === "settings" && (
            <SettingsView
              systemStatus={systemStatus}
              refreshStatus={fetchSystemStatus}
              onOpenFolder={handleOpenFolder}
            />
          )}
        </div>
      </main>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-950 border border-violet-800/60 text-violet-200 text-xs shadow-2xl shadow-violet-950/80 animate-bounce">
          <Check className="w-4 h-4 text-violet-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default App;
