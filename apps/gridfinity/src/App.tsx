import { useEffect, useRef, useState, useTransition } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { AppProjectConfig, BinConfig, GridCell, ToolCutoutConfig } from './types';
import { getManifold, resetManifold } from './geometry/manifoldInit';
import {
  generateGridfinityBin,
  UNIT_HEIGHT,
  BASE_HEIGHT,
  type ManifoldModule
} from './geometry/gridfinity';
import {
  manifoldToThreeGeometry,
  threeGeometryToManifold,
  transformToolManifold,
  createExtrudeToTopCutter,
  createExtrudePreviewGeometry,
  createFingerNotches,
  createFingerNotchesThreeGeometry,
  getToolMatrix,
  computeToolWallClearance,
  exportManifoldToBinarySTL,
  applyToolSmoothing,
  laplacianSmoothGeometry,
  createSmoothedToolGeometry
} from './geometry/meshUtils';
import { createSampleToolGeometry } from './geometry/sampleTools';

import { GridEditor } from './components/GridEditor';
import { BinParameters } from './components/BinParameters';
import { ToolCutoutControls } from './components/ToolCutoutControls';
import { Viewport3D } from './components/Viewport3D';
import { ConfigModal } from './components/ConfigModal';

import { Download, Box, Layers, Wrench, RefreshCw, CheckCircle2, AlertCircle, FileJson, RotateCcw, ArrowLeft } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'gridfinity_tool_slot_config_v1';

const DEFAULT_CELLS: GridCell[] = [
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 2, y: 2 }
];

const DEFAULT_BIN_CONFIG: BinConfig = {
  heightUnits: 4, // 28mm
  customHeightMm: 28,
  useCustomHeight: false,
  magnetHoles: false, // magnets disabled by default
  lipType: 'none', // flush top for tool drawers
  interiorMode: 'solid', // solid block for cutout
  floorThickness: 5.0
};

const DEFAULT_TOOL_CUTOUT_CONFIG: ToolCutoutConfig = {
  fileName: 'sample-caliper.stl',
  transform: {
    position: [0, 0, 18],
    rotation: [0, 0, 0],
    scale: [1.02, 1.02, 1.02], // 102% clearance fit
    uniformScale: true
  },
  extrudeToTop: true, // Extrude to Top enabled by default for drop-in tool slot
  extrudeMode: 'contour', // 3D contoured cradle by default
  notches: {
    enabled: false,
    placement: 'left-right',
    radius: 8,
    depth: 12
  },
  smoothing: {
    enabled: false,
    tolerance: 2.0,
    surfaceIterations: 0
  }
};

function getStoredConfig(): AppProjectConfig | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to parse stored config from localStorage:', err);
  }
  return null;
}

