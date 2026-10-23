import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID_SIZE, TOLERANCE, getGridBounds, type ManifoldModule } from './gridfinity';
import type { GridCell, NotchConfig, SmoothingConfig, ToolTransform } from '../types';

/**
 * Converts a Manifold solid into a Three.js BufferGeometry with clean normals
 */
export function manifoldToThreeGeometry(manifold: any): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const geometry = new THREE.BufferGeometry();

  // Create clean detached typed array copies to decouple Three.js buffers from WASM heap
  const posCopy = new Float32Array(mesh.vertProperties);
  const indexCopy = new Uint32Array(mesh.triVerts);

  geometry.setAttribute('position', new THREE.BufferAttribute(posCopy, mesh.numProp));
  geometry.setIndex(new THREE.BufferAttribute(indexCopy, 1));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Converts a Three.js BufferGeometry (e.g. from an STL file) into a watertight Manifold
 */
export function threeGeometryToManifold(mod: ManifoldModule, geometry: THREE.BufferGeometry, maxTriangles = 90000): any {
  // Ensure the geometry is indexed and duplicate vertices merged within tolerance
  const merged = geometry.index ? geometry : BufferGeometryUtils.mergeVertices(geometry, 1e-4);

  if (!merged.index) {
    throw new Error('Failed to index geometry vertices.');
  }

  const positions = merged.attributes.position.array;
  const indices = merged.index.array;

  // Create clean standalone typed arrays without byteOffset aliasing
  const triVerts = new Uint32Array(indices.length);
  triVerts.set(indices);

  const vertProperties = new Float32Array(positions.length);
  vertProperties.set(positions);

  const mesh = new mod.Mesh({
    numProp: 3,
    triVerts,
    vertProperties,
    tolerance: 1e-4
  });

  mesh.merge();
  let manifold = new mod.Manifold(mesh);

  // If raw mesh is excessively dense for 32-bit WASM CSG (> maxTriangles), apply high-precision decimation
  // (0.04mm = 40 microns, far finer than standard 3D printer resolution) to prevent WASM table/memory crashes.
  if (maxTriangles > 0 && manifold.getMesh().numTri > maxTriangles) {
    try {
      const decimated = manifold.simplify(0.04);
      manifold.delete();
      manifold = decimated;
    } catch (err) {
      console.warn('Micro-simplification skipped:', err);
    }
  }

  return manifold;
}

/**
 * Defeatures and fills small screw holes, recesses, text embossing, and tiny cavities in the tool manifold
 * so they don't produce protruding plastic posts or bumps inside the 3D-printed tool slot.
 */
export function applyToolSmoothing(toolManifold: any, config: SmoothingConfig): any {
  if (!config.enabled || config.tolerance <= 0) {
    return toolManifold;
  }
  try {
    return toolManifold.simplify(config.tolerance);
  } catch (err) {
    console.warn('Tool simplification failed, falling back to original:', err);
    return toolManifold;
  }
}

/**
 * Creates a displayable Three.js BufferGeometry with surface smoothing and hole defeaturing applied
 */
export function createSmoothedToolGeometry(
  mod: ManifoldModule | null,
  rawGeometry: THREE.BufferGeometry,
  config: SmoothingConfig
): THREE.BufferGeometry {
  if (!config.enabled) {
    return rawGeometry;
  }

  let geo = rawGeometry;
  // 1. Surface Laplacian relaxation for scan noise
  if (config.surfaceIterations > 0) {
    geo = laplacianSmoothGeometry(geo, config.surfaceIterations);
  }

  // 2. Hole defeaturing via Manifold simplification
  if (mod && config.tolerance > 0) {
    let toolManifold: any = null;
    let simplified: any = null;
    try {
      toolManifold = threeGeometryToManifold(mod, geo, 0); // Don't auto-decimate here, user tolerance handles it
      simplified = toolManifold.simplify(config.tolerance);
      const threeGeo = manifoldToThreeGeometry(simplified);
      return threeGeo;
    } catch (err) {
      console.warn('Failed to simplify tool geometry for display:', err);
      return geo;
    } finally {
      if (toolManifold) {
        try { toolManifold.delete(); } catch { /* ignore */ }
      }
      if (simplified) {
        try { simplified.delete(); } catch { /* ignore */ }
      }
    }
  }

  return geo;
}

