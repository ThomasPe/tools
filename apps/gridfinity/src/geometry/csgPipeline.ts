import type { Manifold } from 'manifold-3d';
import type { BinConfig, GridCell, SmoothingConfig, ToolCutoutConfig } from '../types.ts';
import { generateGridfinityBin, getBinTopZ, type ManifoldModule } from './gridfinity.ts';
import {
  createDropInCutter,
  createFingerNotches,
  getTransformedBounds,
  manifoldToMeshArrays,
  meshArraysToManifold,
  prepareToolMesh,
  transformToolManifold,
  type MeshArrays
} from './meshUtils.ts';
import { withScope } from './scope.ts';

/**
 * The complete bin + tool cutout pipeline on plain data. Runs identically in the CSG worker
 * and in Node tests; nothing in here touches the DOM.
 */

export interface CutoutRequest {
  cells: GridCell[];
  binConfig: BinConfig;
  toolCutout: ToolCutoutConfig;
  /** Raw tool mesh in tool-local coordinates, or null for a plain bin. */
  tool: MeshArrays | null;
}

export interface CutoutResult {
  mesh: MeshArrays;
  triangles: number;
}

/**
 * Bin only (no tool).
 */
export function buildBinMesh(mod: ManifoldModule, cells: GridCell[], binConfig: BinConfig): MeshArrays {
  return withScope(scope => {
    const bin = scope.track(generateGridfinityBin(mod, cells, binConfig));
    return manifoldToMeshArrays(bin);
  });
}

/**
 * Tool mesh after surface relaxation and hole defeaturing, for display.
 */
export function smoothToolMesh(mod: ManifoldModule, tool: MeshArrays, smoothing: SmoothingConfig): MeshArrays {
  return prepareToolMesh(mod, tool, smoothing);
}

/**
 * Bin minus tool cutout (and finger notches).
 */
export function buildCutoutMesh(mod: ManifoldModule, request: CutoutRequest): CutoutResult {
  const { cells, binConfig, toolCutout, tool } = request;
  return withScope(scope => {
    let solid: Manifold = scope.track(generateGridfinityBin(mod, cells, binConfig));

    if (tool && tool.indices.length >= 3) {
      const binTopZ = getBinTopZ(binConfig);
      const prepared = prepareToolMesh(mod, tool, toolCutout.smoothing);

      let cutter: Manifold | null;
      if (toolCutout.extrudeToTop) {
        // Drop-in pocket from the depth map: no watertight input required.
        cutter = createDropInCutter(mod, prepared, toolCutout.transform, binTopZ, toolCutout.extrudeMode ?? 'contour');
        if (cutter) scope.track(cutter);
      } else {
        // Exact negative of the tool: needs a watertight mesh.
        const toolSolid = scope.track(meshArraysToManifold(mod, prepared, toolCutout.smoothing?.enabled ? 0 : 90000));
        cutter = scope.track(transformToolManifold(toolSolid, toolCutout.transform));
        scope.drop(toolSolid);
      }

      if (toolCutout.notches.enabled) {
        const bounds = getTransformedBounds(prepared, toolCutout.transform);
        const notches = createFingerNotches(mod, bounds, binTopZ, toolCutout.notches);
        if (notches) {
          scope.track(notches);
          cutter = cutter ? scope.track(mod.Manifold.union([cutter, notches])) : notches;
        }
      }

      if (cutter) {
        solid = scope.track(mod.Manifold.difference(solid, cutter));
      }
    }

    const mesh = manifoldToMeshArrays(solid);
    return { mesh, triangles: mesh.indices.length / 3 };
  });
}
