import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";

it.each([false, true])("keeps cookie and browser transport policy consistent with secureCookies=%s", async (secureCookies) => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-http-test-"));
  const app = await buildApp({ ...config, dataPath, databasePath: path.join(dataPath, "test.db"), logLevel: "silent", registrationSecret: "synthetic-http-setup", sessionSecret: "synthetic-http-session-key-over-32-characters", encryptionKey: "4".repeat(64), secureCookies, managerUrl: null });
  try {
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/traffic" })).statusCode).toBe(401);
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/register-first-admin", payload: { setupSecret: "synthetic-http-setup", displayName: "Synthetic HTTP Admin", username: "http-admin", password: "synthetic-http-admin-password", passwordConfirm: "synthetic-http-admin-password" } });
    expect(response.statusCode).toBe(200);
    const cookie = response.headers["set-cookie"] as string;
    const historyResponse = await app.inject({ method: "GET", url: "/api/v1/admin/traffic", headers: { cookie } });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().traffic.history).toEqual({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [] });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie.includes("Secure")).toBe(secureCookies);
    const diagnostics = (await app.inject({ url: "/api/v1/admin/diagnostics", headers: { cookie } })).json();
    expect(diagnostics.transport).toEqual({ mode: secureCookies ? "https_proxy" : "local_http", observedProtocol: "http", trustedProxyCount: config.trustedProxyCount });
    expect(diagnostics.database.journalMode).toBe("wal");
    expect(diagnostics.database.storage).toEqual({ privateDirectory: true, privateDatabase: true, privateSidecars: true, ownerMatches: true, checked: true });
    expect(JSON.stringify(diagnostics)).not.toContain(dataPath);
    expect(Boolean(response.headers["strict-transport-security"])).toBe(secureCookies);
    expect(String(response.headers["content-security-policy"]).includes("upgrade-insecure-requests")).toBe(secureCookies);
    expect((await app.inject({ method: "POST", url: "/api/v1/management/apply", headers: { cookie }, payload: {} })).statusCode).toBe(403);
  } finally { await app.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
});
