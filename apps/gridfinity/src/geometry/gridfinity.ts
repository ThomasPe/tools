import type { BinConfig, GridCell } from '../types';

// Standard Gridfinity constants (Zack Freedman spec)
export const GRID_SIZE = 42.0;       // Grid pitch in mm
export const TOLERANCE = 0.25;       // Clearance per side
export const CORNER_RADIUS = 3.75;   // Outer corner fillet radius in mm
export const BASE_HEIGHT = 4.75;     // Total base profile height
export const UNIT_HEIGHT = 7.0;      // 1U height = 7mm

export interface ManifoldModule {
  CrossSection: any;
  Manifold: any;
  Mesh: any;
  fillrule?: any;
}

/**
 * Creates a single 1x1 Gridfinity standard base solid at origin (centered at [0, 0, 0] to [0, 0, 4.75])
 */
export function create1x1Base(mod: ManifoldModule, magnetHoles: boolean): any {
  // Section 1: Z 0.0 to 0.8 mm (lower 45-degree chamfer)
  const cs0 = mod.CrossSection.square([34, 34], true).offset(0.8, 'Round', 2, 20);
  const s0 = cs0.extrude(0.01).translate([0, 0, 0]);
  const cs1 = mod.CrossSection.square([34, 34], true).offset(1.6, 'Round', 2, 20);
  const s1 = cs1.extrude(0.01).translate([0, 0, 0.8]);
  const chamfer1 = mod.Manifold.hull(s0, s1);
  s0.delete(); s1.delete(); cs0.delete(); cs1.delete();

  // Section 2: Z 0.8 to 2.6 mm (straight vertical 1.8mm)
  const csStraight = mod.CrossSection.square([34, 34], true).offset(1.6, 'Round', 2, 20);
  const straight = csStraight.extrude(1.8).translate([0, 0, 0.8]);
  csStraight.delete();

  // Section 3: Z 2.6 to 4.75 mm (upper 45-degree chamfer, 2.15mm)
  const cs2 = mod.CrossSection.square([34, 34], true).offset(1.6, 'Round', 2, 20);
  const s2 = cs2.extrude(0.01).translate([0, 0, 2.6]);
  const cs3 = mod.CrossSection.square([34, 34], true).offset(3.75, 'Round', 2, 20);
  const s3 = cs3.extrude(0.01).translate([0, 0, 4.75]);
  const chamfer2 = mod.Manifold.hull(s2, s3);
  s2.delete(); s3.delete(); cs2.delete(); cs3.delete();

  let base = mod.Manifold.union([chamfer1, straight, chamfer2]);
  chamfer1.delete(); straight.delete(); chamfer2.delete();

  // Magnet holes: 4 holes at (+-13, +-13), dia 6.5mm, depth 2.4mm
  if (magnetHoles) {
    const holeRadius = 3.25;
    const holeDepth = 2.5;
    const holes: any[] = [];
    const offsets = [-13, 13];
    for (const ox of offsets) {
      for (const oy of offsets) {
        const cyl = mod.Manifold.cylinder(holeDepth, holeRadius, holeRadius, 24, false)
          .translate([ox, oy, 0]);
        holes.push(cyl);
      }
    }
    const holesSolid = mod.Manifold.union(holes);
    holes.forEach(h => h.delete());
    const drilled = mod.Manifold.difference(base, holesSolid);
    base.delete();
    holesSolid.delete();
    base = drilled;
  }

  return base;
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
export function createPolyominoCrossSection(mod: ManifoldModule, cells: GridCell[], offsetX: number, offsetY: number) {
  if (cells.length === 0) {
    return mod.CrossSection.square([GRID_SIZE - 2 * TOLERANCE, GRID_SIZE - 2 * TOLERANCE], true);
  }

  // Create a 42x42 square for each cell shifted relative to center
  // Invert Y so that row index increasing downwards in 2D editor maps to -Y (front) in 3D
  const squares = cells.map(c => {
    const x0 = c.x * GRID_SIZE - offsetX;
    const y0 = offsetY - (c.y + 1) * GRID_SIZE;
    return mod.CrossSection.square([GRID_SIZE, GRID_SIZE], false).translate([x0, y0]);
  });

  const polyUnion = mod.CrossSection.union(squares);
  squares.forEach(s => s.delete());

  // Shrink by 4.0mm then round expand by 3.75mm -> net -0.25mm outer offset with R3.75mm fillet!
  const shrunken = polyUnion.offset(-4.0, 'Miter');
  polyUnion.delete();
  const rounded = shrunken.offset(3.75, 'Round', 2, 24);
  shrunken.delete();
  return rounded;
}

/**
 * Generates the full solid Gridfinity bin with base tiles and body
 */
export function generateGridfinityBin(mod: ManifoldModule, cells: GridCell[], config: BinConfig): any {
  if (cells.length === 0) {
    throw new Error('Please select at least one grid cell.');
  }

  const { offsetX, offsetY } = getGridBounds(cells);
  const totalHeight = config.useCustomHeight && config.customHeightMm
    ? Math.max(BASE_HEIGHT + 2, config.customHeightMm)
    : Math.max(BASE_HEIGHT + 2, config.heightUnits * UNIT_HEIGHT);

  const bodyHeight = totalHeight - BASE_HEIGHT;

  // 1. Generate 1x1 Base units for all active cells
  const base1x1 = create1x1Base(mod, config.magnetHoles);
  const bases = cells.map(c => {
    const cx = c.x * GRID_SIZE + (GRID_SIZE / 2) - offsetX;
    const cy = offsetY - (c.y + 0.5) * GRID_SIZE;
    return base1x1.translate([cx, cy, 0]);
  });
  base1x1.delete();

  const allBases = bases.length === 1 ? bases[0] : mod.Manifold.union(bases);
  if (bases.length > 1) {
    bases.forEach(b => b.delete());
  }

  // 2. Extrude the main body from Z = BASE_HEIGHT up to totalHeight
  const bodyCrossSection = createPolyominoCrossSection(mod, cells, offsetX, offsetY);
  const bodySolid = bodyCrossSection.extrude(bodyHeight).translate([0, 0, BASE_HEIGHT]);

  let binSolid = mod.Manifold.union([allBases, bodySolid]);
  allBases.delete();
  bodySolid.delete();

  // 3. Stacking lip (optional)
  if (config.lipType === 'stackable') {
    // Top lip: 4.4mm height with inner chamfer
    const lipHeight = 4.4;
    // Outer lip: matches outer body
    const lipSolid = bodyCrossSection.extrude(lipHeight).translate([0, 0, totalHeight]);
    // Inner bevel cutter
    const innerLipCS = bodyCrossSection.offset(-2.0, 'Miter');
    const innerLipCutter = innerLipCS.extrude(lipHeight + 1).translate([0, 0, totalHeight - 0.5]);
    innerLipCS.delete();
    const hollowLip = mod.Manifold.difference(lipSolid, innerLipCutter);
    lipSolid.delete();
    innerLipCutter.delete();
    const withLip = mod.Manifold.union([binSolid, hollowLip]);
    binSolid.delete();
    hollowLip.delete();
    binSolid = withLip;
  }

  // 4. Pocket mode (optional; for solid tool holders, interiorMode is usually 'solid')
  if (config.interiorMode === 'pocket') {
    const wallThick = 2.4;
    const floorThick = Math.max(BASE_HEIGHT, config.floorThickness || 5.0);
    const cavityDepth = totalHeight - floorThick;
    if (cavityDepth > 1.0) {
      const pocketCS = bodyCrossSection.offset(-wallThick, 'Round', 2, 16);
      const pocketSolid = pocketCS.extrude(cavityDepth + 5).translate([0, 0, floorThick]);
      pocketCS.delete();
      const withPocket = mod.Manifold.difference(binSolid, pocketSolid);
      binSolid.delete();
      pocketSolid.delete();
      binSolid = withPocket;
    }
  }

  bodyCrossSection.delete();
  return binSolid;
}
