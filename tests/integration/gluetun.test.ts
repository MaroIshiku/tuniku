import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";

const apps: Array<{ close: () => Promise<unknown> }> = [];

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function mockGluetun() {
  const mock = Fastify();
  let vpnStatus = "stopped";
  mock.get("/v1/vpn/status", async () => ({ status: vpnStatus }));
  mock.put("/v1/vpn/status", async (request) => {
    vpnStatus = (request.body as any).status;
    return { status: vpnStatus };
  });
  mock.get("/v1/vpn/settings", async () => ({ provider: "mock", WIREGUARD_PRIVATE_KEY: "secret" }));
  mock.get("/v1/publicip/ip", async () => ({ public_ip: "203.0.113.10" }));
  mock.get("/v1/dns/status", async () => ({ status: "running" }));
  mock.put("/v1/dns/status", async (request) => request.body);
  mock.get("/v1/updater/status", async () => ({ status: "completed" }));
  mock.put("/v1/updater/status", async (request) => request.body);
  mock.get("/v1/portforward", async () => ({ port: 51413 }));
  mock.put("/v1/portforward", async (request) => request.body);
  await mock.listen({ host: "127.0.0.1", port: 0 });
  apps.push(mock);
  return mock;
}

describe("authenticated Gluetun flow", () => {
  it("registers the first admin, discovers capabilities, and verifies a VPN action", async () => {
    const mock = await mockGluetun();
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-integration-"));
    const app = await buildApp({
      ...config,
      dataPath,
      databasePath: path.join(dataPath, "tuniku.db"),
      registrationSecret: "integration-setup-secret",
      sessionSecret: "integration-session-secret-that-is-long",
      encryptionKey: "2".repeat(64),
      allowLoopbackUpstream: true
    });
    apps.push(app);
    await app.ready();

    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register-first-admin",
      payload: {
        setupSecret: "integration-setup-secret",
        displayName: "Integration Admin",
        username: "integration",
        email: "",
        password: "a unique integration password",
        passwordConfirm: "a unique integration password"
      }
    });
    expect(registration.statusCode).toBe(200);
    const cookie = registration.headers["set-cookie"] as string;
    const csrf = registration.json().csrfToken as string;
    const instanceId = "11111111-1111-4111-8111-111111111111";
    const address = mock.server.address();
    if (!address || typeof address === "string") throw new Error("Mock address is unavailable.");

    const saved = await app.inject({
      method: "PUT",
      url: `/api/v1/instances/${instanceId}`,
      headers: { cookie, "x-csrf-token": csrf },
      payload: {
        displayName: "Mock Gluetun",
        baseUrl: `http://127.0.0.1:${address.port}`,
        authMode: "none",
        tlsVerify: true,
        requestTimeoutSeconds: 5,
        saveCredential: false
      }
    });
    expect(saved.statusCode).toBe(200);

    const tested = await app.inject({
      method: "POST",
      url: `/api/v1/instances/${instanceId}/test`,
      headers: { cookie, "x-csrf-token": csrf },
      payload: {}
    });
    expect(tested.statusCode).toBe(200);
    expect(tested.json().capabilities.vpn.state).toBe("available");

    const started = await app.inject({
      method: "POST",
      url: `/api/v1/instances/${instanceId}/vpn/start`,
      headers: { cookie, "x-csrf-token": csrf },
      payload: { confirmed: true }
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().result.status).toBe("running");
    expect(started.json().overview.settings.WIREGUARD_PRIVATE_KEY).toBe("[REDACTED]");

    const rejectedWithoutCsrf = await app.inject({
      method: "POST",
      url: `/api/v1/instances/${instanceId}/vpn/stop`,
      headers: { cookie },
      payload: { confirmed: true }
    });
    expect(rejectedWithoutCsrf.statusCode).toBe(403);
  });
});
