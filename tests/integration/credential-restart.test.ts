import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";
import { TunikuDatabase } from "../../src/server/db.js";

it("loses transient access on restart and recovers stored access with the matching key without destroying data", async () => {
  const upstream = Fastify();
  upstream.get("/v1/vpn/status", async (request, reply) => request.headers["x-api-key"] === "synthetic-restart-key" ? { status: "running" } : reply.code(401).send());
  await upstream.listen({ host: "127.0.0.1", port: 0 });
  const port = (upstream.server.address() as { port: number }).port;
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-restart-"));
  const settings = { ...config, dataPath, databasePath: path.join(dataPath, "test.db"), logLevel: "silent", registrationSecret: "synthetic-restart-setup", sessionSecret: "synthetic-restart-session-secret-over32", encryptionKey: "2".repeat(64), allowLoopbackUpstream: true, dockerProxyUrl: null, managerUrl: null };
  let app = await buildApp(settings);
  const db = new TunikuDatabase(settings.databasePath);
  try {
    const registered = await app.inject({ method: "POST", url: "/api/v1/auth/register-first-admin", payload: { setupSecret: settings.registrationSecret, displayName: "Synthetic Admin", username: "restart-admin", password: "synthetic-restart-admin-password", passwordConfirm: "synthetic-restart-admin-password" } });
    const headers = { cookie: registered.headers["set-cookie"] as string, "x-csrf-token": registered.json().csrfToken };
    const id = "11111111-1111-4111-8111-111111111111", url = `/api/v1/instances/${id}`;
    const connection = { displayName: "Synthetic", baseUrl: `http://127.0.0.1:${port}`, authMode: "api_key", tlsVerify: true, requestTimeoutSeconds: 2 };
    const access = async () => (await app.inject({ url: "/api/v1/admin/diagnostics", headers })).json().gluetun.accessState;
    const accepted = async () => (await app.inject({ method: "POST", url: `${url}/test`, headers, payload: {} })).json().authenticationAccepted;
    expect((await app.inject({ method: "PUT", url, headers, payload: { ...connection, apiKey: "synthetic-restart-key", saveCredential: false } })).statusCode).toBe(200);
    expect(await access()).toBe("memory_only"); expect(await accepted()).toBe(true); expect(db.storedCredential(id)).toBeNull();
    await app.close(); app = await buildApp(settings);
    expect(await access()).toBe("required"); expect(await accepted()).toBe(false); expect(db.getInstance(id)?.baseUrl).toBe(connection.baseUrl);
    await app.inject({ method: "PUT", url, headers, payload: { ...connection, apiKey: "synthetic-restart-key", saveCredential: true } });
    const encrypted = db.storedCredential(id); expect(encrypted).toBeTruthy(); expect(encrypted).not.toContain("synthetic-restart-key");
    await app.close(); app = await buildApp(settings);
    expect(await access()).toBe("stored_readable"); expect(await accepted()).toBe(true);
    await app.close(); app = await buildApp({ ...settings, encryptionKey: "3".repeat(64) });
    expect(await access()).toBe("stored_unreadable"); expect(await accepted()).toBe(false);
    expect(db.storedCredential(id)).toBe(encrypted); expect(db.adminCount()).toBe(1); expect(db.listInstances()).toHaveLength(1);
    const diagnostics = await app.inject({ url: "/api/v1/admin/diagnostics", headers });
    expect(diagnostics.body).not.toContain("synthetic-restart-key"); expect(diagnostics.body).not.toContain(encrypted!);
    await app.close(); app = await buildApp(settings);
    expect(await access()).toBe("stored_readable"); expect(await accepted()).toBe(true); expect(db.storedCredential(id)).toBe(encrypted);
    await app.inject({ method: "DELETE", url: `${url}/stored-credential`, headers });
    expect(await access()).toBe("required"); expect(await accepted()).toBe(false); expect(db.storedCredential(id)).toBeNull();
  } finally { db.close(); await app.close(); await upstream.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
});
