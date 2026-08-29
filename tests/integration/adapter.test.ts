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
});

describe("read-only Docker observation", () => {
  it("returns safe metadata without environment values", async () => {
    const url = await listen((server) => {
      server.get("/containers/json", async () => [{ Id: "abcdef1234567890", Names: ["/gluetun"], Image: "ghcr.io/qdm12/gluetun:v3.41.3", State: "running" }]);
      server.get("/containers/abcdef1234567890/json", async () => ({
        Id: "abcdef1234567890",
        Name: "/gluetun",
        Config: { Image: "ghcr.io/qdm12/gluetun:v3.41.3", Env: ["VPN_TYPE=wireguard", "WIREGUARD_PRIVATE_KEY=never-return"] },
        State: { Status: "running", Health: { Status: "healthy" } },
        NetworkSettings: {
          Ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "8000" }] },
          Networks: { default: {} }
        }
      }));
    });
    const observer = new DockerObserver(url, true);
    const result = await observer.observeGluetun();
    observer.close();
    expect(result.container?.health).toBe("healthy");
    expect(result.ports[0]).toMatchObject({ hostPort: 8000, containerPort: 8000, protocol: "tcp" });
    expect(result.environment).toEqual([
      { name: "VPN_TYPE", sensitive: false },
      { name: "WIREGUARD_PRIVATE_KEY", sensitive: true }
    ]);
    expect(JSON.stringify(result)).not.toContain("never-return");
  });
});
