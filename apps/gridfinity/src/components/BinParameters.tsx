import React from 'react';
import type { BinConfig } from '../types';
import { Layers, Magnet, Box, Shield } from 'lucide-react';
import { UNIT_HEIGHT } from '../geometry/gridfinity';

interface BinParametersProps {
  config: BinConfig;
  onChange: (config: BinConfig) => void;
}

export const BinParameters: React.FC<BinParametersProps> = ({ config, onChange }) => {
  const calculatedHeight = config.useCustomHeight
    ? config.customHeightMm || 28
    : config.heightUnits * UNIT_HEIGHT;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-emerald-400" />
          <h3 className="font-semibold text-sm text-slate-100 uppercase tracking-wider">
            Bin Dimensions & Profile
          </h3>
        </div>
        <span className="text-xs font-mono bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
          Height: {calculatedHeight.toFixed(1)} mm
        </span>
      </div>

      {/* Height Mode Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label className="text-slate-300 font-medium">Height Specification</label>
          <div className="flex items-center gap-2 bg-slate-950 p-0.5 rounded border border-slate-800">
            <button
              onClick={() => onChange({ ...config, useCustomHeight: false })}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                !config.useCustomHeight
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Units (7mm U)
            </button>
            <button
              onClick={() => onChange({ ...config, useCustomHeight: true })}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                config.useCustomHeight
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Custom mm
            </button>
          </div>
        </div>

        {!config.useCustomHeight ? (
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Gridfinity Units</span>
              <span className="font-mono text-emerald-300 font-semibold">{config.heightUnits}U ({config.heightUnits * UNIT_HEIGHT}mm)</span>
            </div>
            <input
              type="range"
              min={2}
              max={12}
              step={1}
              value={config.heightUnits}
              onChange={e => onChange({ ...config, heightUnits: parseInt(e.target.value) || 3 })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
              <span>2U (14mm)</span>
              <span>4U (28mm)</span>
              <span>8U (56mm)</span>
              <span>12U (84mm)</span>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Exact Height</span>
              <span className="font-mono text-emerald-300 font-semibold">{config.customHeightMm} mm</span>
            </div>
            <input
              type="number"
              min={10}
              max={150}
              step={0.5}
              value={config.customHeightMm || 28}
              onChange={e => onChange({ ...config, customHeightMm: parseFloat(e.target.value) || 28 })}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm text-slate-100 font-mono focus:border-emerald-500 outline-none"
            />
          </div>
        )}
      </div>

      {/* Top Rim Style */}
      <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
        <label className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-slate-400" /> Top Rim Style
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChange({ ...config, lipType: 'none' })}
            className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition ${
              config.lipType === 'none'
                ? 'bg-slate-800 border-emerald-500 text-emerald-300'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="font-semibold">Flush Flat Top</div>
            <div className="text-[10px] text-slate-400 font-normal">Best for tool drawers</div>
          </button>
          <button
            onClick={() => onChange({ ...config, lipType: 'stackable' })}
            className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition ${
              config.lipType === 'stackable'
                ? 'bg-slate-800 border-emerald-500 text-emerald-300'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="font-semibold">Stackable Lip</div>
            <div className="text-[10px] text-slate-400 font-normal">Standard 4.4mm stacking rim</div>
          </button>
        </div>
      </div>

      {/* Containing Volume Mode */}
      <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
        <label className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
          <Box className="w-3.5 h-3.5 text-slate-400" /> Interior Body Mode
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChange({ ...config, interiorMode: 'solid' })}
            className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition ${
              config.interiorMode === 'solid'
                ? 'bg-slate-800 border-emerald-500 text-emerald-300'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="font-semibold">Solid Infill</div>
            <div className="text-[10px] text-slate-400 font-normal">Standard for tool cutouts</div>
          </button>
          <button
            onClick={() => onChange({ ...config, interiorMode: 'pocket' })}
            className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition ${
              config.interiorMode === 'pocket'
                ? 'bg-slate-800 border-emerald-500 text-emerald-300'
                : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className="font-semibold">Hollow Pocket</div>
            <div className="text-[10px] text-slate-400 font-normal">Hollow with floor</div>
          </button>
        </div>

        {config.interiorMode === 'pocket' && (
          <div className="pt-2">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Floor Thickness</span>
              <span className="font-mono text-emerald-300 font-semibold">{config.floorThickness} mm</span>
            </div>
            <input
              type="range"
              min={4.75}
              max={20}
              step={0.5}
              value={config.floorThickness}
              onChange={e => onChange({ ...config, floorThickness: parseFloat(e.target.value) || 5 })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        )}
      </div>

      {/* Magnet Sockets Toggle */}
      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Magnet className="w-4 h-4 text-slate-400" />
          <div>
            <div className="text-xs font-medium text-slate-200">Base Magnet Sockets</div>
            <div className="text-[10px] text-slate-400">4× 6.5mm × 2.4mm per base tile</div>
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.magnetHoles}
            onChange={e => onChange({ ...config, magnetHoles: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
        </label>
      </div>
    </div>
  );
};
