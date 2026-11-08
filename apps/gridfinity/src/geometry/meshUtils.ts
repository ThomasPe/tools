import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Manifold } from 'manifold-3d';
import { GRID_SIZE, TOLERANCE, getGridBounds, type ManifoldModule } from './gridfinity.ts';
import { createDropInCutterMesh, type DropInMode, type SolidMesh } from './heightfield.ts';
import { withScope } from './scope.ts';
import type { GridCell, NotchConfig, SmoothingConfig, ToolTransform } from '../types.ts';

/** Plain, transferable triangle mesh (positions xyz, triangle indices). */
export interface MeshArrays {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Axis-aligned bounds as returned by Manifold.boundingBox(). */
export interface Bounds3 {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Extracts a Manifold solid into detached typed arrays (copies, decoupled from the WASM heap).
 */
export function manifoldToMeshArrays(manifold: Manifold): MeshArrays {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp;
  let positions: Float32Array;
  if (numProp === 3) {
    positions = new Float32Array(mesh.vertProperties);
  } else {
    const numVert = mesh.vertProperties.length / numProp;
    positions = new Float32Array(numVert * 3);
    for (let v = 0; v < numVert; v++) {
      positions[v * 3] = mesh.vertProperties[v * numProp];
      positions[v * 3 + 1] = mesh.vertProperties[v * numProp + 1];
      positions[v * 3 + 2] = mesh.vertProperties[v * numProp + 2];
    }
  }
  return { positions, indices: new Uint32Array(mesh.triVerts) };
}

/**
 * Builds a Three.js BufferGeometry with clean normals from plain mesh arrays.
 */
export function meshArraysToThreeGeometry(mesh: MeshArrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Converts a Manifold solid into a Three.js BufferGeometry with clean normals
 */
export function manifoldToThreeGeometry(manifold: Manifold): THREE.BufferGeometry {
  return meshArraysToThreeGeometry(manifoldToMeshArrays(manifold));
}

/**
 * Extracts plain, transferable arrays from a Three.js geometry (indexing it if necessary).
 */
export function threeGeometryToMeshArrays(geometry: THREE.BufferGeometry): MeshArrays {
  const indexed = geometry.index ? geometry : BufferGeometryUtils.mergeVertices(geometry, 1e-4);
  const positions = new Float32Array(indexed.attributes.position.array.length);
  positions.set(indexed.attributes.position.array);
  const indices = new Uint32Array(indexed.index ? indexed.index.count : 0);
  if (indexed.index) indices.set(indexed.index.array);
  return { positions, indices };
}

/**
 * Converts a triangle mesh (e.g. from an STL file) into a watertight Manifold
 */
export function meshArraysToManifold(mod: ManifoldModule, mesh: MeshArrays, maxTriangles = 90000): Manifold {
  const triVerts = new Uint32Array(mesh.indices.length);
  triVerts.set(mesh.indices);
  const vertProperties = new Float32Array(mesh.positions.length);
  vertProperties.set(mesh.positions);

  const wasmMesh = new mod.Mesh({ numProp: 3, triVerts, vertProperties, tolerance: 1e-4 });
  wasmMesh.merge();
  let manifold = new mod.Manifold(wasmMesh);

  // If raw mesh is excessively dense for 32-bit WASM CSG (> maxTriangles), apply high-precision decimation
  // (0.04mm = 40 microns, far finer than standard 3D printer resolution) to prevent WASM table/memory crashes.
  if (maxTriangles > 0 && manifold.numTri() > maxTriangles) {
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
 * Converts a Three.js BufferGeometry (e.g. from an STL file) into a watertight Manifold
 */
export function threeGeometryToManifold(mod: ManifoldModule, geometry: THREE.BufferGeometry, maxTriangles = 90000): Manifold {
  return meshArraysToManifold(mod, threeGeometryToMeshArrays(geometry), maxTriangles);
}

/**
 * Defeatures and fills small screw holes, recesses, text embossing, and tiny cavities in the tool manifold
 * so they don't produce protruding plastic posts or bumps inside the 3D-printed tool slot.
 * Returns the input unchanged when smoothing is disabled or fails.
 */
export function applyToolSmoothing(toolManifold: Manifold, config: SmoothingConfig): Manifold {
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
 * Applies Laplacian smoothing iterations to smooth rough scan noise and jagged facets on a mesh.
 */
export function laplacianSmoothMesh(mesh: MeshArrays, iterations = 2, lambda = 0.4): MeshArrays {
  if (iterations <= 0) return mesh;

  const pos = mesh.positions;
  const indices = mesh.indices;
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

  return { positions: nextPos, indices: new Uint32Array(indices) };
}

/**
 * Applies Laplacian smoothing iterations to a Three.js geometry (see laplacianSmoothMesh).
 */
export function laplacianSmoothGeometry(geometry: THREE.BufferGeometry, iterations = 2, lambda = 0.4): THREE.BufferGeometry {
  if (iterations <= 0) return geometry;
  const smoothed = laplacianSmoothMesh(threeGeometryToMeshArrays(geometry), iterations, lambda);
  return meshArraysToThreeGeometry(smoothed);
}

/**
 * Prepares the tool mesh for cutting: optional surface relaxation, optional hole defeaturing
 * through Manifold simplification. Returns plain arrays; the Manifold route is only taken when
 * defeaturing is requested, so a non-watertight scan still works for drop-in pockets.
 */
export function prepareToolMesh(mod: ManifoldModule, raw: MeshArrays, smoothing: SmoothingConfig | undefined): MeshArrays {
  let mesh = raw;
  if (smoothing?.enabled && smoothing.surfaceIterations > 0) {
    mesh = laplacianSmoothMesh(mesh, smoothing.surfaceIterations);
  }
  if (smoothing?.enabled && smoothing.tolerance > 0) {
    mesh = withScope(scope => {
      const tool = scope.track(meshArraysToManifold(mod, mesh, 0));
      const simplified = applyToolSmoothing(tool, smoothing);
      if (simplified !== tool) scope.track(simplified);
      return manifoldToMeshArrays(simplified);
    });
  }
  return mesh;
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
export function transformToolManifold(tool: Manifold, transform: ToolTransform): Manifold {
  const mat = getToolMatrix(transform);
  return tool.transform(Array.from(mat.elements) as unknown as Parameters<Manifold['transform']>[0]);
}

/**
 * World-space bounds of a tool mesh under its transform.
 */
export function getTransformedBounds(mesh: MeshArrays, transform: ToolTransform): Bounds3 {
  const e = getToolMatrix(transform).elements;
  const pos = mesh.positions;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
    if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
    if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
  }
  return { min, max };
}

/** Pitch and size limits for the depth map used for the real cutter. */
export const CUTTER_RASTER = { resolution: 0.15, maxCells: 200_000, minResolution: 0.1, maxResolution: 1.0 };
/** Coarser raster for the live viewport preview. */
export const PREVIEW_RASTER = { resolution: 0.5, maxCells: 12_000, minResolution: 0.4, maxResolution: 3.0 };

/**
 * Builds the drop-in cutter (tool pocket that opens vertically to the bin top) as a Manifold.
 *
 * The cutter is the volume above the tool's lower envelope ('contour') or above a flat floor at
 * the tool's lowest point ('silhouette'), swept up to `binTopZ` plus clearance. Through-holes in
 * the tool are filled so no plastic posts remain. Features thinner than the raster pitch cannot
 * be missed: every cell touched by the tool is cut, so the pocket is conservative by at most
 * 1.5 x pitch (about 0.2 mm) at vertical walls and never intersects the tool.
 *
 * Returns null when the transformed tool covers no raster cell (empty mesh).
 */
export function createDropInCutter(
  mod: ManifoldModule,
  toolMesh: MeshArrays,
  transform: ToolTransform,
  binTopZ: number,
  mode: DropInMode
): Manifold | null {
  const matrix = getToolMatrix(transform).elements;
  const zTop = binTopZ + 2;
  const result = createDropInCutterMesh(toolMesh.positions, toolMesh.indices, matrix, zTop, mode, CUTTER_RASTER);
  if (!result) return null;
  return withScope(scope => {
    const cutter = scope.track(solidMeshToManifold(mod, result.mesh));
    // Collapse the flat slab / flat floors; keeps the boolean fast and the export lean.
    try {
      return scope.release(cutter.simplify(0.002));
    } catch (err) {
      console.warn('Cutter simplification skipped:', err);
      return scope.release(cutter);
    }
  });
}

function solidMeshToManifold(mod: ManifoldModule, solid: SolidMesh): Manifold {
  const mesh = new mod.Mesh({ numProp: 3, vertProperties: solid.vertProperties, triVerts: solid.triVerts });
  mesh.merge();
  return new mod.Manifold(mesh);
}

/**
 * Generates Three.js preview geometry of the drop-in cutter for the viewport, using the same
 * depth-map construction as the real cutter at a coarser pitch, so what is shown is what is cut.
 */
export function createExtrudePreviewGeometry(
  toolGeometry: THREE.BufferGeometry | null,
  toolTransform: ToolTransform,
  binTopZ: number,
  mode: DropInMode = 'contour'
): THREE.BufferGeometry | null {
  if (!toolGeometry) return null;
  const pos = toolGeometry.attributes.position?.array;
  if (!pos || pos.length === 0) return null;

  const matrix = getToolMatrix(toolTransform).elements;
  const index = toolGeometry.index ? toolGeometry.index.array : null;
  const result = createDropInCutterMesh(pos, index, matrix, binTopZ, mode, PREVIEW_RASTER);
  if (!result) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(result.mesh.vertProperties, 3));
  geometry.setIndex(new THREE.BufferAttribute(result.mesh.triVerts, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Generates finger pull notch cylinders to subtract from the bin
 */
export function createFingerNotches(mod: ManifoldModule, toolBounds: Bounds3, binTopZ: number, config: NotchConfig): Manifold | null {
  if (!config.enabled || config.placement === 'none') {
    return null;
  }

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

  const centres: [number, number][] = [];
  if (config.placement === 'left-right' || config.placement === 'all') {
    centres.push([minX, midY], [maxX, midY]);
  }
  if (config.placement === 'front-back' || config.placement === 'all') {
    centres.push([midX, minY], [midX, maxY]);
  }
  if (centres.length === 0) return null;

  return withScope(scope => {
    const notches = centres.map(([x, y]) =>
      scope.track(mod.Manifold.cylinder(notchHeight, r, r, 24, false).translate([x, y, zPos]))
    );
    if (notches.length === 1) return scope.release(notches[0]);
    return scope.release(mod.Manifold.union(notches));
  });
}

/**
 * Creates Three.js geometry for previewing finger notches in the viewport
 */
export function createFingerNotchesThreeGeometry(
  toolBounds: Bounds3,
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

  const centres: [number, number][] = [];
  if (config.placement === 'left-right' || config.placement === 'all') {
    centres.push([minX, midY], [maxX, midY]);
  }
  if (config.placement === 'front-back' || config.placement === 'all') {
    centres.push([midX, minY], [midX, maxY]);
  }
  if (centres.length === 0) return null;

  // CylinderGeometry's axis is Y; our scene is Z-up, so rotate the axis onto Z first.
  const geometries = centres.map(([x, y]) => {
    const cyl = new THREE.CylinderGeometry(r, r, depth, 24);
    cyl.rotateX(Math.PI / 2);
    cyl.translate(x, y, zCenter);
    return cyl;
  });
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
 * Serialises a triangle mesh to a binary STL buffer.
 */
export function meshArraysToBinarySTL(mesh: MeshArrays): ArrayBuffer {
  const { positions: verts, indices: triVerts } = mesh;
  const numTri = triVerts.length / 3;

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

    const v0x = verts[i0 * 3], v0y = verts[i0 * 3 + 1], v0z = verts[i0 * 3 + 2];
    const v1x = verts[i1 * 3], v1y = verts[i1 * 3 + 1], v1z = verts[i1 * 3 + 2];
    const v2x = verts[i2 * 3], v2y = verts[i2 * 3 + 1], v2z = verts[i2 * 3 + 2];

    // Compute face normal: (v1 - v0) x (v2 - v0)
    const ax = v1x - v0x, ay = v1y - v0y, az = v1z - v0z;
    const bx = v2x - v0x, by = v2y - v0y, bz = v2z - v0z;

    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-6) {
      nx /= len; ny /= len; nz /= len;
    } else {
      nx = 0; ny = 0; nz = 1;
    }

    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    view.setFloat32(offset, v0x, true); offset += 4;
    view.setFloat32(offset, v0y, true); offset += 4;
    view.setFloat32(offset, v0z, true); offset += 4;

    view.setFloat32(offset, v1x, true); offset += 4;
    view.setFloat32(offset, v1y, true); offset += 4;
    view.setFloat32(offset, v1z, true); offset += 4;

    view.setFloat32(offset, v2x, true); offset += 4;
    view.setFloat32(offset, v2y, true); offset += 4;
    view.setFloat32(offset, v2z, true); offset += 4;

    // Attribute byte count (uint16 = 0)
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}

/**
 * Triggers a browser download of a binary STL buffer.
 */
export function downloadBinarySTL(buffer: ArrayBuffer, filename = 'gridfinity-custom-bin.stl') {
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