export default function App() {
  // Manifold WASM state
  const [manifoldMod, setManifoldMod] = useState<ManifoldModule | null>(null);
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);

  // Stored configuration from localStorage (read once at mount)
  const storedConfig = useRef<AppProjectConfig | null>(getStoredConfig());

  // Config Export / Import Modal
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'grid' | 'bin' | 'tool'>('grid');

  // Grid Shape (default 2x2 L-shape or restored from localStorage)
  const [cells, setCells] = useState<GridCell[]>(() => {
    return (storedConfig.current?.cells && Array.isArray(storedConfig.current.cells) && storedConfig.current.cells.length > 0)
      ? storedConfig.current.cells
      : DEFAULT_CELLS;
  });

  // Bin Configuration
  const [binConfig, setBinConfig] = useState<BinConfig>(() => {
    return storedConfig.current?.binConfig
      ? { ...DEFAULT_BIN_CONFIG, ...storedConfig.current.binConfig }
      : DEFAULT_BIN_CONFIG;
  });

  // Tool Cutout Configuration (defaults or restored from localStorage)
  const [toolCutoutConfig, setToolCutoutConfig] = useState<ToolCutoutConfig>(() => {
    if (storedConfig.current?.toolCutoutConfig) {
      return {
        ...DEFAULT_TOOL_CUTOUT_CONFIG,
        ...storedConfig.current.toolCutoutConfig,
        transform: {
          ...DEFAULT_TOOL_CUTOUT_CONFIG.transform,
          ...(storedConfig.current.toolCutoutConfig.transform || {})
        },
        notches: {
          ...DEFAULT_TOOL_CUTOUT_CONFIG.notches,
          ...(storedConfig.current.toolCutoutConfig.notches || {})
        },
        smoothing: {
          ...DEFAULT_TOOL_CUTOUT_CONFIG.smoothing,
          ...(storedConfig.current.toolCutoutConfig.smoothing || {})
        }
      };
    }
    return DEFAULT_TOOL_CUTOUT_CONFIG;
  });

  // Three.js Geometries
  const [binGeometry, setBinGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [rawToolGeometry, setRawToolGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [displayToolGeometry, setDisplayToolGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [csgGeometry, setCsgGeometry] = useState<THREE.BufferGeometry | null>(null);

  // Status & Computation
  const [isPreviewCSG, setIsPreviewCSG] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [computeTime, setComputeTime] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Initializing Manifold3D WASM...');
  const computeTimeoutRef = useRef<any>(null);

  const [, startTransition] = useTransition();

  // Save latest configuration to localStorage so it remembers after page reload
  useEffect(() => {
    try {
      const configToStore: AppProjectConfig = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        cells,
        binConfig,
        toolCutoutConfig
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(configToStore));
    } catch (e) {
      console.warn('Failed to save config to localStorage:', e);
    }
  }, [cells, binConfig, toolCutoutConfig]);

  // 1. Initialize Manifold WASM on mount
  useEffect(() => {
    getManifold()
      .then(mod => {
        setManifoldMod(mod);
        setIsWasmReady(true);
        setStatusMessage('Manifold3D WASM initialized successfully');

        // Check if saved configuration had a specific sample tool
        const savedName = storedConfig.current?.toolCutoutConfig?.fileName;
        let sampleType: 'caliper' | 'wrench' | 'hexbit' | 'bracket' = 'caliper';
        if (savedName?.includes('wrench')) sampleType = 'wrench';
        else if (savedName?.includes('hex')) sampleType = 'hexbit';
        else if (savedName?.includes('bracket') || savedName?.includes('mounting')) sampleType = 'bracket';

        const initialToolGeo = createSampleToolGeometry(sampleType);
        setRawToolGeometry(initialToolGeo);
        setDisplayToolGeometry(initialToolGeo.clone());

        if (storedConfig.current) {
          setStatusMessage(`Restored saved config (${storedConfig.current.cells.length} tiles, ${storedConfig.current.binConfig.heightUnits}U)`);
        }
      })
      .catch(err => {
        console.error('Failed to init Manifold:', err);
        setWasmError(err.message || 'WASM initialization error');
        setStatusMessage('Failed to initialize geometry engine');
      });
  }, []);

  // Compute display tool geometry with smoothing and hole defeaturing
  useEffect(() => {
    if (!rawToolGeometry) {
      setDisplayToolGeometry(null);
      return;
    }
    if (!toolCutoutConfig.smoothing?.enabled) {
      setDisplayToolGeometry(rawToolGeometry.clone());
      return;
    }

    const timer = setTimeout(() => {
      try {
        const smoothed = createSmoothedToolGeometry(
          manifoldMod,
          rawToolGeometry,
          toolCutoutConfig.smoothing
        );
        setDisplayToolGeometry(smoothed);
      } catch (err) {
        console.warn('Error creating smoothed preview:', err);
        setDisplayToolGeometry(rawToolGeometry.clone());
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [
    rawToolGeometry,
    toolCutoutConfig.smoothing?.enabled,
    toolCutoutConfig.smoothing?.tolerance,
    toolCutoutConfig.smoothing?.surfaceIterations,
    manifoldMod
  ]);

  // Current calculated bin height
  const calculatedBinHeight = binConfig.useCustomHeight && binConfig.customHeightMm
    ? binConfig.customHeightMm
    : binConfig.heightUnits * UNIT_HEIGHT;

  // 2. Recompute Bin Geometry whenever cells or binConfig change
  useEffect(() => {
    if (!manifoldMod || !isWasmReady || cells.length === 0) return;

    try {
      const t0 = performance.now();
      const binSolid = generateGridfinityBin(manifoldMod, cells, binConfig);
      const geo = manifoldToThreeGeometry(binSolid);
      binSolid.delete();
      setBinGeometry(geo);
      const t1 = performance.now();
      setComputeTime(Math.round(t1 - t0));
    } catch (err: any) {
      console.error('Error generating bin solid:', err);
    }
  }, [manifoldMod, isWasmReady, cells, binConfig]);

  // 3. Compute CSG Boolean Difference (Bin - Transformed Tool - Notches)
  const computeCSG = () => {
    if (!manifoldMod || !isWasmReady || !rawToolGeometry || cells.length === 0) return;

    if (computeTimeoutRef.current) {
      clearTimeout(computeTimeoutRef.current);
    }

    setIsComputing(true);
    setStatusMessage('Computing watertight boolean difference...');

    computeTimeoutRef.current = setTimeout(async () => {
      let binSolid: any = null;
      let toolSolid: any = null;
      let cutter: any = null;
      let resultSolid: any = null;
      try {
        const t0 = performance.now();
        // 1. Generate bin solid
        binSolid = generateGridfinityBin(manifoldMod, cells, binConfig);

        // 2. Prepare tool geometry (surface relaxation if requested)
        let baseGeom = rawToolGeometry;
        if (toolCutoutConfig.smoothing?.enabled && toolCutoutConfig.smoothing.surfaceIterations > 0) {
          baseGeom = laplacianSmoothGeometry(rawToolGeometry, toolCutoutConfig.smoothing.surfaceIterations);
        }

        // threeGeometryToManifold applies high-density auto-decimation if > 90k triangles and smoothing is disabled
        toolSolid = threeGeometryToManifold(manifoldMod, baseGeom, toolCutoutConfig.smoothing?.enabled ? 0 : 90000);

        // 3. Apply defeaturing / screw-hole elimination if enabled
        if (toolCutoutConfig.smoothing?.enabled) {
          const smoothed = applyToolSmoothing(toolSolid, toolCutoutConfig.smoothing);
          if (smoothed !== toolSolid) {
            toolSolid.delete();
            toolSolid = smoothed;
          }
        }

        // 4. Apply scale, rotation, translation
        cutter = transformToolManifold(toolSolid, toolCutoutConfig.transform);
        toolSolid.delete();
        toolSolid = null;

        // 5. Undercut removal (extrude upwards to bin top)
        if (toolCutoutConfig.extrudeToTop) {
          cutter = createExtrudeToTopCutter(
            manifoldMod,
            cutter,
            calculatedBinHeight,
            toolCutoutConfig.extrudeMode || 'contour'
          );
        }

        // 6. Finger notches
        if (toolCutoutConfig.notches.enabled) {
          const cutterBounds = cutter.boundingBox();
          const notchesSolid = createFingerNotches(
            manifoldMod,
            cutterBounds,
            calculatedBinHeight,
            toolCutoutConfig.notches
          );
          if (notchesSolid) {
            const merged = manifoldMod.Manifold.union([cutter, notchesSolid]);
            cutter.delete();
            notchesSolid.delete();
            cutter = merged;
          }
        }

        // 7. Boolean Difference
        resultSolid = manifoldMod.Manifold.difference(binSolid, cutter);
        binSolid.delete();
        binSolid = null;
        cutter.delete();
        cutter = null;

        const resultGeo = manifoldToThreeGeometry(resultSolid);
        const triCount = resultSolid.getMesh().numTri;
        resultSolid.delete();
        resultSolid = null;

        setCsgGeometry(resultGeo);
        const elapsed = Math.round(performance.now() - t0);
        setComputeTime(elapsed);
        setStatusMessage(`Cutout computed in ${elapsed}ms (${triCount} triangles)`);
      } catch (err: any) {
        console.error('CSG Boolean computation failed:', err);
        const errMsg = err?.message || String(err);
        setStatusMessage(`CSG Error: ${errMsg}`);

        // If WebAssembly crashed (e.g. table index is out of bounds or memory trap),
        // re-initialize the WASM engine automatically so the application recovers gracefully!
        if (errMsg.includes('bounds') || errMsg.includes('RuntimeError') || errMsg.includes('unreachable') || errMsg.includes('memory')) {
          console.warn('WASM runtime exception detected. Reinitializing geometry engine...');
          resetManifold();
          try {
            const freshMod = await getManifold();
            setManifoldMod(freshMod);
            setStatusMessage('Recovered geometry engine from memory limit. High-density meshes automatically optimized.');
          } catch (reinitErr) {
            console.error('Failed to reinitialize WASM engine:', reinitErr);
          }
        }
      } finally {
        if (binSolid) try { binSolid.delete(); } catch {}
        if (toolSolid) try { toolSolid.delete(); } catch {}
        if (cutter) try { cutter.delete(); } catch {}
        if (resultSolid) try { resultSolid.delete(); } catch {}
        setIsComputing(false);
      }
    }, 20);
  };

  // Recompute CSG if preview is active and parameters changed
  useEffect(() => {
    if (isPreviewCSG) {
      computeCSG();
    }
  }, [isPreviewCSG, cells, binConfig, toolCutoutConfig, rawToolGeometry]);

  // Handle STL file upload
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const contents = e.target?.result as ArrayBuffer;
        const loader = new STLLoader();
        const parsed = loader.parse(contents);
        const geometry = parsed.index ? parsed : BufferGeometryUtils.mergeVertices(parsed, 1e-4);

        // Center raw geometry at origin
        geometry.center();
        geometry.computeVertexNormals();

        setRawToolGeometry(geometry);
        setDisplayToolGeometry(geometry.clone());
        setToolCutoutConfig(prev => ({
          ...prev,
          fileName: file.name,
          transform: {
            ...prev.transform,
            position: [0, 0, Math.max(10, calculatedBinHeight - 10)]
          }
        }));
        setStatusMessage(`Loaded ${file.name} (${geometry.attributes.position.count / 3} triangles)`);
      } catch (err: any) {
        alert('Failed to parse STL file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Handle loading sample tool
  const handleLoadSample = (sample: 'caliper' | 'wrench' | 'hexbit' | 'bracket') => {
    const geo = createSampleToolGeometry(sample);
    geo.center();
    geo.computeVertexNormals();

    const names = {
      caliper: 'sample-caliper-jaw.stl',
      wrench: 'sample-wrench.stl',
      hexbit: 'sample-hex-bit.stl',
      bracket: 'sample-mounting-bracket.stl'
    };

    setRawToolGeometry(geo);
    setDisplayToolGeometry(geo.clone());
    setToolCutoutConfig(prev => ({
      ...prev,
      fileName: names[sample],
      transform: {
        ...prev.transform,
        position: [0, 0, Math.max(10, calculatedBinHeight - 8)]
      }
    }));
    setStatusMessage(`Loaded ${names[sample]}`);
  };

  // Helper: Center tool on current bin
  const handleCenterTool = () => {
    setToolCutoutConfig(prev => ({
      ...prev,
      transform: {
        ...prev.transform,
        position: [0, 0, prev.transform.position[2]]
      }
    }));
  };

  // Helper: Put tool cutout at the lowest possible position without breaking the bottom floor
  const handleDropToFloor = () => {
    const activeGeo = displayToolGeometry || rawToolGeometry;
    if (!activeGeo) return;

    const pos = activeGeo.attributes.position?.array;
    if (!pos || pos.length === 0) return;

    // Minimum safe floor height:
    // Base is 4.75mm with magnet sockets up to 2.5mm.
    // If pocket mode, use binConfig.floorThickness.
    // If solid mode, safe floor is BASE_HEIGHT + 1.25mm = 6.0mm (ensures solid bottom without punching through base)
    const safeFloorZ = binConfig.interiorMode === 'pocket'
      ? Math.max(BASE_HEIGHT + 1.0, binConfig.floorThickness || 5.0)
      : BASE_HEIGHT + 1.25; // 6.0 mm

    const [rx, ry, rz] = toolCutoutConfig.transform.rotation;
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      'XYZ'
    );
    const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);
    const e = rotMat.elements;

    const sx = toolCutoutConfig.transform.scale[0];
    const sy = toolCutoutConfig.transform.uniformScale ? sx : toolCutoutConfig.transform.scale[1];
    const sz = toolCutoutConfig.transform.uniformScale ? sx : toolCutoutConfig.transform.scale[2];

    // Find the minimum rotated and scaled Z coordinate across all vertices
    let minRotZ = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const vx = pos[i] * sx;
      const vy = pos[i + 1] * sy;
      const vz = pos[i + 2] * sz;
      // 3rd row of rotation matrix: e[2], e[6], e[10]
      const rotZ = e[2] * vx + e[6] * vy + e[10] * vz;
      if (rotZ < minRotZ) minRotZ = rotZ;
    }

    if (minRotZ === Infinity) return;

    // Target Z position places lowest vertex exactly at safeFloorZ
    const targetTz = Math.round((safeFloorZ - minRotZ) * 10) / 10;

    setToolCutoutConfig(prev => ({
      ...prev,
      transform: {
        ...prev.transform,
        position: [prev.transform.position[0], prev.transform.position[1], targetTz]
      }
    }));

    setStatusMessage(`Placed tool at lowest safe position (Z = ${targetTz.toFixed(1)}mm, floor = ${safeFloorZ.toFixed(1)}mm)`);
  };

  // Handle binary STL export
  const handleExportSTL = () => {
    if (!manifoldMod || !isWasmReady || cells.length === 0) return;

    setIsComputing(true);
    setStatusMessage('Generating watertight binary STL for 3D printing...');

    setTimeout(() => {
      let binSolid: any = null;
      let toolSolid: any = null;
      let cutter: any = null;
      let finalSolid: any = null;
      try {
        binSolid = generateGridfinityBin(manifoldMod, cells, binConfig);
        finalSolid = binSolid;

        if (rawToolGeometry) {
          let baseGeom = rawToolGeometry;
          if (toolCutoutConfig.smoothing?.enabled && toolCutoutConfig.smoothing.surfaceIterations > 0) {
            baseGeom = laplacianSmoothGeometry(rawToolGeometry, toolCutoutConfig.smoothing.surfaceIterations);
          }

          toolSolid = threeGeometryToManifold(manifoldMod, baseGeom, toolCutoutConfig.smoothing?.enabled ? 0 : 90000);

          if (toolCutoutConfig.smoothing?.enabled) {
            const smoothed = applyToolSmoothing(toolSolid, toolCutoutConfig.smoothing);
            if (smoothed !== toolSolid) {
              toolSolid.delete();
              toolSolid = smoothed;
            }
          }

          cutter = transformToolManifold(toolSolid, toolCutoutConfig.transform);
          toolSolid.delete();
          toolSolid = null;

          if (toolCutoutConfig.extrudeToTop) {
            cutter = createExtrudeToTopCutter(
              manifoldMod,
              cutter,
              calculatedBinHeight,
              toolCutoutConfig.extrudeMode || 'contour'
            );
          }

          if (toolCutoutConfig.notches.enabled) {
            const cutterBounds = cutter.boundingBox();
            const notchesSolid = createFingerNotches(
              manifoldMod,
              cutterBounds,
              calculatedBinHeight,
              toolCutoutConfig.notches
            );
            if (notchesSolid) {
              const merged = manifoldMod.Manifold.union([cutter, notchesSolid]);
              cutter.delete();
              notchesSolid.delete();
              cutter = merged;
            }
          }

          finalSolid = manifoldMod.Manifold.difference(binSolid, cutter);
          binSolid.delete();
          binSolid = null;
          cutter.delete();
          cutter = null;
        }

        const filename = `gridfinity-${cells.length}tiles-${calculatedBinHeight.toFixed(0)}mm-custom-slot.stl`;
        exportManifoldToBinarySTL(finalSolid, filename);
        finalSolid.delete();
        finalSolid = null;
        setStatusMessage(`Exported ${filename} successfully!`);
      } catch (err: any) {
        console.error('Export failed:', err);
        alert('Export failed: ' + err.message);
      } finally {
        if (binSolid) try { binSolid.delete(); } catch {}
        if (toolSolid) try { toolSolid.delete(); } catch {}
        if (cutter) try { cutter.delete(); } catch {}
        if (finalSolid) try { finalSolid.delete(); } catch {}
        setIsComputing(false);
      }
    }, 50);
  };

  // Calculate tool notches geometry, upward extrusion preview geometry, and accurate polyomino wall clearance
  let notchesGeometry: THREE.BufferGeometry | null = null;
  let extrudePreviewGeometry: THREE.BufferGeometry | null = null;
  let wallClearance: number | null = null;
  const activeToolGeom = displayToolGeometry || rawToolGeometry;

  if (activeToolGeom) {
    if (toolCutoutConfig.extrudeToTop) {
      extrudePreviewGeometry = createExtrudePreviewGeometry(
        activeToolGeom,
        toolCutoutConfig.transform,
        calculatedBinHeight
      );
    }

    if (toolCutoutConfig.notches.enabled) {
      activeToolGeom.computeBoundingBox();
      const rawBox = activeToolGeom.boundingBox;
      if (rawBox) {
        const mat = getToolMatrix(toolCutoutConfig.transform);
        const transformedBox = rawBox.clone().applyMatrix4(mat);
        notchesGeometry = createFingerNotchesThreeGeometry(
          {
            min: [transformedBox.min.x, transformedBox.min.y, transformedBox.min.z],
            max: [transformedBox.max.x, transformedBox.max.y, transformedBox.max.z]
          },
          calculatedBinHeight,
          toolCutoutConfig.notches
        );
      }
    }

    // Precise, polyomino-aware wall clearance (sampled vertices inside bin, sub-millisecond)
    wallClearance = computeToolWallClearance(
      activeToolGeom,
      toolCutoutConfig.transform,
      cells,
      calculatedBinHeight,
      toolCutoutConfig.notches
    );
  }

  const currentProjectConfig: AppProjectConfig = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    cells,
    binConfig,
    toolCutoutConfig
  };

  const handleApplyConfig = (loaded: AppProjectConfig) => {
    if (loaded.cells && loaded.cells.length > 0) {
      setCells(loaded.cells);
    }
    if (loaded.binConfig) {
      setBinConfig(loaded.binConfig);
    }
    if (loaded.toolCutoutConfig) {
      setToolCutoutConfig({
        ...loaded.toolCutoutConfig,
        extrudeMode: loaded.toolCutoutConfig.extrudeMode ?? 'contour',
        smoothing: loaded.toolCutoutConfig.smoothing ?? {
          enabled: false,
          tolerance: 2.0,
          surfaceIterations: 0
        }
      });
    }
    setStatusMessage('Configuration restored successfully');
  };

  // Reset all parameters, grid layout, and tool positioning to default settings
  const handleResetToDefaults = () => {
    if (window.confirm('Reset all parameters, grid layout, and tool positioning to default settings?')) {
      try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
      setCells(DEFAULT_CELLS);
      setBinConfig(DEFAULT_BIN_CONFIG);
      setToolCutoutConfig(DEFAULT_TOOL_CUTOUT_CONFIG);
      const initialToolGeo = createSampleToolGeometry('caliper');
      setRawToolGeometry(initialToolGeo);
      setDisplayToolGeometry(initialToolGeo.clone());
      setCsgGeometry(null);
      setStatusMessage('Configuration reset to defaults');
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Left Sidebar Control Panel */}
      <div className="w-[420px] max-w-full h-full flex flex-col bg-slate-900 border-r border-slate-800 z-10 shadow-2xl">
        {/* App Title & Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div>
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              <Box className="w-5 h-5 text-indigo-400" />
              <span>Gridfinity Tool Slot Studio</span>
            </h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Custom polyomino bins & STL cutout generator
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <a
              href="../"
              title="Return to In-Browser Web Tools Hub"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-xs font-medium transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Hub</span>
            </a>
            <button
              onClick={handleResetToDefaults}
              title="Reset configuration to default settings"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800/80 text-slate-300 border border-slate-700 text-xs font-medium transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
            <button
              onClick={() => setIsConfigModalOpen(true)}
              title="Export / Import Configuration"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-700/60 text-xs font-medium transition cursor-pointer"
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>Config</span>
            </button>
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-950/80 border border-emerald-800/80 text-[10px] text-emerald-300 font-mono">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>WASM</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 border-b border-slate-800 bg-slate-950/40 p-1 gap-1 text-xs">
          <button
            onClick={() => setActiveTab('grid')}
            className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition ${
              activeTab === 'grid'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>1. Grid Shape</span>
          </button>
          <button
            onClick={() => setActiveTab('bin')}
            className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition ${
              activeTab === 'bin'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>2. Bin Height</span>
          </button>
          <button
            onClick={() => setActiveTab('tool')}
            className={`py-2 px-3 rounded-lg font-medium flex items-center justify-center gap-1.5 transition ${
              activeTab === 'tool'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>3. Tool Cutout</span>
          </button>
        </div>

        {/* Tab Content Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {activeTab === 'grid' && (
            <GridEditor
              cells={cells}
              onChange={newCells => startTransition(() => setCells(newCells))}
            />
          )}

          {activeTab === 'bin' && (
            <BinParameters
              config={binConfig}
              onChange={newConfig => setBinConfig(newConfig)}
            />
          )}

          {activeTab === 'tool' && (
            <ToolCutoutControls
              config={toolCutoutConfig}
              onChange={newConfig => setToolCutoutConfig(newConfig)}
              onFileUpload={handleFileUpload}
              onLoadSample={handleLoadSample}
              onCenterTool={handleCenterTool}
              onDropToFloor={handleDropToFloor}
              binHeight={calculatedBinHeight}
              wallClearance={wallClearance}
            />
          )}
        </div>

        {/* Sidebar Footer with Export Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 space-y-2">
          {/* Status Message */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span className="truncate max-w-[260px]">{statusMessage}</span>
            {computeTime !== null && (
              <span className="text-emerald-400 font-semibold">{computeTime}ms</span>
            )}
          </div>

          {/* Export Watertight STL Button */}
          <button
            onClick={handleExportSTL}
            disabled={isComputing || !isWasmReady}
            className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-semibold rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 text-sm transition cursor-pointer"
          >
            {isComputing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>Export Watertight STL</span>
          </button>
        </div>
      </div>

      {/* Center 3D Viewport */}
      <div className="flex-1 h-full relative">
        {wasmError ? (
          <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2">
            <AlertCircle className="w-8 h-8" />
            <div className="font-semibold">Engine Initialization Error</div>
            <div className="text-xs text-slate-400">{wasmError}</div>
          </div>
        ) : (
          <Viewport3D
            binGeometry={binGeometry}
            toolGeometry={displayToolGeometry || rawToolGeometry}
            csgGeometry={csgGeometry}
            notchesGeometry={notchesGeometry}
            extrudePreviewGeometry={extrudePreviewGeometry}
            isPreviewCSG={isPreviewCSG}
            onTogglePreviewCSG={setIsPreviewCSG}
            toolTransform={toolCutoutConfig.transform}
            onTransformChange={newTransform => {
              setToolCutoutConfig(prev => ({
                ...prev,
                transform: newTransform
              }));
            }}
            isComputing={isComputing}
          />
        )}
      </div>

      {/* Configuration Modal */}
      <ConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        config={currentProjectConfig}
        onApplyConfig={handleApplyConfig}
        onResetDefaults={handleResetToDefaults}
      />
    </div>
  );
}
