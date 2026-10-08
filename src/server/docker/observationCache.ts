import type { DockerObservation } from "./observer.js";

type Entry = { expiresAt: number; value?: DockerObservation; error?: unknown; failed?: boolean; pending?: Promise<DockerObservation> };

/** Bounded, app-local metadata cache. Logs and traffic identity checks bypass it. */
export class DockerObservationCache {
  private readonly entries = new Map<string, Entry>();
  private readonly active = new Set<Promise<DockerObservation>>();
  private closed = false;

  constructor(private readonly clock = Date.now, private readonly capacity = 8) {}

  async get(key: string, load: () => Promise<DockerObservation>, force = false): Promise<DockerObservation> {
    if (this.closed) throw new Error("Docker observation is shutting down.");
    let entry = this.entries.get(key);
    if (entry?.pending) return structuredClone(await entry.pending);
    if (!force && entry && entry.expiresAt > this.clock()) {
      if (entry.failed) throw entry.error;
      return structuredClone(entry.value!);
    }
    if (this.active.size >= this.capacity) throw new Error("Docker observation is busy. Try Refresh shortly.");
    if (!entry) {
      if (this.entries.size >= this.capacity) {
        const removable = [...this.entries].find(([, candidate]) => !candidate.pending);
        if (!removable) throw new Error("Docker observation is busy. Try Refresh shortly.");
        this.entries.delete(removable[0]);
      }
      entry = { expiresAt: 0 };
      this.entries.set(key, entry);
    }
    const current = entry;
    delete current.value; delete current.error; current.failed = false;
    const pending = Promise.resolve().then(load).then((value) => {
      if (this.entries.get(key) !== current) throw new Error("The connection changed during Docker observation. Refresh its diagnostics.");
      current.value = { ...value, observedAt: new Date(this.clock()).toISOString() };
      current.expiresAt = this.clock() + 10_000;
      return current.value;
    }).catch((error: unknown) => {
      if (this.entries.get(key) === current) { current.error = error; current.failed = true; current.expiresAt = this.clock() + 2_000; }
      throw error;
    }).finally(() => { delete current.pending; this.active.delete(pending); });
    current.pending = pending;
    this.active.add(pending);
    return structuredClone(await pending);
  }

  invalidate(): void { this.entries.clear(); }

  async close(): Promise<void> {
    this.closed = true;
    this.invalidate();
    await Promise.allSettled([...this.active]);
  }
}
