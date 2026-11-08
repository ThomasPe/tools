import type { BinConfig, GridCell, SmoothingConfig, ToolCutoutConfig } from '../types.ts';
import type { MeshArrays } from './meshUtils.ts';
import type { WorkerRequest, WorkerResponse } from './csgProtocol.ts';

/**
 * Promise-based client for the CSG worker. One worker holds the Manifold WASM instance; when a
 * request dies with a WASM trap the worker is thrown away and a fresh one is started for the
 * next request, so the app recovers from memory limits without a page reload.
 */

/** Omit that distributes over a union (plain Omit collapses a union to its common keys). */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<WorkerRequest, 'id'>;

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
};

export class CsgEngineError extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal: boolean) {
    super(message);
    this.name = 'CsgEngineError';
    this.fatal = fatal;
  }
}

export class CsgEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly wasmUrl: string;
  private disposed = false;

  constructor(wasmUrl: string) {
    this.wasmUrl = wasmUrl;
  }

  /** Starts (or restarts) the worker and resolves once the WASM module is initialised. */
  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.start();
    }
    return this.ready;
  }

  private start(): Promise<void> {
    const worker = new Worker(new URL('./csg.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handleMessage(ev.data);
    worker.onerror = (ev: ErrorEvent) => {
      this.failAll(new CsgEngineError(ev.message || 'Geometry worker crashed', true));
      this.restart();
    };
    return this.send({ type: 'init', wasmUrl: this.wasmUrl }).then(() => undefined);
  }

  private restart(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = null;
  }

  private failAll(error: Error): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private handleMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) {
      p.resolve(msg);
    } else {
      const error = new CsgEngineError(msg.error, msg.fatal);
      if (msg.fatal) {
        // The WASM heap is unusable after a trap: drop every in-flight request and start over.
        this.failAll(error);
        this.restart();
      }
      p.reject(error);
    }
  }

  private send(request: RequestBody, transfer: Transferable[] = []): Promise<WorkerResponse> {
    if (this.disposed) return Promise.reject(new CsgEngineError('Geometry engine disposed', false));
    const worker = this.worker;
    if (!worker) return Promise.reject(new CsgEngineError('Geometry worker not running', true));
    const id = this.nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id } as WorkerRequest, transfer);
    });
  }

  private async call(request: RequestBody, transfer: Transferable[] = []): Promise<WorkerResponse> {
    await this.init();
    return this.send(request, transfer);
  }

  async buildBin(cells: GridCell[], binConfig: BinConfig): Promise<{ mesh: MeshArrays; elapsed: number }> {
    const res = await this.call({ type: 'bin', cells, binConfig });
    if (res.ok && res.type === 'bin') return { mesh: res.mesh, elapsed: res.elapsed };
    throw new CsgEngineError('Unexpected worker response', false);
  }

  async smoothTool(tool: MeshArrays, smoothing: SmoothingConfig): Promise<{ mesh: MeshArrays; elapsed: number }> {
    const res = await this.call({ type: 'smooth', tool, smoothing }, [tool.positions.buffer, tool.indices.buffer]);
    if (res.ok && res.type === 'smooth') return { mesh: res.mesh, elapsed: res.elapsed };
    throw new CsgEngineError('Unexpected worker response', false);
  }

  async cutout(
    cells: GridCell[],
    binConfig: BinConfig,
    toolCutout: ToolCutoutConfig,
    tool: MeshArrays | null
  ): Promise<{ mesh: MeshArrays; triangles: number; elapsed: number }> {
    const transfer = tool ? [tool.positions.buffer, tool.indices.buffer] : [];
    const res = await this.call({ type: 'cutout', cells, binConfig, toolCutout, tool }, transfer);
    if (res.ok && res.type === 'cutout') return { mesh: res.mesh, triangles: res.triangles, elapsed: res.elapsed };
    throw new CsgEngineError('Unexpected worker response', false);
  }

  dispose(): void {
    this.disposed = true;
    this.failAll(new CsgEngineError('Geometry engine disposed', false));
    this.restart();
  }
}

/**
 * Absolute URL of the WASM binary, resolved against the page (the worker lives under /assets/,
 * so a relative path would resolve to the wrong place there).
 */
export function getManifoldWasmUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${normalizedBase}manifold.wasm`, document.baseURI).href;
}
