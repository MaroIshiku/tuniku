import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";

it("keeps Docker diagnostics separate and omits ports from an unrelated API instance", async () => {
  const observer = Fastify();
  const id = "abcdef1234567890";
  let logReads = 0;
  let inspectReads = 0;
  let failInspection = false;
  observer.get("/containers/json", async () => [{ Id: id, Names: ["/gluetun"], Image: "qmcgaw/gluetun:latest" }]);
  observer.get(`/containers/${id}/json`, async (_request, reply) => { inspectReads++; if (failInspection) return reply.code(503).send({ error: "synthetic unavailable" }); return ({ Id: id, Name: "/gluetun", Config: { Env: [] }, ControlServer: { port: 8000 }, State: { Status: "running" }, HostConfig: { PortBindings: { "5800/tcp": [{ HostIp: "127.0.0.1", HostPort: "5800" }] } }, NetworkSettings: { Networks: { tuniku: { IPAddress: "127.0.0.1" } } } }); });
  observer.get(`/containers/${id}/logs`, async (_request, reply) => { logReads++; return reply.type("text/plain").send("OPENVPN_PASSWORD=synthetic-never-export\nERROR endpoint=http://name:synthetic-url-secret@host\n"); });
  await observer.listen({ host: "127.0.0.1", port: 0 });
  const port = (observer.server.address() as { port: number }).port;
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-association-api-"));
  const app = await buildApp({ ...config, dataPath, databasePath: path.join(dataPath, "test.db"), logLevel: "silent", registrationSecret: "synthetic-setup-secret", sessionSecret: "synthetic-session-secret-that-is-long", encryptionKey: "2".repeat(64), allowLoopbackUpstream: true, dockerProxyUrl: `http://127.0.0.1:${port}`, managerUrl: null });
  try {
    const registration = await app.inject({ method: "POST", url: "/api/v1/auth/register-first-admin", payload: { setupSecret: "synthetic-setup-secret", displayName: "Synthetic Admin", username: "association-admin", password: "synthetic-admin-password", passwordConfirm: "synthetic-admin-password" } });
    expect(registration.statusCode).toBe(200);
    const headers = { cookie: registration.headers["set-cookie"] as string, "x-csrf-token": registration.json().csrfToken };
    const instanceId = "11111111-1111-4111-8111-111111111111";
    const save = (baseUrl: string) => app.inject({ method: "PUT", url: `/api/v1/instances/${instanceId}`, headers, payload: { displayName: "Synthetic VPN", baseUrl, authMode: "none", tlsVerify: true, requestTimeoutSeconds: 2, saveCredential: false } });
    expect((await save("http://127.0.0.2:8000")).statusCode).toBe(200);
    const unrelated = (await app.inject({ url: `/api/v1/instances/${instanceId}/ports`, headers })).json();
    expect(unrelated.ports).toEqual([]); expect(unrelated.detection.available).toBe(false);
    const separated = (await app.inject({ url: "/api/v1/admin/docker-observation?includeLogs=false", headers })).json().observation;
    expect(inspectReads).toBe(1);
    expect(separated.observedAt).toBe(unrelated.detection.observedAt);
    expect(separated.container.name).toBe("gluetun"); expect(separated.association.state).toBe("unverified");
    expect((await save("http://127.0.0.1:8000")).statusCode).toBe(200);
    const matched = (await app.inject({ url: `/api/v1/instances/${instanceId}/ports`, headers })).json();
    expect(matched.detection.available).toBe(true); expect(matched.ports[0].hostPort).toBe(5800);
    const beforeSummary = logReads;
    expect((await app.inject({ url: "/api/v1/admin/docker-observation?includeLogs=false", headers })).statusCode).toBe(200);
    expect(logReads).toBe(beforeSummary);
    expect(inspectReads).toBe(2);
    const [freshPorts, freshMetadata] = await Promise.all([
      app.inject({ url: `/api/v1/instances/${instanceId}/ports?force=true`, headers }),
      app.inject({ url: "/api/v1/admin/docker-observation?includeLogs=false&force=true", headers })
    ]);
    expect(inspectReads).toBe(3);
    expect(freshPorts.json().detection.observedAt).toBe(freshMetadata.json().observation.observedAt);
    const beforeUnauthenticated = inspectReads;
    expect((await app.inject({ url: "/api/v1/admin/docker-observation?includeLogs=false" })).statusCode).toBe(401);
    expect(inspectReads).toBe(beforeUnauthenticated);
    const logs = await app.inject({ url: "/api/v1/admin/docker-observation?tail=500&since=1", headers });
    expect(logs.statusCode).toBe(200); expect(logs.json().observation.logs).toContain("[REDACTED]");
    expect(logs.body).not.toContain("synthetic-never-export"); expect(logs.body).not.toContain("synthetic-url-secret");
    expect(inspectReads).toBe(4); // Explicit logs bypass the metadata cache.
    for (const query of ["force=yes", "tail=1001", "since=1&until=0", "since=999999999999", "follow=true"]) expect((await app.inject({ url: `/api/v1/admin/docker-observation?${query}`, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/v1/admin/docker-observation" })).statusCode).toBe(401);
    const generate = (hostAddress: string, protocol: string, containerPort = 8080) => app.inject({ method: "POST", url: "/api/v1/compose/generate", headers, payload: { instanceId, input: { taskType: "publish_app_port", hostAddress, hostPort: 5800, containerPort, protocol } } });
    const conflict = await generate("127.0.0.1", "tcp"); expect(conflict.statusCode).toBe(400); expect(conflict.json().error.details[0].path).toBe("hostPort");
    for (const [address, protocol, target] of [["127.0.0.2", "tcp", 8080], ["127.0.0.1", "udp", 8080], ["127.0.0.1", "tcp", 5800]] as const) {
      const result = await generate(address, protocol, target); expect(result.statusCode).toBe(200);
      const check = result.json().result.validation.checks.find((item: { id: string }) => item.id === "selected_ports"); expect(check.status).toBe("passed"); expect(check.detail).toContain("Other containers and host processes were not checked");
    }
    await save("http://127.0.0.2:8000");
    const unrelatedResult = await generate("127.0.0.1", "tcp"); expect(unrelatedResult.statusCode).toBe(200);
    expect(unrelatedResult.json().result.validation.checks.find((item: { id: string }) => item.id === "selected_ports").status).toBe("not_run");
    await save("http://127.0.0.1:8000"); failInspection = true;
    const unavailable = await generate("127.0.0.1", "tcp"); expect(unavailable.statusCode).toBe(200);
    const unavailableCheck = unavailable.json().result.validation.checks.find((item: { id: string }) => item.id === "selected_ports"); expect(unavailableCheck.status).toBe("not_run"); expect(unavailableCheck.detail).toContain("inspection failed");

  } finally { await app.close(); await observer.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
});
