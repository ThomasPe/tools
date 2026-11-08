/**
 * Depth-map ("shadow foam") construction of a vertically extractable tool pocket.
 *
 * A pocket that a tool can drop into and lift out of vertically is, by definition, the volume
 * above the tool's lower envelope: for every (x, y) column the pocket starts at the lowest point
 * of the tool in that column and reaches up through the bin top. Rasterising the tool into a
 * minimum-z depth map therefore gives the drop-in cutter exactly, without slicing, without a
 * watertight input mesh, and without any sampling gaps between slices.
 *
 * This module is pure (no DOM, no Three.js, no Manifold) so that it can be unit tested in Node.
 */

export interface DepthMap {
  /** Number of sample columns / rows (grid points are (nx + 1) x (ny + 1)). */
  nx: number;
  ny: number;
  /** World x/y of grid point (0, 0). */
  x0: number;
  y0: number;
  /** Grid pitch in mm. */
  res: number;
  /** Minimum tool z per grid point, Infinity where no tool is present. Row-major: index = j * (nx + 1) + i. */
  minZ: Float32Array;
  /** Lowest point of the whole tool in world space. */
  zMin: number;
  /** Highest point of the whole tool in world space. */
  zMax: number;
  /** World-space bounds of the transformed tool vertices. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** True when at least one grid point is covered by the tool. */
  hasTool: boolean;
}

export interface DepthMapOptions {
  /** Preferred grid pitch in mm. */
  resolution?: number;
  /** Upper bound on grid points; the pitch is coarsened until it fits. */
  maxCells?: number;
  /** Lower bound on grid pitch in mm. */
  minResolution?: number;
  /** Upper bound on grid pitch in mm. */
  maxResolution?: number;
}

export interface SolidMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}

export type DropInMode = 'contour' | 'silhouette';

const EMPTY = Infinity;

/**
 * Picks a grid pitch that keeps the number of grid points under `maxCells`.
 */
export function chooseResolution(width: number, depth: number, options: DepthMapOptions = {}): number {
  const minRes = options.minResolution ?? 0.15;
  const maxRes = options.maxResolution ?? 1.0;
  const maxCells = options.maxCells ?? 160_000;
  let res = options.resolution ?? 0.2;
  // Include the one-cell empty border on each side when estimating the cell count.
  const cellsAt = (r: number) => (Math.ceil(width / r) + 4) * (Math.ceil(depth / r) + 4);
  if (cellsAt(res) > maxCells) {
    res = Math.sqrt(((width + 4 * res) * (depth + 4 * res)) / maxCells);
  }
  return Math.min(maxRes, Math.max(minRes, res));
}

/**
 * Rasterises a triangle mesh (already in tool-local space) through a column-major 4x4 matrix
 * (Three.js `Matrix4.elements` layout) into a minimum-z depth map in world space.
 *
 * Every grid point whose surrounding cell (half a pitch in each direction) is touched by a
 * triangle receives that triangle's height at the point, and the map is then pulled down to the
 * lowest value within one grid point. The result is conservative: it never misses a feature and
 * never intersects the tool, at the cost of widening the pocket by at most 1.5 x pitch at
 * vertical walls.
 */
