/**
 * Minimal ownership helper for Manifold WASM objects.
 *
 * Every Manifold / CrossSection / Mesh lives in the WASM heap and must be released with
 * `delete()`. Tracking intermediates in a scope and disposing them in a `finally` block keeps
 * the release logic in one place and guarantees that an exception half-way through a pipeline
 * does not leak the objects created so far.
 */
export interface Disposable {
  delete(): void;
}

export class Scope {
  private readonly items = new Set<Disposable>();

  /** Registers an object for disposal when the scope ends and returns it unchanged. */
  track<T extends Disposable>(obj: T): T {
    this.items.add(obj);
    return obj;
  }

  /** Removes an object from the scope so that it survives disposal (ownership transfer). */
  release<T extends Disposable>(obj: T): T {
    this.items.delete(obj);
    return obj;
  }

  /** Deletes one tracked object right away (e.g. a large intermediate no longer needed). */
  drop(obj: Disposable): void {
    if (this.items.delete(obj)) {
      safeDelete(obj);
    }
  }

  /** Deletes every tracked object. Safe to call more than once. */
  dispose(): void {
    for (const obj of this.items) {
      safeDelete(obj);
    }
    this.items.clear();
  }
}

function safeDelete(obj: Disposable): void {
  try {
    obj.delete();
  } catch {
    // Already deleted or the WASM instance is gone; nothing left to release.
  }
}

/**
 * Runs `fn` with a fresh scope and disposes every tracked object afterwards, whether `fn`
 * returned normally or threw. Objects that must outlive the scope are returned after
 * `scope.release(obj)`.
 */
export function withScope<T>(fn: (scope: Scope) => T): T {
  const scope = new Scope();
  try {
    return fn(scope);
  } finally {
    scope.dispose();
  }
}