/**
 * Applies Laplacian smoothing iterations to smooth rough scan noise and jagged facets on Three.js geometry
 */
export function laplacianSmoothGeometry(geometry: THREE.BufferGeometry, iterations = 2, lambda = 0.4): THREE.BufferGeometry {
  if (iterations <= 0) return geometry;

  const indexed = geometry.index ? geometry : BufferGeometryUtils.mergeVertices(geometry, 1e-4);
  if (!indexed.index) return geometry;

  const pos = indexed.attributes.position.array as Float32Array;
  const indices = indexed.index.array as Uint32Array | Uint16Array;
  const numVerts = pos.length / 3;

  // Build adjacency list
  const neighbors = Array.from({ length: numVerts }, () => new Set<number>());
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }

  const currentPos = new Float32Array(pos);
  const nextPos = new Float32Array(pos);

  for (let iter = 0; iter < iterations; iter++) {
    for (let v = 0; v < numVerts; v++) {
      const nbrs = neighbors[v];
      if (nbrs.size === 0) continue;
      let avgX = 0, avgY = 0, avgZ = 0;
      for (const n of nbrs) {
        avgX += currentPos[n * 3];
        avgY += currentPos[n * 3 + 1];
        avgZ += currentPos[n * 3 + 2];
      }
      avgX /= nbrs.size; avgY /= nbrs.size; avgZ /= nbrs.size;

      nextPos[v * 3]     = currentPos[v * 3]     + lambda * (avgX - currentPos[v * 3]);
      nextPos[v * 3 + 1] = currentPos[v * 3 + 1] + lambda * (avgY - currentPos[v * 3 + 1]);
      nextPos[v * 3 + 2] = currentPos[v * 3 + 2] + lambda * (avgZ - currentPos[v * 3 + 2]);
    }
    currentPos.set(nextPos);
  }

  const smoothed = indexed.clone();
  smoothed.setAttribute('position', new THREE.BufferAttribute(nextPos, 3));
  smoothed.computeVertexNormals();
  return smoothed;
}

/**
 * Calculates the exact 4x4 affine transform matrix matching Three.js scene hierarchy
 */
export function getToolMatrix(transform: ToolTransform): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const [rx, ry, rz] = transform.rotation;
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rx),
    THREE.MathUtils.degToRad(ry),
    THREE.MathUtils.degToRad(rz),
    'XYZ'
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const sx = transform.scale[0];
  const sy = transform.uniformScale ? transform.scale[0] : transform.scale[1];
  const sz = transform.uniformScale ? transform.scale[0] : transform.scale[2];

  matrix.compose(
    new THREE.Vector3(...transform.position),
    quat,
    new THREE.Vector3(sx, sy, sz)
  );
  return matrix;
}

/**
 * Transforms a raw tool manifold using the exact 4x4 matrix from Three.js
 * Guarantees 100% mathematical bit-for-bit match between viewport and boolean cutter!
 */
export function transformToolManifold(tool: any, transform: ToolTransform): any {
  const mat = getToolMatrix(transform);
  return tool.transform(Array.from(mat.elements));
}

/**
 * Fills internal holes in a CrossSection (e.g. screw holes, voids) so that upward extrusion
 * does not produce unwanted solid plastic posts protruding through the tool pocket.
 */
export function fillCrossSectionHoles(mod: ManifoldModule, crossSection: any): any {
  if (crossSection.isEmpty()) return crossSection;
  try {
    const polys = crossSection.toPolygons();
    if (!polys || polys.length <= 1) {
      return mod.CrossSection.union([crossSection]);
    }
    const outerPolys = polys.filter((pts: number[][]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        a += (p1[0] * p2[1] - p2[0] * p1[1]);
      }
      return a > 0;
    });
    if (outerPolys.length === 0) {
      return mod.CrossSection.union([crossSection]);
    }
    return new mod.CrossSection(outerPolys, mod.fillrule?.Positive ?? 0);
  } catch (err) {
    console.warn('fillCrossSectionHoles error:', err);
    return mod.CrossSection.union([crossSection]);
  }
}

