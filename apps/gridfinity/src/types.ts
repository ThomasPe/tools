export interface GridCell {
  x: number;
  y: number;
}

export type LipType = 'none' | 'stackable';
export type InteriorMode = 'solid' | 'pocket';

export interface BinConfig {
  heightUnits: number; // 1U = 7mm
  customHeightMm?: number;
  useCustomHeight: boolean;
  magnetHoles: boolean;
  lipType: LipType;
  interiorMode: InteriorMode;
  floorThickness: number; // for pocket mode
}

export interface ToolTransform {
  position: [number, number, number]; // [x, y, z] in mm
  rotation: [number, number, number]; // [rx, ry, rz] in degrees
  scale: [number, number, number];    // [sx, sy, sz] multiplier (e.g. 1.02)
  uniformScale: boolean;
}

export type NotchPlacement = 'none' | 'left-right' | 'front-back' | 'all';

export interface NotchConfig {
  enabled: boolean;
  placement: NotchPlacement;
  radius: number; // in mm
  depth: number;  // in mm
}

export interface SmoothingConfig {
  enabled: boolean;
  tolerance: number; // in mm (e.g. 0.5 to 5.0 mm)
  surfaceIterations: number; // 0 to 5 iterations of surface relaxation
}

export interface ToolCutoutConfig {
  fileName: string | null;
  transform: ToolTransform;
  extrudeToTop: boolean;
  extrudeMode?: 'contour' | 'silhouette';
  notches: NotchConfig;
  smoothing: SmoothingConfig;
}

export interface MeshStats {
  triangles: number;
  vertices: number;
  dimensions: [number, number, number];
}

export interface AppProjectConfig {
  version: string;
  timestamp: string;
  cells: GridCell[];
  binConfig: BinConfig;
  toolCutoutConfig: ToolCutoutConfig;
}
