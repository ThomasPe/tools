import type { BinConfig, GridCell, SmoothingConfig, ToolCutoutConfig } from '../types.ts';
import type { MeshArrays } from './meshUtils.ts';

/** Messages exchanged between the UI thread and the CSG worker. */

export type WorkerRequest =
  | { id: number; type: 'init'; wasmUrl: string }
  | { id: number; type: 'bin'; cells: GridCell[]; binConfig: BinConfig }
  | { id: number; type: 'smooth'; tool: MeshArrays; smoothing: SmoothingConfig }
  | { id: number; type: 'cutout'; cells: GridCell[]; binConfig: BinConfig; toolCutout: ToolCutoutConfig; tool: MeshArrays | null };

export type WorkerResponse =
  | { id: number; ok: true; type: 'init'; elapsed: number }
  | { id: number; ok: true; type: 'bin'; mesh: MeshArrays; elapsed: number }
  | { id: number; ok: true; type: 'smooth'; mesh: MeshArrays; elapsed: number }
  | { id: number; ok: true; type: 'cutout'; mesh: MeshArrays; triangles: number; elapsed: number }
  | { id: number; ok: false; error: string; fatal: boolean };
