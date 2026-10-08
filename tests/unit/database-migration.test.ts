import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { TunikuDatabase } from "../../src/server/db.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function file() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-schema-")); roots.push(root); return path.join(root, "synthetic.db"); }
it("rolls back the whole upgrade after a late DDL collision and allows a repaired retry", () => {
  const target = file(); new TunikuDatabase(target).close();
  const before = new Database(target); before.exec("DROP TABLE traffic_state; PRAGMA user_version=3;"); before.close();
  expect(() => new TunikuDatabase(target)).toThrow(/traffic_daily/);
  const check = new Database(target); expect(check.pragma("user_version", { simple: true })).toBe(3); expect(check.prepare("SELECT name FROM sqlite_master WHERE name='traffic_state'").get()).toBeUndefined();
  check.exec("DROP TABLE traffic_daily"); check.close(); const repaired = new TunikuDatabase(target); expect(repaired.raw.pragma("user_version", { simple: true })).toBe(4); expect(repaired.raw.prepare("SELECT name FROM sqlite_master WHERE name='traffic_state'").get()).toBeTruthy(); repaired.close();
});
it("rolls back earlier migration steps on a later failure, preserving old session data", () => {
  const target = file(); new TunikuDatabase(target).close(); const before = new Database(target); before.exec("ALTER TABLE sessions DROP COLUMN last_seen_at; PRAGMA user_version=1;"); before.close();
  expect(() => new TunikuDatabase(target)).toThrow(); const check = new Database(target); expect(check.pragma("user_version", { simple: true })).toBe(1); expect((check.pragma("table_info(sessions)") as Array<{ name: string }>).map(column => column.name)).not.toContain("last_seen_at"); check.close();
});
it("refuses future schemas before journal changes and closes the constructor connection", () => {
  const target = file(); const future = new Database(target); future.exec("CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES ('synthetic'); PRAGMA user_version=99"); future.close();
  expect(() => new TunikuDatabase(target)).toThrow(/newer/); const check = new Database(target); expect(check.pragma("user_version", { simple: true })).toBe(99); expect(check.pragma("journal_mode", { simple: true })).toBe("delete"); expect(check.prepare("SELECT value FROM future_data").get()).toEqual({ value: "synthetic" }); check.close();
});
