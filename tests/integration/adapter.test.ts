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
  it("does not forward credentials to redirects and isolates optional endpoint failures", async () => {
    let redirected = 0;
    const target = await listen((server) => server.get("/*", async () => { redirected++; return { status: "running" }; }));
    const redirect = await listen((server) => server.get("/v1/vpn/status", async (_request, reply) => reply.redirect(`${target}/stolen`)));
    const adapter = new GluetunAdapter({ ...instance(redirect), authMode: "api_key" }, { apiKey: "synthetic-api-key" }, true);
    await expect(adapter.read("vpn")).rejects.toMatchObject({ code: "unreachable" });
    expect(redirected).toBe(0);
    adapter.close();
    let vpnReads = 0;
    const partial = await listen((server) => {
      server.get("/v1/vpn/status", async () => { vpnReads++; return { status: "running" }; });
      server.get("/v1/portforward", async () => ({ unexpected: true }));
    });
    const partialAdapter = new GluetunAdapter(instance(partial), null, true);
    const overview = await partialAdapter.overview();
    expect(vpnReads).toBe(1);
    expect(overview.vpn).toEqual({ status: "running" });
    expect(overview.capabilities.portForwarding.state).toBe("invalid_schema");
    expect(overview.connected).toBe(true);
    partialAdapter.close();
  });
  it("accepts current Gluetun public-IP location metadata and older IP-only responses", async () => {
    const currentUrl = await listen((server) => server.get("/v1/publicip/ip", async () => ({
      public_ip: "203.0.113.10",
      country: "Germany",
      region: "Berlin",
      city: "Berlin",
      organization: "not exposed by Tuniku"
    })));
    const current = new GluetunAdapter(instance(currentUrl), null, true);
    await expect(current.read("publicIp")).resolves.toEqual({
      publicIp: "203.0.113.10",
      country: "Germany",
      region: "Berlin",
      city: "Berlin"
    });
    current.close();

    const legacyUrl = await listen((server) => server.get("/v1/publicip/ip", async () => ({ public_ip: "203.0.113.11" })));
    const legacy = new GluetunAdapter(instance(legacyUrl), null, true);
    await expect(legacy.read("publicIp")).resolves.toEqual({
      publicIp: "203.0.113.11",
      country: null,
      region: null,
      city: null
    });
    legacy.close();
  });

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
  it("checks association before traffic and rejects a replacement during sampling", async () => {
    let statsReads = 0, logsReads = 0, changed = false;
    const id = "abcdef1234567890";
    const url = await listen((server) => {
      server.get("/containers/json", async () => [{ Id: id, Names: ["/gluetun"], Image: "qmcgaw/gluetun:latest", State: "running" }]);
      server.get(`/containers/${id}/json`, async () => ({ Id: id, Name: "/gluetun", ControlServer: { port: 8000 }, Config: { Env: [] }, State: { Status: "running" }, NetworkSettings: { Networks: { tuniku: { IPAddress: "127.0.0.1" } } } }));
      server.get(`/containers/${id}/logs`, async () => { logsReads++; return ""; });
      server.get("/gluetun/traffic", async () => { statsReads++; return { containerId: changed ? "1111111111111111" : id, observedAt: new Date().toISOString(), receivedBytes: 100, sentBytes: 50 }; });
    });
    const observer = new DockerObserver(url, true);
    try {
      await expect(observer.observeTraffic("http://127.0.0.2:8000")).rejects.toThrow("could not be associated");
      expect(statsReads).toBe(0); expect(logsReads).toBe(0);
      await expect(observer.observeTraffic("http://127.0.0.1:8000")).resolves.toMatchObject({ containerId: id });
      expect(logsReads).toBe(0);
      changed = true;
      await expect(observer.observeTraffic("http://127.0.0.1:8000")).rejects.toThrow("changed during traffic");
      expect((await observer.observeGluetun("http://127.0.0.2:8000")).association?.state).toBe("unverified");
    } finally { observer.close(); }
  });

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

  it("falls back to configured port bindings and explains unavailable live traffic", async () => {
    const url = await listen((server) => {
      server.get("/containers/json", async () => [{ Id: "abcdef1234567890", Names: ["/gluetun"], Image: "qmcgaw/gluetun:latest", State: "exited" }]);
      server.get("/containers/abcdef1234567890/json", async () => ({
        Id: "abcdef1234567890",
        Name: "/gluetun",
        Config: { Image: "qmcgaw/gluetun:latest", Env: [], ExposedPorts: { "8000/tcp": {} } },
        HostConfig: { PortBindings: { "5800/tcp": [{ HostIp: "0.0.0.0", HostPort: "5800" }] } },
        State: { Status: "exited", ExitCode: 0 },
        NetworkSettings: { Ports: {}, Networks: { tuniku: {} } }
      }));
      server.get("/containers/abcdef1234567890/logs", async (_request, reply) => reply.type("text/plain").send("stopped"));
      server.get("/gluetun/traffic", async (_request, reply) => reply.code(409).send({ error: "gluetun_not_running" }));
    });
    const observer = new DockerObserver(url, true);
    const result = await observer.observeGluetun();
    expect(result.ports).toEqual(expect.arrayContaining([
      { hostAddress: "0.0.0.0", hostPort: 5800, containerPort: 5800, protocol: "tcp" },
      { hostAddress: null, hostPort: null, containerPort: 8000, protocol: "tcp" }
    ]));
    await expect(observer.observeTraffic()).rejects.toThrow("Gluetun is not running");
    observer.close();
  });
});