/**
 * Generates an upward cutter to eliminate vertical undercuts / overhangs above the tool,
 * guaranteeing the tool drops freely into and pulls out of the bin vertically.
 * 
 * Supports two modes:
 * 1. 'contour' (default): Multi-slice upward accumulation sweep. Preserves the 3D contoured
 *    cradle at the bottom while sweeping all horizontal cross-sections upward to eliminate undercuts.
 * 2. 'silhouette': 2.5D outer silhouette extrusion from tool bottom up through the bin top.
 * 
 * Handles tools of any height: whether submerged in the bin or protruding tall above the bin.
 */
export function createExtrudeToTopCutter(
  mod: ManifoldModule,
  transformedTool: any,
  binTopZ: number,
  mode: 'contour' | 'silhouette' = 'contour'
): any {
  const bounds = transformedTool.boundingBox();
  const zMin = bounds.min[2];
  const zMax = bounds.max[2];
  const chimneyTopZ = Math.max(binTopZ + 2, zMax + 2);
  const totalHeight = zMax - zMin;

  if (totalHeight <= 0.2 || mode === 'silhouette') {
    const rawProj = transformedTool.project();
    const proj = fillCrossSectionHoles(mod, rawProj);
    rawProj.delete();
    const height = chimneyTopZ - zMin;
    const chimney = proj.extrude(height).translate([0, 0, zMin]);
    proj.delete();
    transformedTool.delete();
    return chimney;
  }

  try {
    const numSlices = Math.min(24, Math.max(8, Math.round(totalHeight / 1.5)));
    const dz = totalHeight / numSlices;
    const parts: any[] = [];
    let accum: any = null;

    for (let i = 0; i < numSlices; i++) {
      const z0 = zMin + i * dz;
      const z1 = Math.min(zMax, z0 + dz);
      const sliceZ = z0 + 0.5 * dz;
      const slice = transformedTool.slice(sliceZ);

      if (!slice.isEmpty()) {
        const filledSlice = fillCrossSectionHoles(mod, slice);
        slice.delete();

        if (!accum) {
          accum = filledSlice;
        } else {
          const next = mod.CrossSection.union([accum, filledSlice]);
          accum.delete();
          filledSlice.delete();
          accum = next;
        }
      } else {
        slice.delete();
      }

      if (accum && !accum.isEmpty()) {
        const block = accum.extrude(z1 - z0 + 0.02).translate([0, 0, z0]);
        parts.push(block);
      }
    }

    if (!accum || accum.isEmpty()) {
      if (accum) accum.delete();
      const rawProj = transformedTool.project();
      accum = fillCrossSectionHoles(mod, rawProj);
      rawProj.delete();
    }

    if (chimneyTopZ > zMax && accum && !accum.isEmpty()) {
      const topChimney = accum.extrude(chimneyTopZ - zMax + 0.05).translate([0, 0, zMax]);
      parts.push(topChimney);
    }
    if (accum) {
      accum.delete();
      accum = null;
    }

    parts.push(transformedTool);
    const swept = mod.Manifold.union(parts);
    parts.forEach(p => {
      try { p.delete(); } catch {}
    });
    return swept;
  } catch (err) {
    console.warn('Swept tool union failed, falling back to 2D silhouette chimney:', err);
    const rawProj = transformedTool.project();
    const proj = fillCrossSectionHoles(mod, rawProj);
    rawProj.delete();
    const height = chimneyTopZ - zMin;
    const chimney = proj.extrude(height).translate([0, 0, zMin]);
    proj.delete();
    const combined = mod.Manifold.union([transformedTool, chimney]);
    chimney.delete();
    transformedTool.delete();
    return combined;
  }
}

/**
 * 2D convex hull calculation (Monotone Chain algorithm) for fast 2D silhouette calculation
 */
