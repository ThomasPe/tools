import React, { useRef } from 'react';
import type { ToolCutoutConfig, NotchPlacement } from '../types';
import { Upload, Wrench, Move, RotateCcw, Maximize2, Fingerprint, ArrowUpFromLine, ArrowDownToLine, Sparkles, Wand2 } from 'lucide-react';

interface ToolCutoutControlsProps {
  config: ToolCutoutConfig;
  onChange: (config: ToolCutoutConfig) => void;
  onFileUpload: (file: File) => void;
  onLoadSample: (sample: 'caliper' | 'wrench' | 'hexbit' | 'bracket') => void;
  onCenterTool: () => void;
  onDropToFloor: () => void;
  binHeight: number;
  wallClearance?: number | null;
}

export const ToolCutoutControls: React.FC<ToolCutoutControlsProps> = ({
  config,
  onChange,
  onFileUpload,
  onLoadSample,
  onCenterTool,
  onDropToFloor,
  wallClearance,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileUpload(file);
    }
  };

  const updatePos = (idx: 0 | 1 | 2, val: number) => {
    const newPos = [...config.transform.position] as [number, number, number];
    newPos[idx] = val;
    onChange({
      ...config,
      transform: { ...config.transform, position: newPos }
    });
  };

  const updateRot = (idx: 0 | 1 | 2, val: number) => {
    const newRot = [...config.transform.rotation] as [number, number, number];
    newRot[idx] = val;
    onChange({
      ...config,
      transform: { ...config.transform, rotation: newRot }
    });
  };

  const updateScale = (idx: 0 | 1 | 2, val: number) => {
    const newScale = [...config.transform.scale] as [number, number, number];
    newScale[idx] = val;
    onChange({
      ...config,
      transform: { ...config.transform, scale: newScale }
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-amber-400" />
          <h3 className="font-semibold text-sm text-slate-100 uppercase tracking-wider">
            Tool STL Cutout & Placement
          </h3>
        </div>
        {config.fileName && (
          <span className="text-xs font-mono bg-amber-950 text-amber-300 px-2 py-0.5 rounded border border-amber-800 max-w-[140px] truncate" title={config.fileName}>
            {config.fileName}
          </span>
        )}
      </div>

      {/* Wall Clearance Warning Badge */}
      {wallClearance !== null && wallClearance !== undefined && (
        <div className={`p-2 rounded-lg text-xs flex items-center justify-between border ${
          wallClearance < 0
            ? 'bg-red-950/70 border-red-800 text-red-300 animate-pulse'
            : wallClearance < 1.5
            ? 'bg-amber-950/70 border-amber-800 text-amber-300'
            : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
        }`}>
          <span className="font-semibold">
            {wallClearance < 0
              ? '⚠️ Breaches Bin Wall!'
              : wallClearance < 1.5
              ? '⚠️ Very Thin Wall'
              : '✅ Wall Clearance Safe'}
          </span>
          <span className="font-mono font-bold">
            {wallClearance < 0
              ? `${wallClearance.toFixed(1)} mm`
              : `+${wallClearance.toFixed(1)} mm`}
          </span>
        </div>
      )}

      {/* File Upload & Samples */}
      <div className="space-y-2">
        <input
          type="file"
          accept=".stl"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 py-2 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Tool STL</span>
          </button>

          {/* Sample Tools Dropdown */}
          <div className="relative group">
            <button
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-medium transition"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Load Sample Tool</span>
            </button>
            <div className="hidden group-hover:flex flex-col absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 overflow-hidden">
              <button
                onClick={() => onLoadSample('caliper')}
                className="px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-700 transition"
              >
                Digital Caliper Jaw
              </button>
              <button
                onClick={() => onLoadSample('wrench')}
                className="px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-700 transition"
              >
                Combination Wrench
              </button>
              <button
                onClick={() => onLoadSample('hexbit')}
                className="px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-700 transition"
              >
                1/4" Hex Screwdriver Bit
              </button>
              <button
                onClick={() => onLoadSample('bracket')}
                className="px-3 py-1.5 text-left text-xs text-amber-300 font-medium hover:bg-slate-700 transition border-t border-slate-700/60"
              >
                Mounting Bracket (with screw holes)
              </button>
            </div>
          </div>
        </div>

        {/* Quick Position Helper Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCenterTool}
            className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-medium transition"
            title="Center cutout horizontally (X=0, Y=0)"
          >
            Center on Bin
          </button>
          <button
            type="button"
            onClick={onDropToFloor}
            className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-slate-700/60 hover:border-amber-500/50 rounded text-[11px] font-medium transition flex items-center justify-center gap-1.5"
            title="Positions model at lowest possible position while preserving a solid floor (no puncture)"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span>Drop to Lowest Floor</span>
          </button>
        </div>
      </div>

      {/* Position Controls */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
          <span className="flex items-center gap-1.5">
            <Move className="w-3.5 h-3.5 text-slate-400" /> Position (X, Y, Z in mm)
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
            <div key={axis} className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>{axis}:</span>
                <span className="text-amber-300">{config.transform.position[i].toFixed(1)}</span>
              </div>
              <input
                type="number"
                step={0.5}
                value={config.transform.position[i]}
                onChange={e => updatePos(i as 0 | 1 | 2, parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono focus:border-amber-500 outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Rotation Controls */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
          <span className="flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" /> Rotation (deg)
          </span>
          <button
            onClick={() => onChange({ ...config, transform: { ...config.transform, rotation: [0, 0, 0] } })}
            className="text-[10px] text-slate-500 hover:text-slate-300"
          >
            Reset
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['Rx', 'Ry', 'Rz'] as const).map((axis, i) => (
            <div key={axis} className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>{axis}:</span>
                <span className="text-amber-300">{config.transform.rotation[i]}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={5}
                value={config.transform.rotation[i]}
                onChange={e => updateRot(i as 0 | 1 | 2, parseInt(e.target.value) || 0)}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Fit & Clearance Scaling */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between text-xs text-slate-300 font-medium">
          <span className="flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5 text-slate-400" /> Scale & Fit Clearance
          </span>
          <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={config.transform.uniformScale}
              onChange={e => onChange({
                ...config,
                transform: { ...config.transform, uniformScale: e.target.checked }
              })}
              className="accent-amber-500 rounded"
            />
            Uniform
          </label>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>Clearance Factor</span>
            <span className="font-mono text-amber-300 font-semibold">
              {(config.transform.scale[0] * 100).toFixed(1)}% (+{((config.transform.scale[0] - 1) * 100).toFixed(1)}%)
            </span>
          </div>
          <input
            type="range"
            min={0.95}
            max={1.15}
            step={0.005}
            value={config.transform.scale[0]}
            onChange={e => {
              const val = parseFloat(e.target.value) || 1.0;
              if (config.transform.uniformScale) {
                onChange({
                  ...config,
                  transform: { ...config.transform, scale: [val, val, val] }
                });
              } else {
                updateScale(0, val);
              }
            }}
            className="w-full accent-amber-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
            <span>100% (Exact)</span>
            <span className="text-amber-400 font-semibold">102% (Recommended 3D Fit)</span>
            <span>110% (Loose)</span>
          </div>
        </div>
      </div>

      {/* Vertical Insertion / Extrude to Top */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpFromLine className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-xs font-medium text-slate-200">Extrude to Top (Remove Undercuts)</div>
              <div className="text-[10px] text-slate-400">Sweeps slot upwards so tool drops in vertically</div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.extrudeToTop}
              onChange={e => onChange({ ...config, extrudeToTop: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>

        {config.extrudeToTop && (
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/60 rounded-lg border border-slate-800/60 text-xs">
            <button
              type="button"
              onClick={() => onChange({ ...config, extrudeMode: 'contour' })}
              title="Preserves the 3D bottom cradle while sweeping all undercuts vertically upward"
              className={`py-1.5 px-2 rounded-md font-medium text-center text-[11px] transition ${
                (config.extrudeMode ?? 'contour') === 'contour'
                  ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              3D Contoured Floor
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...config, extrudeMode: 'silhouette' })}
              title="Full 2.5D vertical silhouette punch with flat floor at tool bottom"
              className={`py-1.5 px-2 rounded-md font-medium text-center text-[11px] transition ${
                config.extrudeMode === 'silhouette'
                  ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              Flat Floor (2.5D)
            </button>
          </div>
        )}
      </div>

      {/* Smooth Bumps & Screw Holes (Defeaturing) */}
      <div className="space-y-3 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-xs font-medium text-slate-200">Smooth Bumps & Screw Holes</div>
              <div className="text-[10px] text-slate-400">Fills screw holes & scan bumps to prevent plastic posts</div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.smoothing?.enabled ?? false}
              onChange={e => onChange({
                ...config,
                smoothing: {
                  enabled: e.target.checked,
                  tolerance: config.smoothing?.tolerance ?? 2.0,
                  surfaceIterations: config.smoothing?.surfaceIterations ?? 0,
                }
              })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>

        {config.smoothing?.enabled && (
          <div className="space-y-3 pl-6 pt-1 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
            {/* Defeaturing Tolerance */}
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Hole & Bump Defeaturing</span>
                <span className="font-mono text-amber-300 font-semibold">
                  {(config.smoothing?.tolerance ?? 2.0).toFixed(1)} mm
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={5.0}
                step={0.5}
                value={config.smoothing?.tolerance ?? 2.0}
                onChange={e => onChange({
                  ...config,
                  smoothing: {
                    ...config.smoothing,
                    tolerance: parseFloat(e.target.value) || 2.0,
                    enabled: true,
                    surfaceIterations: config.smoothing?.surfaceIterations ?? 0,
                  }
                })}
                className="w-full accent-amber-500 cursor-pointer"
              />
              {/* Preset buttons */}
              <div className="grid grid-cols-3 gap-1 mt-1 text-[10px]">
                {[
                  { label: 'Subtle (1mm)', val: 1.0 },
                  { label: 'Standard (2mm)', val: 2.0 },
                  { label: 'Aggressive (4mm)', val: 4.0 },
                ].map(p => (
                  <button
                    key={p.val}
                    type="button"
                    onClick={() => onChange({
                      ...config,
                      smoothing: {
                        ...config.smoothing,
                        tolerance: p.val,
                        enabled: true,
                        surfaceIterations: config.smoothing?.surfaceIterations ?? 0,
                      }
                    })}
                    className={`py-1 px-1 rounded text-center border transition ${
                      Math.abs((config.smoothing?.tolerance ?? 2.0) - p.val) < 0.1
                        ? 'bg-amber-600/30 border-amber-500 text-amber-200 font-semibold'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div>{p.label}</div>
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Fills any cavity or hole smaller than this size so no plastic post sticks up in bin.
              </div>
            </div>

            {/* Surface Scan Smoothing (Laplacian Relaxation) */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Scan Surface Relaxation</span>
                <span className="font-mono text-amber-300 font-semibold">
                  {(config.smoothing?.surfaceIterations ?? 0) === 0 ? 'Off' : `${config.smoothing?.surfaceIterations} passes`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                step={1}
                value={config.smoothing?.surfaceIterations ?? 0}
                onChange={e => onChange({
                  ...config,
                  smoothing: {
                    ...config.smoothing,
                    surfaceIterations: parseInt(e.target.value) || 0,
                    enabled: true,
                    tolerance: config.smoothing?.tolerance ?? 2.0,
                  }
                })}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                <span>0 (Raw)</span>
                <span>2 (Gentle)</span>
                <span>5 (Very Smooth)</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                Relaxes rough scan triangulation ripples and facet noise.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Finger Pull Notches */}
      <div className="space-y-2 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-xs font-medium text-slate-200">Finger Pull Notches</div>
              <div className="text-[10px] text-slate-400">Ergonomic side cutouts to easily grab tool</div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.notches.enabled}
              onChange={e => onChange({
                ...config,
                notches: { ...config.notches, enabled: e.target.checked }
              })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
          </label>
        </div>

        {config.notches.enabled && (
          <div className="space-y-2 pl-6 pt-1">
            <div className="grid grid-cols-3 gap-1 text-[11px]">
              {(['left-right', 'front-back', 'all'] as NotchPlacement[]).map(p => (
                <button
                  key={p}
                  onClick={() => onChange({
                    ...config,
                    notches: { ...config.notches, placement: p }
                  })}
                  className={`py-1 px-1.5 rounded text-center capitalize border transition ${
                    config.notches.placement === p
                      ? 'bg-amber-600/30 border-amber-500 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {p.replace('-', ' ')}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Grip Radius: {config.notches.radius}mm</span>
              <input
                type="range"
                min={6}
                max={20}
                value={config.notches.radius}
                onChange={e => onChange({
                  ...config,
                  notches: { ...config.notches, radius: parseInt(e.target.value) || 10 }
                })}
                className="w-32 accent-amber-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
