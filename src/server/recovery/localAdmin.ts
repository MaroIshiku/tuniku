import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { hashPassword, validateAdminInput } from "../security.js";

export async function recoverLocalAdmin(input: { databasePath: string; username: string; password: string; passwordConfirm: string; serviceStopped: boolean; backupConfirmed: boolean; setupSecret?: string }): Promise<{ revokedSessions: number }> {
  if (!input.serviceStopped || !input.backupConfirmed) throw new Error("Stop Tuniku and confirm a protected matching backup before recovery.");
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(input.username)) throw new Error("Choose an existing administrator username.");
  if (input.password.length > 4096) throw new Error("Password is too long.");
  const setupSecret = input.setupSecret ?? "local-recovery-validation";
  const errors = validateAdminInput({ setupSecret, configuredSecret: setupSecret, displayName: "Local recovery", username: input.username, password: input.password, passwordConfirm: input.passwordConfirm });
  if (errors.length) throw new Error(errors[0]);
  const databasePath = path.resolve(input.databasePath);
  const owner = process.getuid?.();
  if (owner === undefined) throw new Error("Local recovery requires Linux file ownership checks.");
  const directory = fs.lstatSync(path.dirname(databasePath));
  const file = fs.lstatSync(databasePath);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== owner || (directory.mode & 0o077) !== 0) throw new Error("The database directory must be private and owned by the recovery user.");
  if (!file.isFile() || file.isSymbolicLink() || file.uid !== owner || (file.mode & 0o077) !== 0) throw new Error("The database must be a private regular file owned by the recovery user.");
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${databasePath}${suffix}`;
    let stat: fs.Stats;
    try { stat = fs.lstatSync(sidecar); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== owner || (stat.mode & 0o077) !== 0) throw new Error("SQLite sidecar files must be private regular files owned by the recovery user.");
  }
  const db = new Database(databasePath, { fileMustExist: true, timeout: 1000 });
  try {
    if (db.pragma("user_version", { simple: true }) !== 4) throw new Error("Use the recovery tool matching this database version; recovery does not migrate databases.");
    const user = db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND role='admin'").get(input.username) as { id: string } | undefined;
    if (!user) throw new Error("The selected administrator does not exist.");
    const passwordHash = await hashPassword(input.password);
    const transaction = db.transaction(() => {
      const changed = db.prepare("UPDATE users SET password_hash=? WHERE id=? AND role='admin'").run(passwordHash, user.id).changes;
      if (changed !== 1) throw new Error("The administrator changed during recovery. Retry with the service stopped.");
      const revokedSessions = db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id).changes;
      db.prepare("INSERT INTO audit_events (id,request_id,user_id,instance_id,event_type,result,redacted_metadata_json,created_at) VALUES (?,?,?,NULL,'local_admin_recovery','success',?,?)")
        .run(crypto.randomUUID(), crypto.randomUUID(), user.id, JSON.stringify({ revokedSessions, actor: "local_data_owner" }), new Date().toISOString());
      return { revokedSessions };
    });
    return transaction.immediate();
  } finally { db.close(); }
}
