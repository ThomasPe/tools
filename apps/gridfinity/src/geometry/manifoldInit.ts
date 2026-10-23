import Module from 'manifold-3d';
import type { ManifoldModule } from './gridfinity';

let manifoldPromise: Promise<ManifoldModule> | null = null;

export async function getManifold(): Promise<ManifoldModule> {
  if (!manifoldPromise) {
    manifoldPromise = (async () => {
      const base = import.meta.env.BASE_URL || '/';
      const normalizedBase = base.endsWith('/') ? base : `${base}/`;
      const mod = await Module({
        locateFile: () => `${normalizedBase}manifold.wasm`
      });
      mod.setup();
      return mod;
    })();
  }
  return manifoldPromise;
}

export function resetManifold(): void {
  manifoldPromise = null;
}

