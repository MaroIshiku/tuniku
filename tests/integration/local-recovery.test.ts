import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { TunikuDatabase } from "../../src/server/db.js";
import { recoverLocalAdmin } from "../../src/server/recovery/localAdmin.js";
import { runRecovery } from "../../src/server/recover-admin.js";
import { hashPassword, verifyPassword } from "../../src/server/security.js";

it("recovers one local admin atomically while retaining settings, encrypted records, drafts and keys", async () => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-local-recovery-"));
  const databasePath = path.join(dataPath, "tuniku.db");
  const db = new TunikuDatabase(databasePath);
  const oldHash = await hashPassword("synthetic-old-admin-password");
  const id = "11111111-1111-4111-8111-111111111111";
  db.createFirstAdmin({ id, username: "recovery-admin", displayName: "Synthetic", email: null, passwordHash: oldHash });
  db.createSession("old-session", id, "synthetic-csrf", "2099-01-01T00:00:00.000Z");
  db.raw.prepare("INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,'other-admin','Other',?,'admin',?)").run("22222222-2222-4222-8222-222222222222", oldHash, new Date().toISOString());
  db.createSession("other-session", "22222222-2222-4222-8222-222222222222", "other-csrf", "2099-01-01T00:00:00.000Z");
  db.upsertInstance({ id: "33333333-3333-4333-8333-333333333333", displayName: "VPN", baseUrl: "http://gluetun:8000", authMode: "api_key", tlsVerify: true, requestTimeoutSeconds: 15, encryptedCredential: "synthetic-retained-encrypted-record" });
  db.saveDraft({ id: "44444444-4444-4444-8444-444444444444", instanceId: null, title: "Retain", taskType: "configure_control_auth", nonSecretInput: {}, redactedOutput: "redacted", containsSecretValues: false });
  fs.writeFileSync(path.join(dataPath, "synthetic-key"), "synthetic-preserved-key", { mode: 0o600 });
  for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(databasePath + suffix)) fs.chmodSync(databasePath + suffix, 0o600);
  const input = { databasePath, username: "recovery-admin", password: "synthetic-new-admin-password", passwordConfirm: "synthetic-new-admin-password", serviceStopped: true, backupConfirmed: true };
  try {
    await expect(recoverLocalAdmin({ ...input, backupConfirmed: false })).rejects.toThrow("backup");
    await expect(recoverLocalAdmin({ ...input, passwordConfirm: "different" })).rejects.toThrow("confirmation");
    await expect(recoverLocalAdmin({ ...input, password: "short", passwordConfirm: "short" })).rejects.toThrow("12");
    await expect(recoverLocalAdmin({ ...input, username: "unknown-admin" })).rejects.toThrow("does not exist");
    await expect(runRecovery(["--password", "synthetic-never-accepted"])).rejects.toThrow("Never pass a password");
    await expect(runRecovery(["--database", databasePath, "--username", "recovery-admin", "--service-stopped", "--backup-confirmed"])).rejects.toThrow("interactive terminal");
    const alias = path.join(dataPath, "alias.db"); fs.symlinkSync(databasePath, alias);
    await expect(recoverLocalAdmin({ ...input, databasePath: alias })).rejects.toThrow("private regular file");
    fs.chmodSync(databasePath, 0o644); await expect(recoverLocalAdmin(input)).rejects.toThrow("private regular file"); fs.chmodSync(databasePath, 0o600);
    db.raw.exec("PRAGMA user_version=99"); await expect(recoverLocalAdmin(input)).rejects.toThrow("does not migrate"); db.raw.exec("PRAGMA user_version=4");
    db.raw.exec("CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    await expect(recoverLocalAdmin(input)).rejects.toThrow("synthetic audit failure");
    expect(db.findUserByUsername("recovery-admin")?.passwordHash).toBe(oldHash); expect(db.raw.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 2 });
    db.raw.exec("DROP TRIGGER fail_recovery_audit");
    expect(await recoverLocalAdmin(input)).toEqual({ revokedSessions: 1 });
    const recovered = db.findUserByUsername("recovery-admin")!;
    expect(await verifyPassword(recovered.passwordHash, input.password)).toBe(true); expect(await verifyPassword(recovered.passwordHash, "synthetic-old-admin-password")).toBe(false);
    expect(recovered.id).toBe(id); expect(db.raw.prepare("SELECT id_hash FROM sessions").all()).toEqual([{ id_hash: "other-session" }]);
    expect(db.storedCredential("33333333-3333-4333-8333-333333333333")).toBe("synthetic-retained-encrypted-record"); expect(db.draftSummaries()).toHaveLength(1);
    expect(fs.readFileSync(path.join(dataPath, "synthetic-key"), "utf8")).toBe("synthetic-preserved-key");
    expect(JSON.stringify(db.recentAudit())).not.toContain(input.password); expect(JSON.stringify(db.recentAudit())).not.toContain(oldHash);
  } finally { db.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
});
