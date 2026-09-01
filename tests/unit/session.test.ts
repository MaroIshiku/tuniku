import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TunikuDatabase } from "../../src/server/db.js";

describe("session lifetime", () => {
  it("expires an idle session independently of its absolute expiry", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-session-"));
    const db = new TunikuDatabase(path.join(dataPath, "tuniku.db"));
    const user = db.createFirstAdmin({
      id: "11111111-1111-4111-8111-111111111111",
      username: "admin",
      displayName: "Admin",
      email: null,
      passwordHash: "not-used-in-this-database-test"
    });
    db.createSession("session-hash", user.id, "csrf", "2099-01-01T00:00:00.000Z");
    db.raw.prepare("UPDATE sessions SET last_seen_at=? WHERE id_hash=?")
      .run("2000-01-01T00:00:00.000Z", "session-hash");

    expect(db.getSession("session-hash", "2026-01-01T00:00:00.000Z")).toBeNull();
    db.pruneSessions("2026-01-01T00:00:00.000Z");
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    db.close();
  });
});

describe("privacy-preserving traffic accounting", () => {
  it("records only positive aggregate deltas and survives a Gluetun container replacement", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-traffic-"));
    const db = new TunikuDatabase(path.join(dataPath, "tuniku.db"));
    const firstAt = new Date(Date.now() - 10_000).toISOString();
    const secondAt = new Date().toISOString();

    expect(db.recordTraffic({ containerId: "container-a", receivedBytes: 1_000, sentBytes: 500, observedAt: firstAt })).toMatchObject({
      available: true,
      trackedDownloadedBytes: 0,
      trackedUploadedBytes: 0
    });
    expect(db.recordTraffic({ containerId: "container-a", receivedBytes: 3_000, sentBytes: 1_500, observedAt: secondAt })).toMatchObject({
      sessionDownloadedBytes: 3_000,
      sessionUploadedBytes: 1_500,
      trackedDownloadedBytes: 2_000,
      trackedUploadedBytes: 1_000
    });
    expect(db.recordTraffic({ containerId: "container-b", receivedBytes: 20, sentBytes: 10, observedAt: new Date(Date.now() + 10_000).toISOString() })).toMatchObject({
      sessionDownloadedBytes: 20,
      sessionUploadedBytes: 10,
      trackedDownloadedBytes: 2_000,
      trackedUploadedBytes: 1_000
    });
    expect(db.raw.pragma("user_version", { simple: true })).toBe(4);
    db.close();
  });
});
