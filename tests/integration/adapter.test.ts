import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { DockerObserver } from "../../src/server/docker/observer.js";
import { GluetunAdapter, GluetunError } from "../../src/server/gluetun/adapter.js";
import type { InstanceRecord } from "../../src/server/types.js";

const servers: Array<{ close: () => Promise<unknown> }> = [];

afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

async function listen(configure: (server: ReturnType<typeof Fastify>) => void): Promise<string> {
  const server = Fastify({ logger: false });
  configure(server);
  await server.listen({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Mock server address unavailable.");
  return `http://127.0.0.1:${address.port}`;
}

function instance(baseUrl: string, timeout = 2): InstanceRecord {
  const timestamp = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Mock",
    baseUrl,
    authMode: "none",
    tlsVerify: true,
    requestTimeoutSeconds: timeout,
    hasStoredCredential: false,
    capabilityCache: null,
    lastConnectedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

describe("Gluetun capability failures", () => {
  it("distinguishes unauthorized, unsupported, and changed schemas", async () => {
    const unauthorizedUrl = await listen((server) => server.all("*", async (_request, reply) => reply.code(401).send()));
    const unauthorized = new GluetunAdapter(instance(unauthorizedUrl), null, true);
    expect((await unauthorized.probe()).vpn.state).toBe("unauthorized");
    unauthorized.close();

    const unsupportedUrl = await listen((server) => server.all("*", async (_request, reply) => reply.code(404).send()));
    const unsupported = new GluetunAdapter(instance(unsupportedUrl), null, true);
    expect((await unsupported.probe()).dns.state).toBe("unsupported");
    unsupported.close();

    const schemaUrl = await listen((server) => server.get("/v1/vpn/status", async () => ({ unexpected: true })));
    const schema = new GluetunAdapter(instance(schemaUrl), null, true);
    await expect(schema.read("vpn")).rejects.toMatchObject({ code: "invalid_schema" });
    schema.close();
  });

  it("reports bounded timeouts", async () => {
    const timeoutUrl = await listen((server) => server.get("/v1/vpn/status", async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { status: "running" };
    }));
    const adapter = new GluetunAdapter(instance(timeoutUrl, 0.01), null, true);
    await expect(adapter.read("vpn")).rejects.toEqual(expect.objectContaining<GluetunError>({ code: "timeout" }));
    adapter.close();
  });

  it("accepts current Gluetun mutation outcomes and an empty forwarded-port response", async () => {
    const url = await listen((server) => {
      server.put("/v1/vpn/status", async () => ({ outcome: "running" }));
      server.get("/v1/portforward", async () => ({ port: 0, ports: null }));
    });
    const adapter = new GluetunAdapter(instance(url), null, true);
    await expect(adapter.mutate("vpn", { status: "running" })).resolves.toEqual({ status: "running" });
    await expect(adapter.read("portForwarding")).resolves.toEqual({ ports: [] });
    adapter.close();
  });
});

describe("read-only Docker observation", () => {
  it("returns safe metadata without environment values", async () => {
    const url = await listen((server) => {
      server.get("/containers/json", async () => [{ Id: "abcdef1234567890", Names: ["/gluetun"], Image: "qmcgaw/gluetun:latest", State: "exited" }]);
      server.get("/containers/abcdef1234567890/json", async () => ({
        Id: "abcdef1234567890",
        Name: "/gluetun",
        Config: { Image: "qmcgaw/gluetun:latest", Env: ["VPN_SERVICE_PROVIDER=private internet access", "VPN_TYPE=openvpn", "SERVER_COUNTRIES=SE", "OPENVPN_PASSWORD=never-return"] },
        State: { Status: "exited", ExitCode: 1, StartedAt: "2026-08-31T00:00:00Z", FinishedAt: "2026-08-31T00:00:01Z", Error: "", OOMKilled: false },
        RestartCount: 3,
        NetworkSettings: {
          Ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "8000" }] },
          Networks: { tuniku: {} }
        }
      }));
      server.get("/containers/abcdef1234567890/logs", async (_request, reply) => reply.type("text/plain").send("OPENVPN_PASSWORD=never-return\ncountry specified is not valid: there is no possible value available\n"));
      server.get("/gluetun/traffic", async () => ({
        containerId: "abcdef1234567890",
        receivedBytes: 12_345,
        sentBytes: 6_789,
        observedAt: "2026-09-01T00:00:00.000Z"
      }));
    });
    const observer = new DockerObserver(url, true);
    const result = await observer.observeGluetun();
    expect(result.container).toMatchObject({ state: "exited", displayState: "Failed", exitCode: 1, restartCount: 3 });
    expect(result.ports[0]).toMatchObject({ hostPort: 8000, containerPort: 8000, protocol: "tcp" });
    expect(result.environment).toEqual([
      { name: "VPN_SERVICE_PROVIDER", sensitive: false },
      { name: "VPN_TYPE", sensitive: false },
      { name: "SERVER_COUNTRIES", sensitive: false },
      { name: "OPENVPN_PASSWORD", sensitive: true }
    ]);
    expect(result.issues).toContain("SERVER_COUNTRIES is not supported for Private Internet Access.");
    expect(result.issues).toContain("Gluetun rejected the selected server filter. Choose a current value from Tuniku's provider-specific server list.");
    expect(result.logs).toContain("OPENVPN_PASSWORD=[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("never-return");
    await expect(observer.observeTraffic()).resolves.toEqual({
      containerId: "abcdef1234567890",
      receivedBytes: 12_345,
      sentBytes: 6_789,
      observedAt: "2026-09-01T00:00:00.000Z"
    });
    observer.close();
  });
});