function convexHull2D(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return points;
  points.sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Generates Three.js preview geometry showing the upward extrusion volume / chimney in the viewport
 */
export function createExtrudePreviewGeometry(
  toolGeometry: THREE.BufferGeometry | null,
  toolTransform: ToolTransform,
  binTopZ: number
): THREE.BufferGeometry | null {
  if (!toolGeometry) return null;
  const pos = toolGeometry.attributes.position?.array;
  if (!pos || pos.length === 0) return null;

  const mat = getToolMatrix(toolTransform);
  const e = mat.elements;
  const pts: [number, number][] = [];
  const step = Math.max(1, Math.floor(pos.length / (3 * 2000)));
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < pos.length; i += 3 * step) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    pts.push([wx, wy]);
    if (wz < minZ) minZ = wz;
    if (wz > maxZ) maxZ = wz;
  }

  if (pts.length < 3) return null;
  const hull = convexHull2D(pts);
  if (hull.length < 3) return null;

  const chimneyTopZ = Math.max(binTopZ, maxZ);
  const chimneyBaseZ = maxZ < binTopZ ? maxZ : minZ;
  const chimneyHeight = Math.max(0.5, chimneyTopZ - chimneyBaseZ);

  const shape = new THREE.Shape();
  shape.moveTo(hull[0][0], hull[0][1]);
  for (let i = 1; i < hull.length; i++) {
    shape.lineTo(hull[i][0], hull[i][1]);
  }
  shape.closePath();

  const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: chimneyHeight,
    bevelEnabled: false
  });
  extrudeGeo.translate(0, 0, chimneyBaseZ);
  extrudeGeo.computeVertexNormals();
  return extrudeGeo;
}

/**
 * Generates finger pull notch cylinders to subtract from the bin
 */
export function createFingerNotches(mod: ManifoldModule, toolBounds: { min: number[]; max: number[] }, binTopZ: number, config: NotchConfig): any | null {
  if (!config.enabled || config.placement === 'none') {
    return null;
  }

  const notches: any[] = [];
  const r = Math.max(4, config.radius);
  const depth = Math.max(5, config.depth);
  const notchHeight = depth + 5; // extend slightly above bin top
  const zPos = binTopZ - depth;

  const minX = toolBounds.min[0];
  const maxX = toolBounds.max[0];
  const minY = toolBounds.min[1];
  const maxY = toolBounds.max[1];
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  if (config.placement === 'left-right' || config.placement === 'all') {
    // Left notch
    const left = mod.Manifold.cylinder(notchHeight, r, r, 24, false).translate([minX, midY, zPos]);
    // Right notch
    const right = mod.Manifold.cylinder(notchHeight, r, r, 24, false).translate([maxX, midY, zPos]);
    notches.push(left, right);
  }

  if (config.placement === 'front-back' || config.placement === 'all') {
    // Front notch
    const front = mod.Manifold.cylinder(notchHeight, r, r, 24, false).translate([midX, minY, zPos]);
    // Back notch
    const back = mod.Manifold.cylinder(notchHeight, r, r, 24, false).translate([midX, maxY, zPos]);
    notches.push(front, back);
  }

  if (notches.length === 0) return null;
  if (notches.length === 1) return notches[0];
  const union = mod.Manifold.union(notches);
  notches.forEach(n => n.delete());
  return union;
}

/**
 * Creates Three.js geometry for previewing finger notches in the viewport
 */