export function rasterizeDepthMap(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  matrix: ArrayLike<number>,
  options: DepthMapOptions = {}
): DepthMap {
  const e = matrix;
  const numVerts = Math.floor(positions.length / 3);
  const wx = new Float64Array(numVerts);
  const wy = new Float64Array(numVerts);
  const wz = new Float64Array(numVerts);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < numVerts; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const tx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const ty = e[1] * x + e[5] * y + e[9] * z + e[13];
    const tz = e[2] * x + e[6] * y + e[10] * z + e[14];
    wx[v] = tx; wy[v] = ty; wz[v] = tz;
    if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
    if (tz < minZ) minZ = tz; if (tz > maxZ) maxZ = tz;
  }

  if (numVerts === 0 || !Number.isFinite(minX)) {
    return {
      nx: 1, ny: 1, x0: 0, y0: 0, res: 1, minZ: new Float32Array([EMPTY, EMPTY, EMPTY, EMPTY]),
      zMin: 0, zMax: 0, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, hasTool: false
    };
  }

  const res = chooseResolution(maxX - minX, maxY - minY, options);
  // Empty border cells on each side so that the (dilated) mask never touches the grid edge.
  const x0 = minX - 2.5 * res;
  const y0 = minY - 2.5 * res;
  const nx = Math.ceil((maxX - x0) / res) + 3;
  const ny = Math.ceil((maxY - y0) / res) + 3;
  const stride = nx + 1;
  const map = new Float32Array(stride * (ny + 1)).fill(EMPTY);

  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(numVerts / 3);
  const margin = 0.5 * res;
  const degenerateArea = 1e-9;

  const setMin = (i: number, j: number, z: number) => {
    const idx = j * stride + i;
    if (z < map[idx]) map[idx] = z;
  };

  /**
   * Height of the tool edge (a, b) at the point on the segment closest to (px, py), or
   * Infinity when that closest point is farther than half a cell away.
   */
  const edgeHeight = (
    px: number, py: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number
  ): number => {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
      // Vertical edge: the tool spans the whole z range at this column.
      return (Math.abs(px - ax) <= margin && Math.abs(py - ay) <= margin) ? Math.min(az, bz) : EMPTY;
    }
    let tParam = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (tParam < 0) tParam = 0; else if (tParam > 1) tParam = 1;
    const qx = ax + tParam * dx, qy = ay + tParam * dy;
    if (Math.abs(px - qx) > margin || Math.abs(py - qy) > margin) return EMPTY;
    return az + tParam * (bz - az);
  };

  for (let t = 0; t < triCount; t++) {
    const a = indices ? indices[t * 3] : t * 3;
    const b = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const c = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const ax = wx[a], ay = wy[a], az = wz[a];
    const bx = wx[b], by = wy[b], bz = wz[b];
    const cx = wx[c], cy = wy[c], cz = wz[c];

    const tMinX = Math.min(ax, bx, cx), tMaxX = Math.max(ax, bx, cx);
    const tMinY = Math.min(ay, by, cy), tMaxY = Math.max(ay, by, cy);

    const i0 = Math.max(0, Math.floor((tMinX - margin - x0) / res));
    const i1 = Math.min(nx, Math.ceil((tMaxX + margin - x0) / res));
    const j0 = Math.max(0, Math.floor((tMinY - margin - y0) / res));
    const j1 = Math.min(ny, Math.ceil((tMaxY + margin - y0) / res));
    if (i0 > i1 || j0 > j1) continue;

    // Twice the signed area of the projected triangle.
    const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const interior = Math.abs(area2) >= degenerateArea;
    const invArea = interior ? 1 / area2 : 0;
    const sign = area2 > 0 ? 1 : -1;

    for (let j = j0; j <= j1; j++) {
      const py = y0 + j * res;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * res;
        if (interior) {
          // Edge functions: all non-negative when the point lies inside the projected triangle.
          const eab = sign * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
          const ebc = sign * ((cx - bx) * (py - by) - (cy - by) * (px - bx));
          const eca = sign * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx));
          if (eab >= 0 && ebc >= 0 && eca >= 0) {
            const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * invArea;
            const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * invArea;
            const w2 = 1 - w0 - w1;
            setMin(i, j, w0 * az + w1 * bz + w2 * cz);
            continue;
          }
        }
        // Outside (or degenerate): the point's cell may still be touched by one of the edges.
        const h = Math.min(
          edgeHeight(px, py, ax, ay, az, bx, by, bz),
          edgeHeight(px, py, bx, by, bz, cx, cy, cz),
          edgeHeight(px, py, cx, cy, cz, ax, ay, az)
        );
        if (h !== EMPTY) setMin(i, j, h);
      }
    }
  }

  // Minimum filter over the 3x3 neighbourhood. The solid is built by linear interpolation
  // between grid points, so a vertical step in the tool's underside (or its silhouette) would
  // otherwise become a slope across one cell that leans into the tool. Pulling every point down
  // to the lowest neighbour moves that slope one cell outward, where it only widens the pocket
  // (by at most one pitch) instead of intersecting the tool.
  const filtered = new Float32Array(map.length);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      let h = EMPTY;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj > ny) continue;
        const row = jj * stride;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii > nx) continue;
          const v = map[row + ii];
          if (v < h) h = v;
        }
      }
      filtered[j * stride + i] = h;
    }
  }
  map.set(filtered);

  let hasTool = false;
  for (let k = 0; k < map.length; k++) {
    if (map[k] !== EMPTY) { hasTool = true; break; }
  }

  return {
    nx, ny, x0, y0, res, minZ: map, zMin: minZ, zMax: maxZ,
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    hasTool
  };
}

