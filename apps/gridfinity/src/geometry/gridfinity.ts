import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { BinConfig, GridCell } from '../types.ts';
import { withScope, type Scope } from './scope.ts';

// Standard Gridfinity constants (Zack Freedman spec)
export const GRID_SIZE = 42.0;       // Grid pitch in mm
export const TOLERANCE = 0.25;       // Clearance per side
export const CORNER_RADIUS = 3.75;   // Outer corner fillet radius in mm
export const BASE_HEIGHT = 4.75;     // Total base profile height
export const UNIT_HEIGHT = 7.0;      // 1U height = 7mm
export const LIP_HEIGHT = 4.4;       // Stacking lip height above the body
export const LIP_WALL = 2.0;         // Stacking lip wall thickness
export const MIN_BIN_HEIGHT = BASE_HEIGHT + 2;

/** The initialised manifold-3d module (what `Module()` resolves to after `setup()`). */
export type ManifoldModule = ManifoldToplevel;

/**
 * Total body height (base + walls) in mm, before any stacking lip.
 */
export function getBinBodyHeight(config: BinConfig): number {
  const requested = config.useCustomHeight && config.customHeightMm
    ? config.customHeightMm
    : config.heightUnits * UNIT_HEIGHT;
  return Math.max(MIN_BIN_HEIGHT, requested);
}

/**
 * Highest z of any bin material: body height plus the stacking lip when enabled.
 * Cutters that must open the bin from above have to reach at least this high.
 */
export function getBinTopZ(config: BinConfig): number {
  return getBinBodyHeight(config) + (config.lipType === 'stackable' ? LIP_HEIGHT : 0);
}

function roundedSquare(mod: ManifoldModule, scope: Scope, offset: number): CrossSection {
  const square = scope.track(mod.CrossSection.square([34, 34], true));
  return scope.track(square.offset(offset, 'Round', 2, 20));
}

/**
 * Creates a single 1x1 Gridfinity standard base solid at origin (centered at [0, 0, 0] to [0, 0, 4.75])
 */
export function create1x1Base(mod: ManifoldModule, magnetHoles: boolean): Manifold {
  return withScope(scope => {
    // Section 1: Z 0.0 to 0.8 mm (lower 45-degree chamfer)
    const s0 = scope.track(roundedSquare(mod, scope, 0.8).extrude(0.01));
    const s1 = scope.track(roundedSquare(mod, scope, 1.6).extrude(0.01).translate([0, 0, 0.8]));
    const chamfer1 = scope.track(mod.Manifold.hull([s0, s1]));

    // Section 2: Z 0.8 to 2.6 mm (straight vertical 1.8mm)
    const straight = scope.track(roundedSquare(mod, scope, 1.6).extrude(1.8).translate([0, 0, 0.8]));

    // Section 3: Z 2.6 to 4.75 mm (upper 45-degree chamfer, 2.15mm)
    const s2 = scope.track(roundedSquare(mod, scope, 1.6).extrude(0.01).translate([0, 0, 2.6]));
    const s3 = scope.track(roundedSquare(mod, scope, CORNER_RADIUS).extrude(0.01).translate([0, 0, BASE_HEIGHT]));
    const chamfer2 = scope.track(mod.Manifold.hull([s2, s3]));

    let base = scope.track(mod.Manifold.union([chamfer1, straight, chamfer2]));

    // Magnet holes: 4 holes at (+-13, +-13), dia 6.5mm, depth 2.5mm
    if (magnetHoles) {
      const holeRadius = 3.25;
      const holeDepth = 2.5;
      const holes: Manifold[] = [];
      for (const ox of [-13, 13]) {
        for (const oy of [-13, 13]) {
          holes.push(scope.track(
            mod.Manifold.cylinder(holeDepth, holeRadius, holeRadius, 24, false).translate([ox, oy, 0])
          ));
        }
      }
      const holesSolid = scope.track(mod.Manifold.union(holes));
      base = scope.track(mod.Manifold.difference(base, holesSolid));
    }

    return scope.release(base);
  });
}

/**
 * Calculates polyomino bounding box and centering offset
 */
export function getGridBounds(cells: GridCell[]) {
  if (cells.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 42, depth: 42, offsetX: 0, offsetY: 0 };
  }
  const minX = Math.min(...cells.map(c => c.x));
  const maxX = Math.max(...cells.map(c => c.x));
  const minY = Math.min(...cells.map(c => c.y));
  const maxY = Math.max(...cells.map(c => c.y));

  const countX = maxX - minX + 1;
  const countY = maxY - minY + 1;

  const width = countX * GRID_SIZE;
  const depth = countY * GRID_SIZE;

  // Center offset so polyomino is centered at (0, 0)
  const offsetX = (minX + maxX + 1) * (GRID_SIZE / 2);
  const offsetY = (minY + maxY + 1) * (GRID_SIZE / 2);

  return { minX, maxX, minY, maxY, width, depth, offsetX, offsetY };
}

