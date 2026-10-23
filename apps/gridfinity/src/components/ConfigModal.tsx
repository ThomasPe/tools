import React, { useState } from 'react';
import type { AppProjectConfig } from '../types';
import { Copy, Download, Upload, Check, X, FileJson, AlertCircle, RotateCcw } from 'lucide-react';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppProjectConfig;
  onApplyConfig: (config: AppProjectConfig) => void;
  onResetDefaults?: () => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onApplyConfig,
  onResetDefaults,
}) => {
  const [copied, setCopied] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const jsonString = JSON.stringify(config, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gridfinity-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleApplyPasted = () => {
    try {
      setError(null);
      const parsed = JSON.parse(pasteText.trim());
      if (!parsed.cells || !parsed.binConfig || !parsed.toolCutoutConfig) {
        throw new Error('Invalid configuration format: Missing required sections.');
      }
      onApplyConfig(parsed);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to parse JSON configuration');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          setError(null);
          const parsed = JSON.parse(event.target?.result as string);
          if (!parsed.cells || !parsed.binConfig || !parsed.toolCutoutConfig) {
            throw new Error('Invalid configuration file structure.');
          }
          onApplyConfig(parsed);
          onClose();
        } catch (err: any) {
          setError('Failed to load JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-sky-400" />
            <h2 className="text-sm font-bold text-white">Project Configuration (Export / Import)</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4">
          <p className="text-xs text-slate-400 leading-relaxed">
            Export your exact layout (polyomino grid, bin height, tool 3D coordinates, fit clearance, and notches) to plain text or a JSON file.
          </p>

          {/* Quick Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopy}
              className="py-2.5 px-3 bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-500/25 transition cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-950 font-bold" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied to Clipboard!' : 'Copy Config JSON'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download .json File</span>
            </button>
            {onResetDefaults && (
              <button
                onClick={() => {
                  onResetDefaults();
                  onClose();
                }}
                className="col-span-2 py-2 px-3 bg-slate-950/80 hover:bg-rose-950/50 text-rose-300 hover:text-rose-200 border border-rose-900/40 hover:border-rose-800/80 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                <span>Reset Configuration to Defaults</span>
              </button>
            )}
          </div>

          {/* JSON View */}
          <div className="space-y-1">
            <label className="text-[11px] text-slate-400 font-medium">Current Configuration Data</label>
            <textarea
              readOnly
              value={jsonString}
              className="w-full h-36 bg-slate-950 font-mono text-[11px] text-slate-300 p-2.5 rounded-lg border border-slate-800 outline-none resize-none selection:bg-sky-900"
            />
          </div>

          {/* Paste & Apply Section */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-200">Import Configuration</label>
              <label className="text-xs text-sky-400 hover:text-sky-300 cursor-pointer flex items-center gap-1 font-medium">
                <Upload className="w-3 h-3" />
                <span>Upload .json</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              placeholder="Paste JSON configuration text here..."
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              className="w-full h-24 bg-slate-950 font-mono text-[11px] text-slate-200 p-2.5 rounded-lg border border-slate-800 focus:border-sky-500 outline-none resize-none"
            />
            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/40 p-2 rounded border border-red-900/50">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button
              onClick={handleApplyPasted}
              disabled={!pasteText.trim()}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              Apply Pasted Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
