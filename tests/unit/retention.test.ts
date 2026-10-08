import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { expect, it } from "vitest";
import { DraftCapacityError, retentionPolicy, TunikuDatabase } from "../../src/server/db.js";

function fixture(run: (db: TunikuDatabase) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-retention-"));
  const db = new TunikuDatabase(path.join(dir, "test.db"));
  try { run(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
function draft(db: TunikuDatabase, output = "redacted") {
  const id = crypto.randomUUID();
  db.saveDraft({ id, instanceId: null, title: "Synthetic", taskType: "enable_control_server", nonSecretInput: {}, redactedOutput: output, containsSecretValues: false });
  return id;
}

it("bounds draft counts, preserves legacy excess and allows space reclaimed by explicit deletion", () => fixture((db) => {
  const seed = draft(db);
  db.raw.transaction(() => {
    const insert = db.raw.prepare("INSERT INTO compose_drafts SELECT ?,instance_id,title,task_type,non_secret_input_json,generated_output_redacted,contains_secret_values,created_at,updated_at FROM compose_drafts WHERE id=?");
    for (let i = 1; i < retentionPolicy.draftCount; i++) insert.run(crypto.randomUUID(), seed);
  })();
  expect(() => draft(db)).toThrow(DraftCapacityError);
  expect(db.draftUsage().count).toBe(1000); expect(db.getDraft(seed)).not.toBeNull();
  db.deleteDraft(seed); draft(db); expect(db.draftUsage().count).toBe(1000);
  db.raw.prepare("INSERT INTO compose_drafts SELECT ?,instance_id,title,task_type,non_secret_input_json,generated_output_redacted,contains_secret_values,created_at,updated_at FROM compose_drafts LIMIT 1").run(crypto.randomUUID());
  expect(() => draft(db)).toThrow(DraftCapacityError); expect(db.draftUsage().count).toBe(1001);
}));

it("counts UTF-8 bytes rather than characters and atomically rejects saves beyond the byte boundary", () => fixture((db) => {
  const id = draft(db, "é"); expect(db.draftUsage().bytes).toBe(4);
  db.raw.prepare("UPDATE compose_drafts SET generated_output_redacted=? WHERE id=?").run("x".repeat(retentionPolicy.draftBytes - 6), id);
  draft(db, "é"); expect(db.draftUsage().bytes).toBe(retentionPolicy.draftBytes);
  expect(() => draft(db, "")).toThrow(DraftCapacityError); expect(db.draftUsage().count).toBe(2);
  db.raw.prepare("UPDATE compose_drafts SET generated_output_redacted=generated_output_redacted || 'legacy' WHERE id=?").run(id);
  expect(() => draft(db)).toThrow(DraftCapacityError); expect(db.getDraft(id)).not.toBeNull();
}));

it("prunes expired and excess audit events deterministically while preserving drafts and the newest event", () => fixture((db) => {
  const saved = draft(db);
  const insert = db.raw.prepare("INSERT INTO audit_events (id,request_id,event_type,result,redacted_metadata_json,created_at) VALUES (?,'synthetic','test','success','{}',?)");
  db.raw.transaction(() => {
    insert.run("expired", new Date(Date.now() - 91 * 86400000).toISOString());
    for (let i = 0; i < 10003; i++) insert.run(String(i).padStart(8, "0"), new Date(Date.now() - 3600000).toISOString());
  })();
  db.audit({ id: "newest", requestId: "synthetic", userId: null, instanceId: null, type: "test", result: "success", metadata: {} });
  expect((db.raw.prepare("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number }).count).toBe(10000);
  expect(db.raw.prepare("SELECT id FROM audit_events WHERE id='expired'").get()).toBeUndefined();
  expect(db.raw.prepare("SELECT id FROM audit_events WHERE id='newest'").get()).toBeDefined();
  expect(db.getDraft(saved)).not.toBeNull(); expect(db.raw.pragma("user_version", { simple: true })).toBe(4);
  expect(db.pruneAudit()).toBe(0);
}));
