import Module from 'manifold-3d';
import type { ManifoldModule } from './gridfinity.ts';
import { buildBinMesh, buildCutoutMesh, smoothToolMesh } from './csgPipeline.ts';
import type { WorkerRequest, WorkerResponse } from './csgProtocol.ts';

/**
 * Dedicated worker that owns the Manifold WASM instance. All geometry work happens here so the
 * UI thread never blocks; a WASM trap only takes down this worker, which the client restarts.
 */

const ctx = self as unknown as {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
};

let modPromise: Promise<ManifoldModule> | null = null;

function getModule(wasmUrl: string): Promise<ManifoldModule> {
  if (!modPromise) {
    modPromise = (async () => {
      const mod = await Module({ locateFile: () => wasmUrl });
      mod.setup();
      return mod as unknown as ManifoldModule;
    })();
  }
  return modPromise;
}

function transferables(...meshes: Array<{ positions: Float32Array; indices: Uint32Array }>): Transferable[] {
  return meshes.flatMap(m => [m.positions.buffer, m.indices.buffer]);
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  try {
    if (req.type === 'init') {
      await getModule(req.wasmUrl);
      ctx.postMessage({ id: req.id, ok: true, type: 'init', elapsed: performance.now() - t0 });
      return;
    }
    if (!modPromise) {
      throw new Error('Geometry engine not initialised');
    }
    const mod = await modPromise;

    if (req.type === 'bin') {
      const mesh = buildBinMesh(mod, req.cells, req.binConfig);
      ctx.postMessage({ id: req.id, ok: true, type: 'bin', mesh, elapsed: performance.now() - t0 }, transferables(mesh));
    } else if (req.type === 'smooth') {
      const mesh = smoothToolMesh(mod, req.tool, req.smoothing);
      ctx.postMessage({ id: req.id, ok: true, type: 'smooth', mesh, elapsed: performance.now() - t0 }, transferables(mesh));
    } else if (req.type === 'cutout') {
      const result = buildCutoutMesh(mod, req);
      ctx.postMessage(
        { id: req.id, ok: true, type: 'cutout', mesh: result.mesh, triangles: result.triangles, elapsed: performance.now() - t0 },
        transferables(result.mesh)
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // WASM traps (table index out of bounds, unreachable, memory) leave the instance unusable.
    const fatal = /bounds|RuntimeError|unreachable|memory|abort/i.test(message) || !(err instanceof Error);
    ctx.postMessage({ id: req.id, ok: false, error: message, fatal });
  }
};
