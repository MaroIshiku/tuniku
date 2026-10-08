import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";

it("scopes stored credentials to the destination and retains blank Basic Auth fields safely", async () => {
  let received = "";
  const upstream = Fastify();
  upstream.get("/v1/vpn/status", async (request, reply) => {
    received = request.headers.authorization ?? "";
    if (received !== `Basic ${Buffer.from("synthetic-user:synthetic-password").toString("base64")}`) return reply.code(401).send();
    return { status: "running" };
  });
  await upstream.listen({ host: "127.0.0.1", port: 0 });
  const address = upstream.server.address() as { port: number };
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-credentials-"));
  const app = await buildApp({ ...config, dataPath, databasePath: path.join(dataPath, "test.db"), logLevel: "silent", registrationSecret: "synthetic-setup-secret", sessionSecret: "synthetic-session-secret-that-is-long", encryptionKey: "2".repeat(64), allowLoopbackUpstream: true });
  try {
    const registration = await app.inject({ method: "POST", url: "/api/v1/auth/register-first-admin", payload: { setupSecret: "synthetic-setup-secret", displayName: "Synthetic Admin", username: "credential-test", password: "synthetic-admin-password", passwordConfirm: "synthetic-admin-password" } });
    expect(registration.statusCode).toBe(200);
    const headers = { cookie: registration.headers["set-cookie"] as string, "x-csrf-token": registration.json().csrfToken };
    const id = "11111111-1111-4111-8111-111111111111";
    const url = `/api/v1/instances/${id}`;
    const settings = { displayName: "Gluetun", baseUrl: `http://127.0.0.1:${address.port}`, authMode: "basic", tlsVerify: true, requestTimeoutSeconds: 2, saveCredential: true };
    const preview = await app.inject({ method: "POST", url: `${url}/test`, headers, payload: { configuration: { ...settings, username: "synthetic-user", password: "synthetic-password" } } });
    expect(preview.json().authenticationAccepted).toBe(true);
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url, headers, payload: { ...settings, username: "synthetic-user", password: "synthetic-password" } })).statusCode).toBe(200);
    const beforePreview = (await app.inject({ method: "GET", url, headers })).json();
    const failedPreview = await app.inject({ method: "POST", url: `${url}/test`, headers, payload: { configuration: { ...settings, baseUrl: `${settings.baseUrl}/different`, username: "", password: "" } } });
    expect(failedPreview.json().authenticationAccepted).toBe(false);
    expect((await app.inject({ method: "GET", url, headers })).json()).toEqual(beforePreview);
    const rejectedPreview = await app.inject({ method: "POST", url: `${url}/test`, headers, payload: { configuration: { ...settings, baseUrl: "http://169.254.169.254" } } });
    expect(rejectedPreview.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url, headers })).json()).toEqual(beforePreview);
    expect((await app.inject({ method: "PUT", url, headers, payload: { ...settings, username: "", password: "" } })).statusCode).toBe(200);
    const tested = await app.inject({ method: "POST", url: `${url}/test`, headers, payload: { username: "", password: "" } });
    expect(tested.json().authenticationAccepted).toBe(true);
    const transient = await app.inject({ method: "PUT", url, headers, payload: { ...settings, saveCredential: false } });
    expect(transient.json().instance.hasStoredCredential).toBe(false);
    expect((await app.inject({ method: "POST", url: `${url}/test`, headers, payload: {} })).json().authenticationAccepted).toBe(true);
    const changed = await app.inject({ method: "PUT", url, headers, payload: { ...settings, baseUrl: `${settings.baseUrl}/different`, saveCredential: false } });
    expect(changed.statusCode).toBe(200);
    const noRoutes = await app.inject({ method: "POST", url: `${url}/test`, headers, payload: {} });
    expect(noRoutes.json().authenticationAccepted).toBe(false);
    const badPort = await app.inject({ method: "PUT", url: `${url}/port-labels/22222222-2222-4222-8222-222222222222`, headers, payload: { label: "missing", hostAddress: null, hostPort: 5800, containerPort: 5800, protocol: "tcp", notes: "" } });
    expect(badPort.statusCode).toBe(404);
    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers, payload: {} });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/instances", headers })).statusCode).toBe(401);
  } finally {
    await app.close();
    await upstream.close();
    fs.rmSync(dataPath, { recursive: true, force: true });
  }
});
