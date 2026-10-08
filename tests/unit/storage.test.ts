import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { TunikuDatabase } from "../../src/server/db.js";
import { storageDiagnostics } from "../../src/server/storageDiagnostics.js";

it("creates a private WAL database and diagnoses insecure legacy modes without changing them or leaking paths", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-storage-"));
  const databasePath = path.join(directory, "private", "test.db");
  let db = new TunikuDatabase(databasePath);
  try {
    expect(storageDiagnostics(databasePath)).toEqual({ privateDirectory: true, privateDatabase: true, privateSidecars: true, ownerMatches: true, checked: true });
    fs.chmodSync(`${databasePath}-wal`, 0o644);
    expect(storageDiagnostics(databasePath).privateSidecars).toBe(false);
    fs.chmodSync(`${databasePath}-wal`, 0o600);
    expect(db.raw.pragma("journal_mode", { simple: true })).toBe("wal"); db.close();
    fs.chmodSync(databasePath, 0o644); fs.chmodSync(path.dirname(databasePath), 0o755);
    db = new TunikuDatabase(databasePath);
    expect(storageDiagnostics(databasePath)).toMatchObject({ privateDirectory: false, privateDatabase: false, ownerMatches: true });
    expect(fs.statSync(databasePath).mode & 0o777).toBe(0o644);
    const alias = path.join(directory, "alias.db"); fs.symlinkSync(databasePath, alias);
    expect(storageDiagnostics(alias).privateDatabase).toBe(false);
    const missing = storageDiagnostics(path.join(directory, "missing.db")); expect(missing.checked).toBe(false); expect(JSON.stringify(missing)).not.toContain(directory);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
