import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";
import { TunikuDatabase } from "../../src/server/db.js";

it("does not extend idle sessions with reads, requires CSRF activity, and cannot revive expired sessions", async () => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-idle-"));
  const databasePath = path.join(dataPath, "test.db");
  const app = await buildApp({ ...config, dataPath, databasePath, logLevel: "silent", registrationSecret: "synthetic-idle-setup", sessionSecret: "synthetic-idle-session-secret-over32", encryptionKey: "2".repeat(64), managerUrl: null, dockerProxyUrl: null });
  const db = new TunikuDatabase(databasePath);
  try {
    const register = await app.inject({ method: "POST", url: "/api/v1/auth/register-first-admin", payload: { setupSecret: "synthetic-idle-setup", displayName: "Synthetic Admin", username: "idle-admin", password: "synthetic-idle-admin-password", passwordConfirm: "synthetic-idle-admin-password" } });
    const headers = { cookie: register.headers["set-cookie"] as string, "x-csrf-token": register.json().csrfToken };
    const old = new Date(Date.now() - 29 * 60_000).toISOString();
    db.raw.prepare("UPDATE sessions SET last_seen_at=?").run(old);
    const lastSeen = () => (db.raw.prepare("SELECT last_seen_at FROM sessions").get() as { last_seen_at: string }).last_seen_at;
    for (const url of ["/api/v1/auth/session", "/api/v1/auth/sessions", "/api/v1/admin/traffic", "/api/v1/instances", "/api/v1/compose/providers"]) {
      expect((await app.inject({ url, headers })).statusCode).toBe(200); expect(lastSeen()).toBe(old);
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/activity", headers: { cookie: headers.cookie }, payload: {} })).statusCode).toBe(403); expect(lastSeen()).toBe(old);
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/activity", headers, payload: {} })).statusCode).toBe(200); expect(lastSeen()).not.toBe(old);
    db.raw.prepare("UPDATE sessions SET last_seen_at=?").run(new Date(Date.now() - 31 * 60_000).toISOString());
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/activity", headers, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/auth/session", headers })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "idle-admin", password: "synthetic-idle-admin-password" } });
    const activeHeaders = { cookie: login.headers["set-cookie"] as string, "x-csrf-token": login.json().csrfToken };
    db.raw.prepare("UPDATE sessions SET expires_at=?").run(new Date(Date.now() - 1_000).toISOString());
    expect((await app.inject({ method: "POST", url: "/api/v1/auth/activity", headers: activeHeaders, payload: {} })).statusCode).toBe(401);
  } finally { db.close(); await app.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
});