/**
 * Generates the 2D cross-section of the bin body with 0.25mm outer margin and 3.75mm corner radius
 */
export function createPolyominoCrossSection(mod: ManifoldModule, cells: GridCell[], offsetX: number, offsetY: number): CrossSection {
  if (cells.length === 0) {
    return mod.CrossSection.square([GRID_SIZE - 2 * TOLERANCE, GRID_SIZE - 2 * TOLERANCE], true);
  }

  return withScope(scope => {
    // Create a 42x42 square for each cell shifted relative to center
    // Invert Y so that row index increasing downwards in 2D editor maps to -Y (front) in 3D
    const squares = cells.map(c => {
      const x0 = c.x * GRID_SIZE - offsetX;
      const y0 = offsetY - (c.y + 1) * GRID_SIZE;
      return scope.track(mod.CrossSection.square([GRID_SIZE, GRID_SIZE], false).translate([x0, y0]));
    });

    const polyUnion = scope.track(mod.CrossSection.union(squares));

    // Shrink by 4.0mm then round expand by 3.75mm -> net -0.25mm outer offset with R3.75mm fillet!
    const shrunken = scope.track(polyUnion.offset(-(CORNER_RADIUS + TOLERANCE), 'Miter'));
    return scope.release(shrunken.offset(CORNER_RADIUS, 'Round', 2, 24));
  });
}

/**
 * Generates the full solid Gridfinity bin with base tiles and body
 */
export function generateGridfinityBin(mod: ManifoldModule, cells: GridCell[], config: BinConfig): Manifold {
  if (cells.length === 0) {
    throw new Error('Please select at least one grid cell.');
  }

  return withScope(scope => {
    const { offsetX, offsetY } = getGridBounds(cells);
    const totalHeight = getBinBodyHeight(config);
    const bodyHeight = totalHeight - BASE_HEIGHT;

    // 1. Generate 1x1 Base units for all active cells
    const base1x1 = scope.track(create1x1Base(mod, config.magnetHoles));
    const bases = cells.map(c => {
      const cx = c.x * GRID_SIZE + (GRID_SIZE / 2) - offsetX;
      const cy = offsetY - (c.y + 0.5) * GRID_SIZE;
      return scope.track(base1x1.translate([cx, cy, 0]));
    });
    const allBases = bases.length === 1 ? bases[0] : scope.track(mod.Manifold.union(bases));

    // 2. Extrude the main body from Z = BASE_HEIGHT up to totalHeight
    const bodyCrossSection = scope.track(createPolyominoCrossSection(mod, cells, offsetX, offsetY));
    const bodySolid = scope.track(bodyCrossSection.extrude(bodyHeight).translate([0, 0, BASE_HEIGHT]));

    let binSolid = scope.track(mod.Manifold.union([allBases, bodySolid]));

    // 3. Stacking lip (optional): hollow ring of LIP_WALL thickness on top of the body
    if (config.lipType === 'stackable') {
      const lipSolid = scope.track(bodyCrossSection.extrude(LIP_HEIGHT).translate([0, 0, totalHeight]));
      const innerLipCS = scope.track(bodyCrossSection.offset(-LIP_WALL, 'Miter'));
      const innerLipCutter = scope.track(innerLipCS.extrude(LIP_HEIGHT + 1).translate([0, 0, totalHeight - 0.5]));
      const hollowLip = scope.track(mod.Manifold.difference(lipSolid, innerLipCutter));
      binSolid = scope.track(mod.Manifold.union([binSolid, hollowLip]));
    }

    // 4. Pocket mode (optional; for solid tool holders, interiorMode is usually 'solid')
    if (config.interiorMode === 'pocket') {
      const wallThick = 2.4;
      const floorThick = Math.max(BASE_HEIGHT, config.floorThickness || 5.0);
      const cavityDepth = totalHeight - floorThick;
      if (cavityDepth > 1.0) {
        const pocketCS = scope.track(bodyCrossSection.offset(-wallThick, 'Round', 2, 16));
        const pocketSolid = scope.track(pocketCS.extrude(cavityDepth + 5).translate([0, 0, floorThick]));
        binSolid = scope.track(mod.Manifold.difference(binSolid, pocketSolid));
      }
    }

    return scope.release(binSolid);
  });
}
