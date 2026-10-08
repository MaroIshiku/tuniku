import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { TunikuDatabase } from "../../src/server/db.js";
import { allocateTrafficDays, trafficDay } from "../../src/server/traffic/daily.js";
import { aggregateNetworkCounters } from "../../src/server/docker/trafficCounters.js";

const databases: TunikuDatabase[] = [], directories: string[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); vi.useRealTimers(); });
function database(): TunikuDatabase { const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-traffic-quality-")); directories.push(directory); const db = new TunikuDatabase(path.join(directory, "test.db")); databases.push(db); return db; }
it("counts all reported interfaces and rejects absent, invalid or overflowing counters", () => {
  expect(aggregateNetworkCounters({ networks: { eth0: { rx_bytes: 100, tx_bytes: 50 }, tun0: { rx_bytes: 90, tx_bytes: 40 } } })).toEqual({ receivedBytes: 190, sentBytes: 90 });
  expect(aggregateNetworkCounters({ network: { rx_bytes: 0, tx_bytes: 0 } })).toEqual({ receivedBytes: 0, sentBytes: 0 });
  for (const stats of [{}, { networks: {} }, { networks: { eth0: {} } }, { network: { rx_bytes: -1, tx_bytes: 0 } }, { network: { rx_bytes: 1.5, tx_bytes: 0 } }, { networks: { a: { rx_bytes: Number.MAX_SAFE_INTEGER, tx_bytes: 0 }, b: { rx_bytes: 1, tx_bytes: 0 } } }]) expect(() => aggregateNetworkCounters(stats)).toThrow();
});
it("distinguishes continuous rates, gaps, independent resets, replacements and ignored late samples", () => {
  vi.useFakeTimers(); const at = new Date(2026, 9, 7, 12).getTime(); vi.setSystemTime(at);
  const db = database(); const sample = (seconds: number, receivedBytes: number, sentBytes: number, containerId = "a") => { vi.setSystemTime(at + seconds * 1000); return db.recordTraffic({ containerId, receivedBytes, sentBytes, observedAt: new Date().toISOString() }); };
  expect(sample(0, 100, 50).sampleQuality).toBe("baseline");
  expect(sample(10, 300, 150)).toMatchObject({ sampleQuality: "continuous", downloadBytesPerSecond: 20, trackedDownloadedBytes: 200 });
  expect(sample(100, 1200, 600)).toMatchObject({ sampleQuality: "gap", downloadBytesPerSecond: 0, trackedDownloadedBytes: 1100 });
  const before = db.trafficSummary();
  expect(db.recordTraffic({ containerId: "a", receivedBytes: 50, sentBytes: 1, observedAt: new Date(at + 20_000).toISOString() })).toEqual(before);
  expect(sample(110, 1, 700)).toMatchObject({ sampleQuality: "reset", downloadBytesPerSecond: 0, trackedDownloadedBytes: 1100, trackedUploadedBytes: 650 });
  expect(sample(120, 21, 710)).toMatchObject({ sampleQuality: "continuous", downloadBytesPerSecond: 2 });
  expect(sample(130, 9999, 9999, "b")).toMatchObject({ sampleQuality: "baseline", downloadBytesPerSecond: 0, trackedDownloadedBytes: 1120 });
  const reopened = new TunikuDatabase(db.raw.name); databases.push(reopened);
  expect(reopened.trafficSummary()).toMatchObject({ sampleQuality: "unknown", sampleIntervalSeconds: null, trackedDownloadedBytes: 1120 });
  expect(() => db.recordTraffic({ containerId: "b", receivedBytes: 1, sentBytes: 1, observedAt: new Date(Date.now() + 120_000).toISOString() })).toThrow();
});
it("allocates a crossing interval across local days without losing rounding bytes", () => {
  const start = new Date(2026, 9, 6, 23, 59, 50), end = new Date(2026, 9, 7, 0, 0, 10);
  const rows = allocateTrafficDays(start.getTime(), end.getTime(), 201, 101, new Date(2026, 8, 1));
  expect(rows).toEqual([{ day: trafficDay(start), received: 100, sent: 50 }, { day: trafficDay(end), received: 101, sent: 51 }]);
  vi.useFakeTimers(); vi.setSystemTime(end); const db = database();
  db.recordTraffic({ containerId: "a", receivedBytes: 100, sentBytes: 50, observedAt: start.toISOString() });
  expect(db.recordTraffic({ containerId: "a", receivedBytes: 301, sentBytes: 151, observedAt: end.toISOString() })).toMatchObject({ todayDownloadedBytes: 101, todayUploadedBytes: 51, trackedDownloadedBytes: 201 });
});
it("uses actual local-day duration across a daylight-saving transition", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", 'import {allocateTrafficDays} from "./src/server/traffic/daily.ts"; console.log(JSON.stringify(allocateTrafficDays(new Date(2026,9,25).getTime(),new Date(2026,9,27).getTime(),490,49,new Date(2026,9,1))));'], { cwd: process.cwd(), env: { ...process.env, TZ: "Europe/Berlin" }, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([{ day: "2026-10-25", received: 250, sent: 25 }, { day: "2026-10-26", received: 240, sent: 24 }]);
});
it("bounds retention work and excludes the old part of a long interval", () => {
  const start = new Date(2026, 0, 1).getTime(), end = new Date(2026, 9, 7).getTime(), cutoff = new Date(2026, 6, 9);
  const rows = allocateTrafficDays(start, end, 100000, 10000, cutoff);
  expect(rows.length).toBeLessThanOrEqual(92); expect(rows[0]?.day).toBe(trafficDay(cutoff));
  expect(rows.reduce((sum, row) => sum + row.received, 0)).toBeLessThan(100000);
});


it("retains exactly today and the preceding 89 local calendar days", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 7, 12)); const db = database();
  const expired = new Date(); expired.setDate(expired.getDate() - 90);
  const retained = new Date(); retained.setDate(retained.getDate() - 89);
  const insert = db.raw.prepare("INSERT INTO traffic_daily(day, downloaded_bytes, uploaded_bytes) VALUES (?, ?, ?)");
  insert.run(trafficDay(expired), 1000, 500); insert.run(trafficDay(retained), 100, 50);
  expect(db.recordTraffic({ containerId: "a", receivedBytes: 10, sentBytes: 5, observedAt: new Date().toISOString() })).toMatchObject({ trackedDownloadedBytes: 100, trackedUploadedBytes: 50 });
  expect(db.raw.pragma("user_version", { simple: true })).toBe(4);
});


it("returns bounded descending daily history without filling missing days or exposing other data", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 7, 12)); const db = database();
  expect(db.trafficSummary().history?.days).toEqual([]);
  const insert = db.raw.prepare("INSERT INTO traffic_daily(day, downloaded_bytes, uploaded_bytes) VALUES (?, ?, ?)");
  insert.run("2026-10-07", 1024, 512); insert.run("2026-10-05", 100, 0);
  insert.run("2026-01-01", 9999, 9999); insert.run("2026-10-08", 9999, 9999);
  expect(db.trafficSummary().history).toEqual({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [
    { day: "2026-10-07", downloadedBytes: 1024, uploadedBytes: 512 }, { day: "2026-10-05", downloadedBytes: 100, uploadedBytes: 0 }
  ] });
  const reopened = new TunikuDatabase(db.raw.name); databases.push(reopened);
  expect(reopened.trafficSummary().history).toEqual(db.trafficSummary().history);
});
