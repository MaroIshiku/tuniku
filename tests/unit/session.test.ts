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
