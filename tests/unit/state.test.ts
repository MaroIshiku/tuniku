import { afterEach, expect, it, vi } from "vitest";
import { GluetunStateService } from "../../src/server/gluetun/state.js";
import { GluetunAdapter } from "../../src/server/gluetun/adapter.js";
import type { TunikuDatabase } from "../../src/server/db.js";
import { config } from "../../src/server/config.js";
import type { InstanceRecord, OverviewSnapshot } from "../../src/server/types.js";
import { encryptCredential } from "../../src/server/security.js";

afterEach(() => vi.restoreAllMocks());

it("diagnoses unreadable stored access without changing data and distinguishes memory-only access", () => {
  const encrypted = encryptCredential({ apiKey: "synthetic-access-value" }, "1".repeat(64));
  const storedCredential = vi.fn(() => encrypted);
  const state = new GluetunStateService({ storedCredential } as unknown as TunikuDatabase, { ...config, encryptionKey: "2".repeat(64) });
  const instance = { id: "synthetic-instance", authMode: "api_key" } as InstanceRecord;
  expect(state.accessState(instance)).toBe("stored_unreadable");
  expect(state.credentialFor(instance)).toBeNull();
  state.setEphemeralCredential(instance.id, { apiKey: "synthetic-replacement" });
  expect(state.accessState(instance)).toBe("memory_only");
  state.setEphemeralCredential(instance.id, null);
  expect(state.accessState(instance)).toBe("stored_unreadable");
  const restored = new GluetunStateService({ storedCredential } as unknown as TunikuDatabase, { ...config, encryptionKey: "1".repeat(64) });
  expect(restored.accessState(instance)).toBe("stored_readable");
  expect(storedCredential()).toBe(encrypted);
});

it("coalesces status requests and never caches a pre-change result after invalidation", async () => {
  const db = { storedCredential: () => null, updateCapabilities: vi.fn() } as unknown as TunikuDatabase;
  const state = new GluetunStateService(db, config);
  const instance = { id: "synthetic-instance", baseUrl: "http://gluetun:8000", authMode: "none", tlsVerify: true, requestTimeoutSeconds: 2 } as InstanceRecord;
  let resolve!: (value: OverviewSnapshot) => void;
  const overview = vi.spyOn(GluetunAdapter.prototype, "overview").mockImplementation(() => new Promise((done) => { resolve = done; }));
  const first = state.refresh(instance);
  const second = state.refresh(instance);
  expect(overview).toHaveBeenCalledTimes(1);
  state.invalidate(instance.id);
  const snapshot = { instanceId: instance.id, connected: true, stale: false, lastUpdatedAt: new Date().toISOString(), capabilities: {} } as OverviewSnapshot;
  resolve(snapshot);
  await Promise.all([first, second]);
  expect(state.current(instance.id)).toBeNull();
  expect(db.updateCapabilities).not.toHaveBeenCalled();
  overview.mockResolvedValue(snapshot);
  await state.refresh(instance);
  expect(state.current(instance.id)?.connected).toBe(true);
  expect(db.updateCapabilities).toHaveBeenCalledTimes(1);
  await state.stop();
});

it("does not present stale stored traffic rates as current speed", () => {
  const db = { listInstances: () => [], trafficSummary: () => ({ available: true, observedAt: "2000-01-01T00:00:00Z", downloadBytesPerSecond: 1234, uploadBytesPerSecond: 567, trackedDownloadedBytes: 9000 }) } as unknown as TunikuDatabase;
  const state = new GluetunStateService(db, { ...config, dockerProxyUrl: "http://observer:2375" });
  expect(state.trafficSummary()).toMatchObject({ available: false, downloadBytesPerSecond: 0, uploadBytesPerSecond: 0, trackedDownloadedBytes: 9000, error: expect.any(String) });
});