export function createFingerNotchesThreeGeometry(
  toolBounds: { min: number[]; max: number[] },
  binTopZ: number,
  config: NotchConfig
): THREE.BufferGeometry | null {
  if (!config.enabled || config.placement === 'none') {
    return null;
  }
  const r = Math.max(4, config.radius);
  const depth = Math.max(5, config.depth);
  const zCenter = binTopZ - depth / 2;

  const minX = toolBounds.min[0];
  const maxX = toolBounds.max[0];
  const minY = toolBounds.min[1];
  const maxY = toolBounds.max[1];
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const geometries: THREE.BufferGeometry[] = [];

  if (config.placement === 'left-right' || config.placement === 'all') {
    const left = new THREE.CylinderGeometry(r, r, depth, 24);
    left.translate(minX, zCenter, midY); // In Three.js Z-up or Y-up?
    // In our scene, Z is up! Cylinder default orientation has Y along cylinder axis.
    // So rotate cylinder so its height is along Z:
    left.rotateX(Math.PI / 2);
    left.translate(minX, midY, zCenter);
    geometries.push(left);

    const right = new THREE.CylinderGeometry(r, r, depth, 24);
    right.rotateX(Math.PI / 2);
    right.translate(maxX, midY, zCenter);
    geometries.push(right);
  }

  if (config.placement === 'front-back' || config.placement === 'all') {
    const front = new THREE.CylinderGeometry(r, r, depth, 24);
    front.rotateX(Math.PI / 2);
    front.translate(midX, minY, zCenter);
    geometries.push(front);

    const back = new THREE.CylinderGeometry(r, r, depth, 24);
    back.rotateX(Math.PI / 2);
    back.translate(midX, maxY, zCenter);
    geometries.push(back);
  }

  if (geometries.length === 0) return null;
  return BufferGeometryUtils.mergeGeometries(geometries);
}

/**
 * Calculates the exact minimum clearance from the tool cutout (and finger notches)
 * to the polyomino outer perimeter walls of the bin.
 * Only tests vertices inside the bin (z <= binHeight).
 * Positive value = safe margin in mm.
 * Negative value = penetration / wall breach in mm.
 */
export function computeToolWallClearance(
  toolGeometry: THREE.BufferGeometry | null,
  toolTransform: ToolTransform,
  cells: GridCell[],
  binHeight: number,
  notches: NotchConfig
): number | null {
  if (!toolGeometry || cells.length === 0) return null;

  const pos = toolGeometry.attributes.position?.array;
  if (!pos || pos.length === 0) return null;

  const { offsetX, offsetY } = getGridBounds(cells);
  const cellSet = new Set(cells.map(c => `${c.x},${c.y}`));
  const hasCell = (gx: number, gy: number) => cellSet.has(`${gx},${gy}`);

  const mat = getToolMatrix(toolTransform);
  const e = mat.elements;

  function getPointClearance(tx: number, ty: number): number {
    const gx = Math.floor((tx + offsetX) / GRID_SIZE);
    const gy = Math.floor((offsetY - ty) / GRID_SIZE);

    if (!hasCell(gx, gy)) {
      // Outside active cells: distance to closest cell center (negative)
      let minDist = Infinity;
      for (const c of cells) {
        const cx = (c.x + 0.5) * GRID_SIZE - offsetX;
        const cy = offsetY - (c.y + 0.5) * GRID_SIZE;
        const dist = Math.hypot(tx - cx, ty - cy) - (GRID_SIZE / 2);
        if (dist < minDist) minDist = dist;
      }
      return -Math.max(0.1, minDist);
    }

    const localX = (tx + offsetX) - gx * GRID_SIZE;
    const localY = ty - (offsetY - (gy + 1) * GRID_SIZE);
    let minC = Infinity;
    if (!hasCell(gx - 1, gy)) minC = Math.min(minC, localX - TOLERANCE);
    if (!hasCell(gx + 1, gy)) minC = Math.min(minC, (GRID_SIZE - TOLERANCE) - localX);
    // +Y in 3D corresponds to gy - 1 in 2D grid
    if (!hasCell(gx, gy - 1)) minC = Math.min(minC, (GRID_SIZE - TOLERANCE) - localY);
    // -Y in 3D corresponds to gy + 1 in 2D grid
    if (!hasCell(gx, gy + 1)) minC = Math.min(minC, localY - TOLERANCE);
    return minC;
  }

  // Sample up to 3,500 vertices across the tool
  const totalVerts = pos.length / 3;
  const targetSamples = 3500;
  const stride = Math.max(1, Math.floor(totalVerts / targetSamples)) * 3;

  let minClearance = Infinity;
  let toolMinX = Infinity, toolMaxX = -Infinity;
  let toolMinY = Infinity, toolMaxY = -Infinity;
  let pointsInsideBin = 0;

  for (let i = 0; i < pos.length; i += stride) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const tz = e[2] * x + e[6] * y + e[10] * z + e[14];

    // Only test vertices that actually plunge inside the bin!
    if (tz <= binHeight + 0.5) {
      pointsInsideBin++;
      const tx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const ty = e[1] * x + e[5] * y + e[9] * z + e[13];

      if (tx < toolMinX) toolMinX = tx;
      if (tx > toolMaxX) toolMaxX = tx;
      if (ty < toolMinY) toolMinY = ty;
      if (ty > toolMaxY) toolMaxY = ty;

      const cl = getPointClearance(tx, ty);
      if (cl < minClearance) minClearance = cl;
    }
  }

  if (pointsInsideBin === 0) {
    return 10.0;
  }

  // Check finger notches if enabled
  if (notches.enabled && notches.placement !== 'none') {
    const r = Math.max(4, notches.radius);
    const midX = (toolMinX + toolMaxX) / 2;
    const midY = (toolMinY + toolMaxY) / 2;

    if (notches.placement === 'left-right' || notches.placement === 'all') {
      const clLeft = getPointClearance(toolMinX, midY) - r;
      const clRight = getPointClearance(toolMaxX, midY) - r;
      minClearance = Math.min(minClearance, clLeft, clRight);
    }
    if (notches.placement === 'front-back' || notches.placement === 'all') {
      const clFront = getPointClearance(midX, toolMinY) - r;
      const clBack = getPointClearance(midX, toolMaxY) - r;
      minClearance = Math.min(minClearance, clFront, clBack);
    }
  }

  return minClearance === Infinity ? null : minClearance;
}

