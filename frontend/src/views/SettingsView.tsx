import React, { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Save,
  Folder,
  Trash2,
  CheckCircle2,
  Sliders,
  HardDrive
} from "lucide-react";
import type { AppSettings, SystemStatus } from "../api/client";
import { api } from "../api/client";

interface SettingsViewProps {
  systemStatus: SystemStatus | null;
  refreshStatus: () => void;
  onOpenFolder: (path: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  systemStatus,
  refreshStatus,
  onOpenFolder,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  useEffect(() => {
    if (systemStatus?.settings) {
      setSettings(systemStatus.settings);
    }
  }, [systemStatus]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setIsSaving(true);
    setSavedSuccess(false);

    try {
      await api.updateSettings(settings);
      setSavedSuccess(true);
      refreshStatus();
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save settings", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCleanupTemp = async () => {
    try {
      const res = await api.cleanupTemp();
      setCleanupMessage(`Cleaned up ${res.files_removed} temporary files.`);
      setTimeout(() => setCleanupMessage(null), 4000);
    } catch (err) {
      setCleanupMessage("Failed to cleanup temp files.");
    }
  };

  if (!settings) return null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-violet-600/20 text-violet-400 flex items-center justify-center">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-100">Application Settings</h2>
            <p className="text-xs text-gray-400">
              Configure local processing parameters, output paths, and external engine locations
            </p>
          </div>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-3 py-1.5 rounded-xl font-medium animate-fade-in">
            <CheckCircle2 className="w-4 h-4" /> Settings Saved!
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Output Directory Card */}
        <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#23273c]">
            <Folder className="w-4 h-4 text-violet-400" />
            <h3 className="font-semibold text-sm text-gray-200">Optional Output Folder</h3>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-300 font-medium">Custom Folder Path (Optional):</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Leave blank for direct browser downloads (recommended)"
                value={settings.default_output_dir}
                onChange={(e) => setSettings({ ...settings, default_output_dir: e.target.value })}
                className="flex-1 px-3 py-2 text-xs rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-violet-500 font-mono"
              />
              {settings.default_output_dir?.trim() ? (
                <button
                  type="button"
                  onClick={() => onOpenFolder(settings.default_output_dir)}
                  className="px-3 py-2 rounded-xl bg-[#1e2133] hover:bg-[#272b42] text-xs font-medium text-gray-300 border border-[#2c3048] transition whitespace-nowrap"
                >
                  Open in Explorer
                </button>
              ) : null}
            </div>
            <p className="text-[11px] text-gray-500">
              By default, File Convo does not save files to any fixed permanent directory. Converted files are downloaded directly via your browser prompt. If a directory is specified above, files will also be saved there.
            </p>
          </div>
        </div>

        {/* Image Defaults Card */}
        <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#23273c]">
            <Sliders className="w-4 h-4 text-violet-400" />
            <h3 className="font-semibold text-sm text-gray-200">Image Conversion & Compression Defaults</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <label className="text-gray-300 font-medium">Default Image Format:</label>
              <select
                value={settings.default_image_format}
                onChange={(e) => setSettings({ ...settings, default_image_format: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500"
              >
                <option value="jpg">JPEG / JPG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
                <option value="pdf">PDF Document</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-gray-300 font-medium">
                Default Compression Quality: {settings.default_image_quality}%
              </label>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={settings.default_image_quality}
                onChange={(e) =>
                  setSettings({ ...settings, default_image_quality: parseInt(e.target.value) })
                }
                className="w-full accent-violet-500 cursor-pointer pt-2"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              id="settingsExif"
              checked={settings.preserve_exif}
              onChange={(e) => setSettings({ ...settings, preserve_exif: e.target.checked })}
              className="accent-violet-600 rounded cursor-pointer"
            />
            <label htmlFor="settingsExif" className="text-gray-300 cursor-pointer">
              Preserve camera EXIF metadata by default
            </label>
          </div>
        </div>

        {/* External Engines Configuration */}
        <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-[#23273c]">
            <HardDrive className="w-4 h-4 text-violet-400" />
            <h3 className="font-semibold text-sm text-gray-200">External Engines & Paths</h3>
          </div>

          <div className="space-y-4 text-xs">
            {/* LibreOffice Path */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-gray-300 font-medium">LibreOffice Executable Path (soffice.exe):</label>
                <span className="text-[11px] text-gray-400">
                  {systemStatus?.libreoffice?.installed ? "Auto-detected" : "Optional override"}
                </span>
              </div>
              <input
                type="text"
                placeholder={
                  systemStatus?.libreoffice?.path ||
                  "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
                }
                value={settings.libreoffice_path || ""}
                onChange={(e) =>
                  setSettings({ ...settings, libreoffice_path: e.target.value || null })
                }
                className="w-full px-3 py-2 rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500 font-mono text-xs"
              />
            </div>

            {/* Tesseract Path */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-gray-300 font-medium">Tesseract OCR Executable Path (tesseract.exe):</label>
                <span className="text-[11px] text-gray-400">
                  {systemStatus?.tesseract?.installed ? "Auto-detected" : "Optional override"}
                </span>
              </div>
              <input
                type="text"
                placeholder={
                  systemStatus?.tesseract?.path ||
                  "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
                }
                value={settings.tesseract_path || ""}
                onChange={(e) =>
                  setSettings({ ...settings, tesseract_path: e.target.value || null })
                }
                className="w-full px-3 py-2 rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500 font-mono text-xs"
              />
            </div>

            {/* Default OCR Language */}
            <div className="space-y-1.5">
              <label className="text-gray-300 font-medium">Default OCR Language:</label>
              <input
                type="text"
                value={settings.ocr_language}
                onChange={(e) => setSettings({ ...settings, ocr_language: e.target.value })}
                className="w-full sm:w-60 px-3 py-2 rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500 font-mono text-xs"
              />
              <p className="text-[11px] text-gray-500">e.g. 'eng', 'ben', or 'eng+ben'</p>
            </div>
          </div>
        </div>

        {/* Temporary Files & Maintenance */}
        <div className="rounded-2xl bg-[#131522] border border-[#23273c] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#23273c]">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-violet-400" />
              <h3 className="font-semibold text-sm text-gray-200">Temporary Files Maintenance</h3>
            </div>
            <button
              type="button"
              onClick={handleCleanupTemp}
              className="px-3 py-1.5 rounded-lg bg-[#1e2133] hover:bg-[#272b42] text-xs font-medium text-gray-300 border border-[#2c3048] transition"
            >
              Clean Temp Files Now
            </button>
          </div>

          {cleanupMessage && (
            <p className="text-xs text-emerald-400 bg-emerald-950/40 p-2.5 rounded-lg border border-emerald-800/30">
              {cleanupMessage}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <label className="text-gray-300 font-medium">Temp File Cleanup Policy:</label>
              <select
                value={settings.temp_cleanup_policy}
                onChange={(e) => setSettings({ ...settings, temp_cleanup_policy: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500"
              >
                <option value="auto">Automatic (Cleanup on startup)</option>
                <option value="immediate">Immediate (After every conversion)</option>
                <option value="never">Manual Only</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-gray-300 font-medium">Max File Size Allowed (MB):</label>
              <input
                type="number"
                value={settings.max_file_size_mb}
                onChange={(e) =>
                  setSettings({ ...settings, max_file_size_mb: parseInt(e.target.value) || 200 })
                }
                className="w-full px-3 py-2 rounded-xl bg-[#181a28] border border-[#2c3048] text-gray-200 focus:outline-none focus:border-violet-500 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-violet-900/30 transition"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? "Saving..." : "Save Preferences"}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