/**
 * Fills enclosed empty regions of the depth map (through-holes such as screw holes, ring
 * openings) so that no plastic posts are left standing inside the pocket. Each hole is filled
 * from its rim inward with the lowest neighbouring floor height.
 */
export function fillEnclosedHoles(map: DepthMap): DepthMap {
  const { nx, ny } = map;
  const stride = nx + 1;
  const total = stride * (ny + 1);
  const src = map.minZ;
  const reachable = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;

  // Flood fill the empty region connected to the border.
  const push = (idx: number) => {
    if (reachable[idx] === 0 && src[idx] === EMPTY) {
      reachable[idx] = 1;
      queue[tail++] = idx;
    }
  };
  for (let i = 0; i <= nx; i++) { push(i); push(ny * stride + i); }
  for (let j = 0; j <= ny; j++) { push(j * stride); push(j * stride + nx); }
  while (head < tail) {
    const idx = queue[head++];
    const i = idx % stride, j = (idx - i) / stride;
    if (i > 0) push(idx - 1);
    if (i < nx) push(idx + 1);
    if (j > 0) push(idx - stride);
    if (j < ny) push(idx + stride);
  }

  // Remaining empty points are holes: fill from the rim inward with the minimum neighbouring height.
  const out = new Float32Array(src);
  head = 0; tail = 0;
  const queued = new Uint8Array(total);
  for (let idx = 0; idx < total; idx++) {
    if (src[idx] !== EMPTY || reachable[idx]) continue;
    const i = idx % stride, j = (idx - i) / stride;
    const touchesRim =
      (i > 0 && src[idx - 1] !== EMPTY) || (i < nx && src[idx + 1] !== EMPTY) ||
      (j > 0 && src[idx - stride] !== EMPTY) || (j < ny && src[idx + stride] !== EMPTY);
    if (touchesRim) { queue[tail++] = idx; queued[idx] = 1; }
  }
  while (head < tail) {
    const idx = queue[head++];
    const i = idx % stride, j = (idx - i) / stride;
    let h = EMPTY;
    const consider = (n: number) => { if (out[n] !== EMPTY && out[n] < h) h = out[n]; };
    if (i > 0) consider(idx - 1);
    if (i < nx) consider(idx + 1);
    if (j > 0) consider(idx - stride);
    if (j < ny) consider(idx + stride);
    out[idx] = h;
    const enqueue = (n: number) => {
      if (out[n] === EMPTY && !reachable[n] && !queued[n]) { queued[n] = 1; queue[tail++] = n; }
    };
    if (i > 0) enqueue(idx - 1);
    if (i < nx) enqueue(idx + 1);
    if (j > 0) enqueue(idx - stride);
    if (j < ny) enqueue(idx + stride);
  }

  return { ...map, minZ: out };
}

/**
 * Builds a closed, outward-oriented solid from the depth map: the pocket volume from the tool's
 * lower envelope (or a flat floor in 'silhouette' mode) up to `zTop`. Grid points without tool
 * are raised to `zTop`, so the solid carries a thin slab above `zTop` that lies outside the bin
 * and cuts nothing. The mesh is a regular grid, hence 2-manifold by construction.
 */
