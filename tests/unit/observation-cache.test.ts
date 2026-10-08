import { expect, it, vi } from "vitest";
import { DockerObservationCache } from "../../src/server/docker/observationCache.js";
import type { DockerObservation } from "../../src/server/docker/observer.js";
const sample = (id = "first"): DockerObservation => ({ available: true, container: { id, name: "gluetun", image: "synthetic", state: "running", displayState: "Running", health: null, exitCode: 0, startedAt: null, finishedAt: null, error: null, oomKilled: false, restartCount: 0 }, ports: [], environment: [], networks: [], logs: null, logsError: null, issues: [] });
it("shares concurrent reads, preserves observation time and isolates returned data", async () => {
  let at = 100_000; const cache = new DockerObservationCache(() => at);
  let resolve!: (value: DockerObservation) => void;
  const load = vi.fn(() => new Promise<DockerObservation>((done) => { resolve = done; }));
  const a = cache.get("connection", load), b = cache.get("connection", load, true);
  await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1); resolve(sample());
  const [first, second] = await Promise.all([a, b]); first.issues.push("caller mutation");
  expect(second.issues).toEqual([]);
  at += 9_999; expect((await cache.get("connection", load)).observedAt).toBe(new Date(100_000).toISOString());
  expect(load).toHaveBeenCalledTimes(1);
  const fresh = vi.fn(async () => sample("replacement")); at++;
  expect((await cache.get("connection", fresh)).container?.id).toBe("replacement");
  await cache.get("connection", fresh, true); expect(fresh).toHaveBeenCalledTimes(2); await cache.close();
});
it("briefly shares failures, replaces prior success and supports forced retry", async () => {
  let at = 100_000; const cache = new DockerObservationCache(() => at);
  await cache.get("connection", async () => sample());
  const fail = vi.fn(async () => { throw new Error("observer unavailable"); });
  await expect(cache.get("connection", fail, true)).rejects.toThrow("observer unavailable");
  await expect(cache.get("connection", fail)).rejects.toThrow("observer unavailable"); expect(fail).toHaveBeenCalledTimes(1);
  at += 2_000; await expect(cache.get("connection", fail)).rejects.toThrow(); expect(fail).toHaveBeenCalledTimes(2);
  expect((await cache.get("connection", async () => sample("recovered"), true)).container?.id).toBe("recovered"); await cache.close();
});
it("rejects in-flight results after invalidation and never caches an old connection", async () => {
  const cache = new DockerObservationCache(); let resolve!: (value: DockerObservation) => void;
  const pending = cache.get("old", () => new Promise((done) => { resolve = done; }));
  await Promise.resolve(); cache.invalidate();
  const rejected = expect(pending).rejects.toThrow("connection changed"); resolve(sample("old-container")); await rejected;
  expect((await cache.get("new", async () => sample("new-container"))).container?.id).toBe("new-container"); await cache.close();
  await expect(cache.get("new", async () => sample())).rejects.toThrow("shutting down");
});
it("bounds completed entries and active reads even across invalidation", async () => {
  const cache = new DockerObservationCache(Date.now, 1); let resolve!: (value: DockerObservation) => void;
  const pending = cache.get("a", () => new Promise((done) => { resolve = done; })); await Promise.resolve();
  await expect(cache.get("b", async () => sample())).rejects.toThrow("busy"); cache.invalidate();
  await expect(cache.get("b", async () => sample())).rejects.toThrow("busy");
  const rejected = expect(pending).rejects.toThrow("connection changed"); resolve(sample()); await rejected;
  const load = vi.fn(async () => sample()); await cache.get("b", load); await cache.get("c", load); await cache.get("b", load);
  expect(load).toHaveBeenCalledTimes(3); await cache.close();
});