/**
 * Exports a Manifold object to a binary STL ArrayBuffer and triggers download
 */
export function exportManifoldToBinarySTL(manifold: any, filename = 'gridfinity-custom-bin.stl') {
  const mesh = manifold.getMesh();
  const numTri = mesh.numTri;
  const numProp = mesh.numProp;
  const verts = mesh.vertProperties;
  const triVerts = mesh.triVerts;

  const bufferSize = 84 + numTri * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 80-byte header
  const headerStr = 'Gridfinity Custom Tool Slot Bin (Generated via Manifold3D)';
  for (let i = 0; i < Math.min(80, headerStr.length); i++) {
    view.setUint8(i, headerStr.charCodeAt(i));
  }

  // Number of triangles at byte offset 80
  view.setUint32(80, numTri, true);

  let offset = 84;
  for (let t = 0; t < numTri; t++) {
    const i0 = triVerts[t * 3];
    const i1 = triVerts[t * 3 + 1];
    const i2 = triVerts[t * 3 + 2];

    const v0x = verts[i0 * numProp];
    const v0y = verts[i0 * numProp + 1];
    const v0z = verts[i0 * numProp + 2];

    const v1x = verts[i1 * numProp];
    const v1y = verts[i1 * numProp + 1];
    const v1z = verts[i1 * numProp + 2];

    const v2x = verts[i2 * numProp];
    const v2y = verts[i2 * numProp + 1];
    const v2z = verts[i2 * numProp + 2];

    // Compute face normal: (v1 - v0) x (v2 - v0)
    const ax = v1x - v0x;
    const ay = v1y - v0y;
    const az = v1z - v0z;
    const bx = v2x - v0x;
    const by = v2y - v0y;
    const bz = v2z - v0z;

    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-6) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0; ny = 0; nz = 1;
    }

    // Normal vector
    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    // Vertex 1
    view.setFloat32(offset, v0x, true); offset += 4;
    view.setFloat32(offset, v0y, true); offset += 4;
    view.setFloat32(offset, v0z, true); offset += 4;

    // Vertex 2
    view.setFloat32(offset, v1x, true); offset += 4;
    view.setFloat32(offset, v1y, true); offset += 4;
    view.setFloat32(offset, v1z, true); offset += 4;

    // Vertex 3
    view.setFloat32(offset, v2x, true); offset += 4;
    view.setFloat32(offset, v2y, true); offset += 4;
    view.setFloat32(offset, v2z, true); offset += 4;

    // Attribute byte count (uint16 = 0)
    view.setUint16(offset, 0, true); offset += 2;
  }

  // Trigger download
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