export function buildDropInSolid(map: DepthMap, mode: DropInMode, zTop: number): SolidMesh {
  const { nx, ny, x0, y0, res } = map;
  const stride = nx + 1;
  const numGrid = stride * (ny + 1);
  const slab = Math.max(1, res);
  const topZ = zTop + slab;
  const floorZ = mode === 'silhouette' ? map.zMin : 0;

  const borderCount = 2 * (nx + ny);
  const numVerts = numGrid + borderCount + 1;
  const vertProperties = new Float32Array(numVerts * 3);

  // Bottom surface (lower envelope).
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const idx = j * stride + i;
      const raw = map.minZ[idx];
      let h: number;
      if (raw === EMPTY) h = zTop;
      else if (mode === 'silhouette') h = Math.min(floorZ, zTop);
      else h = Math.min(raw, zTop);
      vertProperties[idx * 3] = x0 + i * res;
      vertProperties[idx * 3 + 1] = y0 + j * res;
      vertProperties[idx * 3 + 2] = h;
    }
  }

  // Border ring, counter-clockwise seen from above: bottom edge, right edge, top edge, left edge.
  const ring: number[] = [];
  for (let i = 0; i < nx; i++) ring.push(i);                       // j = 0, i: 0..nx-1
  for (let j = 0; j < ny; j++) ring.push(j * stride + nx);         // i = nx, j: 0..ny-1
  for (let i = nx; i > 0; i--) ring.push(ny * stride + i);         // j = ny, i: nx..1
  for (let j = ny; j > 0; j--) ring.push(j * stride);              // i = 0, j: ny..1

  // Top ring vertices and top centre.
  const topBase = numGrid;
  for (let k = 0; k < borderCount; k++) {
    const b = ring[k];
    vertProperties[(topBase + k) * 3] = vertProperties[b * 3];
    vertProperties[(topBase + k) * 3 + 1] = vertProperties[b * 3 + 1];
    vertProperties[(topBase + k) * 3 + 2] = topZ;
  }
  const centre = numGrid + borderCount;
  vertProperties[centre * 3] = x0 + (nx * res) / 2;
  vertProperties[centre * 3 + 1] = y0 + (ny * res) / 2;
  vertProperties[centre * 3 + 2] = topZ;

  const numTris = 2 * nx * ny + 2 * borderCount + borderCount;
  const triVerts = new Uint32Array(numTris * 3);
  let t = 0;
  const tri = (a: number, b: number, c: number) => {
    triVerts[t++] = a; triVerts[t++] = b; triVerts[t++] = c;
  };

  // Bottom surface, facing downward (clockwise seen from above).
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p00 = j * stride + i;
      const p10 = p00 + 1;
      const p01 = p00 + stride;
      const p11 = p01 + 1;
      tri(p00, p11, p10);
      tri(p00, p01, p11);
    }
  }

  // Side walls, facing outward.
  for (let k = 0; k < borderCount; k++) {
    const k2 = (k + 1) % borderCount;
    const b0 = ring[k], b1 = ring[k2];
    const t0 = topBase + k, t1 = topBase + k2;
    tri(b0, b1, t1);
    tri(b0, t1, t0);
  }

  // Top cap, facing upward.
  for (let k = 0; k < borderCount; k++) {
    const k2 = (k + 1) % borderCount;
    tri(centre, topBase + k, topBase + k2);
  }

  return { vertProperties, triVerts };
}

/**
 * Convenience: depth map -> hole filling -> solid in one call.
 */
export function createDropInCutterMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  matrix: ArrayLike<number>,
  zTop: number,
  mode: DropInMode,
  options: DepthMapOptions = {}
): { mesh: SolidMesh; map: DepthMap } | null {
  const raw = rasterizeDepthMap(positions, indices, matrix, options);
  if (!raw.hasTool) return null;
  const map = fillEnclosedHoles(raw);
  return { mesh: buildDropInSolid(map, mode, zTop), map };
}
