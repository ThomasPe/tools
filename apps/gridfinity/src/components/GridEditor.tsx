import React from 'react';
import type { GridCell } from '../types';
import { GRID_SIZE } from '../geometry/gridfinity';
import { Grid, Sparkles, Trash2 } from 'lucide-react';

interface GridEditorProps {
  cells: GridCell[];
  onChange: (cells: GridCell[]) => void;
  gridRows?: number;
  gridCols?: number;
}

export const GridEditor: React.FC<GridEditorProps> = ({
  cells,
  onChange,
  gridRows = 5,
  gridCols = 5,
}) => {
  const isCellActive = (x: number, y: number) => {
    return cells.some(c => c.x === x && c.y === y);
  };

  const toggleCell = (x: number, y: number) => {
    if (isCellActive(x, y)) {
      if (cells.length === 1) return; // Prevent 0 cells
      onChange(cells.filter(c => !(c.x === x && c.y === y)));
    } else {
      onChange([...cells, { x, y }]);
    }
  };

  // Presets
  const applyPreset = (preset: string) => {
    switch (preset) {
      case '1x1':
        onChange([{ x: 2, y: 2 }]);
        break;
      case '1x2':
        onChange([{ x: 2, y: 1 }, { x: 2, y: 2 }]);
        break;
      case '2x2':
        onChange([
          { x: 1, y: 1 }, { x: 2, y: 1 },
          { x: 1, y: 2 }, { x: 2, y: 2 }
        ]);
        break;
      case '2x2-L':
        // L-shape
        onChange([
          { x: 1, y: 1 }, { x: 1, y: 2 },
          { x: 2, y: 2 }
        ]);
        break;
      case '3x2-T':
        // T-shape
        onChange([
          { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
          { x: 2, y: 2 }
        ]);
        break;
      case '3x3-U':
        // U-shape
        onChange([
          { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 },
          { x: 2, y: 3 },
          { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }
        ]);
        break;
      case 'clear':
        onChange([{ x: 2, y: 2 }]);
        break;
    }
  };

  // Calculate footprint metrics
  const minX = cells.length ? Math.min(...cells.map(c => c.x)) : 0;
  const maxX = cells.length ? Math.max(...cells.map(c => c.x)) : 0;
  const minY = cells.length ? Math.min(...cells.map(c => c.y)) : 0;
  const maxY = cells.length ? Math.max(...cells.map(c => c.y)) : 0;
  const widthMm = (maxX - minX + 1) * GRID_SIZE;
  const depthMm = (maxY - minY + 1) * GRID_SIZE;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Grid className="w-5 h-5 text-sky-400" />
          <h3 className="font-semibold text-sm text-slate-100 uppercase tracking-wider">
            Grid Footprint (42mm Tiles)
          </h3>
        </div>
        <span className="text-xs bg-sky-950/80 text-sky-300 font-mono px-2 py-0.5 rounded border border-sky-800/80">
          {cells.length} {cells.length === 1 ? 'tile' : 'tiles'} ({widthMm} × {depthMm} mm)
        </span>
      </div>

      {/* Preset Buttons */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => applyPreset('1x1')}
          className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
        >
          1×1
        </button>
        <button
          onClick={() => applyPreset('1x2')}
          className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
        >
          1×2
        </button>
        <button
          onClick={() => applyPreset('2x2')}
          className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
        >
          2×2
        </button>
        <button
          onClick={() => applyPreset('2x2-L')}
          className="text-xs px-2 py-1 bg-sky-950/70 hover:bg-sky-900/70 text-sky-200 border border-sky-800/60 rounded flex items-center gap-1 transition"
        >
          <Sparkles className="w-3 h-3 text-sky-400" /> L-Shape
        </button>
        <button
          onClick={() => applyPreset('3x2-T')}
          className="text-xs px-2 py-1 bg-sky-950/70 hover:bg-sky-900/70 text-sky-200 border border-sky-800/60 rounded flex items-center gap-1 transition"
        >
          <Sparkles className="w-3 h-3 text-sky-400" /> T-Shape
        </button>
        <button
          onClick={() => applyPreset('3x3-U')}
          className="text-xs px-2 py-1 bg-sky-950/70 hover:bg-sky-900/70 text-sky-200 border border-sky-800/60 rounded flex items-center gap-1 transition"
        >
          <Sparkles className="w-3 h-3 text-sky-400" /> U-Shape
        </button>
        <button
          onClick={() => applyPreset('clear')}
          title="Reset to 1x1"
          className="text-xs px-2 py-1 bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-300 rounded ml-auto transition"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* 2D Clickable Matrix */}
      <div className="flex flex-col items-center p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/80 space-y-1.5">
        <span className="text-[10px] font-semibold text-slate-500 tracking-wider uppercase">▲ Back (Top)</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-500 uppercase -rotate-90 select-none">Left</span>
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
              width: '230px',
              height: '230px',
            }}
          >
            {Array.from({ length: gridRows }).map((_, y) =>
              Array.from({ length: gridCols }).map((_, x) => {
                const active = isCellActive(x, y);
                return (
                  <button
                    key={`${x}-${y}`}
                    onClick={() => toggleCell(x, y)}
                    className={`rounded-md transition-all flex items-center justify-center text-[10px] font-mono select-none ${
                      active
                        ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/30 border border-sky-300 scale-[0.98]'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-500 border border-slate-700/40'
                    }`}
                    title={`Cell (${x}, ${y}) - Click to toggle`}
                  >
                    {active ? '●' : ''}
                  </button>
                );
              })
            )}
          </div>
          <span className="text-[10px] font-semibold text-slate-500 uppercase rotate-90 select-none">Right</span>
        </div>
        <span className="text-[10px] font-semibold text-slate-500 tracking-wider uppercase">▼ Front (Bottom)</span>
      </div>
      <p className="text-[11px] text-slate-400 mt-2 text-center">
        Click squares to design custom shapes (L, T, U, rectangles).
      </p>
    </div>
  );
};
