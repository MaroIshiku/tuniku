import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedError, ManagedStackEngine, ManagedStore, type ManagedContainer, type ManagedDocker } from "../../src/server/management/engine.js";
import { ServerCatalog } from "../../src/server/compose/serverCatalog.js";
import type { HostBinding } from "../../src/server/compose/ports.js";

const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
const vpnId = "a".repeat(64);
const clientId = "b".repeat(64);
const imageId = `sha256:${"c".repeat(64)}`;
const input = { taskType: "configure_provider" as const, provider: "private internet access", vpnType: "openvpn" as const, openvpnUser: "synthetic-user", openvpnPassword: "synthetic-new-secret" };

class FakeDocker implements ManagedDocker {
  containers = new Map<string, ManagedContainer>([
    [vpnId, { Id: vpnId, Name: "/gluetun", Image: imageId, Config: { Image: "qmcgaw/gluetun:latest", Labels: { "com.docker.compose.project": "synthetic-vpn" }, Env: ["VPN_SERVICE_PROVIDER=private internet access", "VPN_TYPE=openvpn", "OPENVPN_USER=synthetic-user", "OPENVPN_PASSWORD=synthetic-old-secret", "HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE=synthetic-control-secret", "VPN_PORT_FORWARDING=off"] }, HostConfig: { NetworkMode: "synthetic-net", CapAdd: ["NET_ADMIN"], Binds: ["synthetic-volume:/gluetun"] }, State: { Running: true, Health: { Status: "healthy" } } }],
    [clientId, { Id: clientId, Name: "/downloader", Image: `sha256:${"d".repeat(64)}`, Config: { Image: "example/downloader:version", Labels: { "com.docker.compose.project": "synthetic-vpn" }, Env: [] }, HostConfig: { NetworkMode: `container:${vpnId}`, Binds: ["/DATA/Downloads:/downloads"] }, State: { Running: true } }]
  ]);
  calls: string[] = [];
  failNewHealth = false;
  failRollbackHealth = false;
  failClientHealth: string | null = null;
  nextId = 1;
  occupied: HostBinding[] = [];
  async hostBindings(): Promise<HostBinding[]> { return this.occupied; }
  async dependents(vpn: ManagedContainer): Promise<string[]> { return [...this.containers.values()].filter((container) => container.HostConfig.NetworkMode === `container:${vpn.Id}`).map((container) => container.Id); }
  async inspect(id: string): Promise<ManagedContainer> { const value = this.containers.get(id); if (!value) throw new ManagedError("Synthetic missing container", "not_found"); return structuredClone(value); }
  async create(name: string, configuration: Record<string, any>): Promise<string> {
    const id = (this.nextId++).toString(16).padStart(64, "0");
    if ([...this.containers.values()].some((container) => container.Name === `/${name}`)) throw new Error("Synthetic name conflict");
    this.calls.push(`create:${name}`);
    const { HostConfig, NetworkingConfig: _networks, ...Config } = structuredClone(configuration);
    this.containers.set(id, { Id: id, Name: `/${name}`, Image: configuration.Image, Config, HostConfig, State: { Running: false } });
    return id;
  }
  async rename(id: string, name: string): Promise<void> { this.calls.push(`rename:${id}:${name}`); this.containers.get(id)!.Name = `/${name}`; }
  async start(id: string): Promise<void> { this.calls.push(`start:${id}`); this.containers.get(id)!.State.Running = true; }
  async stop(id: string): Promise<void> { this.calls.push(`stop:${id}`); this.containers.get(id)!.State.Running = false; }
  async remove(id: string): Promise<void> { this.calls.push(`remove:${id}`); this.containers.delete(id); }
  async waitHealthy(id: string): Promise<void> { this.calls.push(`healthy:${id}`); if (id === this.failClientHealth || (this.failNewHealth && id !== vpnId && id !== clientId) || (this.failRollbackHealth && id === vpnId)) throw new Error("Synthetic secret-bearing health error"); }
}
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-managed-test-")); directories.push(directory);
  const docker = new FakeDocker();
  const store = new ManagedStore(path.join(directory, "managed"), "synthetic-manager-key-at-least-32-characters");
  const catalog = new ServerCatalog(directory);
  const engine = new ManagedStackEngine(docker, store, ["synthetic-vpn"], ["/DATA/Downloads"], catalog);
  return { directory, docker, store, catalog, engine };
}

describe("bounded managed stack transactions", () => {
  it("binds server selection to the current provider and validates complete credentials before writes", async () => {
    const { engine, docker } = setup(); const project = await engine.adopt(vpnId, [clientId], true);
    await expect(engine.plan(project.id, { taskType: "set_server_selection", provider: "mullvad", vpnType: "wireguard", countries: "Sweden" })).rejects.toThrow(/retain the observed provider/);
    expect((await engine.plan(project.id, { taskType: "set_server_selection", regions: "Albania" })).environmentKeys).toContain("SERVER_REGIONS");
    docker.containers.get(vpnId)!.Config.Env = ["VPN_SERVICE_PROVIDER=private internet access", "VPN_TYPE=openvpn"];
    await expect(engine.plan(project.id, { taskType: "set_server_selection", regions: "Albania" })).rejects.toThrow();
    expect(docker.calls).toEqual([]);
  });
  it("preserves omitted provider settings on rotation and explicitly previews removals", async () => {
    const { engine, docker, store } = setup(); docker.containers.get(vpnId)!.Config.Env.push("SERVER_REGIONS=Albania", "PRIVATE_INTERNET_ACCESS_OPENVPN_ENCRYPTION_PRESET=strong");
    const project = await engine.adopt(vpnId, [clientId], true);
    const patch = await engine.plan(project.id, { ...input, regions: "", providerOptions: {} });
    const desired = store.load<any>("plan", patch.id).desired;
    expect(desired.Env).toContain("SERVER_REGIONS=Albania"); expect(desired.Env).toContain("PRIVATE_INTERNET_ACCESS_OPENVPN_ENCRYPTION_PRESET=strong");
    expect(patch.environmentKeys).toEqual(["OPENVPN_PASSWORD"]);
    const removal = await engine.plan(project.id, { ...input, managedClearEnvironmentKeys: ["SERVER_REGIONS"] });
    expect(removal.removedEnvironmentKeys).toEqual(["SERVER_REGIONS"]);
    expect(store.load<any>("plan", removal.id).desired.Env).not.toContain("SERVER_REGIONS=Albania");
    const publicSettings = await engine.settings(project.id); expect(publicSettings.input.regions).toBe("Albania"); expect(JSON.stringify(publicSettings)).not.toContain("synthetic-old-secret");
  });
  it("adds, replaces and removes only selected address/protocol bindings and preserves no-ops", async () => {
    const { engine, docker, store } = setup(); const first = { HostIp: "127.0.0.1", HostPort: "5800" }, second = { HostIp: "192.0.2.1", HostPort: "5801" };
    docker.containers.get(vpnId)!.HostConfig.PortBindings = { "5800/tcp": [first, second], "5800/udp": [{ HostIp: "", HostPort: "5800" }] };
    const project = await engine.adopt(vpnId, [clientId], true); const port = { taskType: "publish_app_port" as const, containerPort: 5800, hostPort: 5802, hostAddress: "192.0.2.2", protocol: "tcp" as const };
    const add = await engine.plan(project.id, port); expect(store.load<any>("plan", add.id).desired.HostConfig.PortBindings["5800/tcp"]).toEqual([first, second, { HostIp: "192.0.2.2", HostPort: "5802" }]);
    const noop = await engine.plan(project.id, { ...port, hostAddress: first.HostIp, hostPort: 5800 }); expect(noop.interruptionRequired).toBe(false);
    const remove = await engine.plan(project.id, { ...port, managedPortAction: "remove", managedOriginalBinding: { address: first.HostIp, port: first.HostPort } });
    expect(store.load<any>("plan", remove.id).desired.HostConfig.PortBindings).toEqual({ "5800/tcp": [second], "5800/udp": [{ HostIp: "", HostPort: "5800" }] });
    const replace = await engine.plan(project.id, { ...port, managedPortAction: "replace", managedOriginalBinding: { address: first.HostIp, port: first.HostPort } }); expect(store.load<any>("plan", replace.id).desired.HostConfig.PortBindings["5800/tcp"]).toHaveLength(2);
    expect(docker.calls).toEqual([]);
  });
  it("blocks always-restart originals and conflicting or unknown mounted WireGuard sources", async () => {
    const { engine, docker } = setup(); docker.containers.get(clientId)!.HostConfig.RestartPolicy = { Name: "always" };
    await expect(engine.adopt(vpnId, [clientId], true)).rejects.toThrow(/Restart policy always/);
    docker.containers.get(clientId)!.HostConfig.RestartPolicy = { Name: "unless-stopped" };
    const project = await engine.adopt(vpnId, [clientId], true);
    await expect(engine.plan(project.id, { taskType: "configure_provider", provider: "mullvad", vpnType: "wireguard", wireguardPrivateKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=", wireguardAddresses: "10.0.0.2/32" })).rejects.toThrow(/configuration file may override/);
    expect(docker.calls).toEqual([]);
  });
  it("preserves explicit hostname/domain and stable VPN role after pinned-image recreation", async () => {
    const { engine, docker } = setup(); docker.containers.get(vpnId)!.Name = "/my-private-vpn"; docker.containers.get(vpnId)!.Config.Labels["com.docker.compose.service"] = "vpn";
    Object.assign(docker.containers.get(clientId)!.Config, { Hostname: "custom-host", Domainname: "custom-domain" });
    const project = await engine.adopt(vpnId, [clientId], true); await engine.apply((await engine.plan(project.id, input)).id, true);
    const current = engine.projects()[0]!; expect(docker.containers.get(current.vpnId)!.Config.Labels["com.ishiku.tuniku.role"]).toBe("gluetun"); expect(docker.containers.get(current.clientIds[0]!)!.Config).toMatchObject({ Hostname: "custom-host", Domainname: "custom-domain" });
  });
  it("prunes only expired unreferenced plans and keeps operation/recovery records", async () => {
    const { engine, store } = setup(); const project = await engine.adopt(vpnId, [clientId], true); const unused = await engine.plan(project.id, input); const applied = await engine.plan(project.id, input); await engine.apply(applied.id, true);
    vi.useFakeTimers(); vi.advanceTimersByTime(6 * 60000); expect(engine.storageStatus().expiredUnreferenced).toBe(1); expect(engine.pruneExpiredPlans()).toBe(1); expect(store.ids("plan")).not.toContain(unused.id); expect(store.ids("plan")).toContain(applied.id); expect(engine.operations()).toHaveLength(1);
  });
  it("completes only explicitly reviewed manual original recovery without Docker writes or replay", async () => {
    const { engine, docker, store } = setup(); const project = await engine.adopt(vpnId, [clientId], true); const plan = await engine.plan(project.id, input); const operationId = crypto.randomUUID();
    store.save("operation", operationId, { id: operationId, projectId: project.id, planId: plan.id, status: "interrupted", snapshots: [await docker.inspect(vpnId), await docker.inspect(clientId)], createdIds: [], renamedIds: [], error: null });
    await expect(engine.plan(project.id, input)).rejects.toThrow(/locks/);
    const review = await engine.reviewRecovery(operationId); expect(review.fingerprint).toMatch(/^[0-9a-f-]{36}$/); await expect(engine.completeRecovery(operationId, review.fingerprint, false)).rejects.toThrow(/Confirm/);
    docker.containers.get(clientId)!.Config.Hostname = "drift"; await expect(engine.completeRecovery(operationId, review.fingerprint, true)).rejects.toThrow(/Restore/); delete docker.containers.get(clientId)!.Config.Hostname;
    expect((await engine.completeRecovery(operationId, review.fingerprint, true)).status).toBe("rolled_back"); expect(docker.calls.filter(call => !call.startsWith("healthy:"))).toEqual([]); expect((await engine.plan(project.id, input)).id).toBeTruthy(); await expect(engine.completeRecovery(operationId, review.fingerprint, true)).rejects.toThrow();
  });
  it("reviews and confirms stopped-original cleanup while protecting volumes, active containers and drift", async () => {
    const { engine, docker, store } = setup(); const project = await engine.adopt(vpnId, [clientId], true); const operation = await engine.apply((await engine.plan(project.id, input)).id, true); const review = await engine.reviewCleanup(operation.id);
    expect(review.containers.map(container => container.id)).toEqual([clientId, vpnId]); await expect(engine.cleanup(operation.id, review.fingerprint, false)).rejects.toThrow(/Confirm/);
    docker.containers.get(clientId)!.State.Running = true; await expect(engine.cleanup(operation.id, review.fingerprint, true)).rejects.toThrow(/active/); docker.containers.get(clientId)!.State.Running = false;
    await engine.cleanup(operation.id, review.fingerprint, true); expect(docker.calls.filter(call => call.startsWith("remove:"))).toEqual([`remove:${clientId}`, `remove:${vpnId}`]); expect(store.ids("plan")).toHaveLength(1); expect(engine.storageStatus().retainedContainers).toBe(0); expect(engine.projects()[0]!.vpnId).not.toBe(vpnId);
  });

  it("keeps interrupted cleanup locked and requires fresh reviewed continuation", async () => {
    const { engine, docker } = setup(); const project = await engine.adopt(vpnId, [clientId], true); const operation = await engine.apply((await engine.plan(project.id, input)).id, true); const review = await engine.reviewCleanup(operation.id);
    const remove = docker.remove.bind(docker); let fail = true; vi.spyOn(docker, "remove").mockImplementation(async id => { if (id === vpnId && fail) { fail = false; throw new Error("Synthetic interrupted cleanup"); } await remove(id); });
    await expect(engine.cleanup(operation.id, review.fingerprint, true)).rejects.toThrow(/interrupted/);
    expect(engine.operations()[0]?.cleanupStatus).toBe("interrupted"); expect(docker.containers.has(clientId)).toBe(false); expect(docker.containers.has(vpnId)).toBe(true);
    await expect(engine.plan(project.id, input)).rejects.toThrow(/locks/); await expect(engine.cleanup(operation.id, review.fingerprint, true)).rejects.toThrow(/changed/);
    const remaining = await engine.reviewCleanup(operation.id); expect(remaining.containers.map(container => container.id)).toEqual([vpnId]); await engine.cleanup(operation.id, remaining.fingerprint, true); expect(engine.operations()[0]?.cleanupStatus).toBe("completed"); expect((await engine.plan(project.id, input)).id).toBeTruthy();
  });
  it("refuses expired review tokens and unverified current stacks before recovery-container removal", async () => {
    const { engine, docker } = setup(); const project = await engine.adopt(vpnId, [clientId], true); const operation = await engine.apply((await engine.plan(project.id, input)).id, true); const review = await engine.reviewCleanup(operation.id);
    vi.useFakeTimers(); vi.advanceTimersByTime(6 * 60000); const before = docker.calls.filter(call => !call.startsWith("healthy:")); await expect(engine.cleanup(operation.id, review.fingerprint, true)).rejects.toThrow(/expired/); expect(docker.calls.filter(call => !call.startsWith("healthy:"))).toEqual(before); vi.useRealTimers();
    docker.containers.get(engine.projects()[0]!.vpnId)!.State.Running = false; await expect(engine.reviewCleanup(operation.id)).rejects.toThrow(/Start and verify/);
  });
  it("compares encrypted adopted and successfully applied configuration without exposing snapshots or confusing health with drift", async () => {
    const { engine, docker, store } = setup();
    docker.containers.get(vpnId)!.NetworkSettings = { Networks: { net: { Aliases: ["gluetun"], IPAddress: "192.0.2.1" } } };
    const project = await engine.adopt(vpnId, [clientId], true);
    docker.containers.get(vpnId)!.NetworkSettings!.Networks!.net.IPAddress = "192.0.2.2";
    expect((await engine.diagnostics(project.id)).configuration).toMatchObject({ state: "matched", baselineSource: "adoption" });
    expect(JSON.stringify(engine.projects())).not.toMatch(/baseline|synthetic-old-secret|HTTP_CONTROL_SERVER_AUTH/);
    docker.containers.get(vpnId)!.State.Health = { Status: "unhealthy" };
    docker.containers.get(vpnId)!.State.Running = false;
    expect((await engine.diagnostics(project.id)).configuration.state).toBe("matched");
    docker.containers.get(vpnId)!.State.Running = true;
    docker.containers.get(vpnId)!.Config.Env.push("SERVER_REGIONS=Albania");
    expect((await engine.diagnostics(project.id)).configuration).toMatchObject({ state: "drifted", changedServiceIds: [vpnId] });
    const response = await engine.apply((await engine.plan(project.id, input)).id, true);
    expect(response.status).toBe("succeeded");
    const observed = await engine.diagnostics(project.id);
    expect(observed.configuration).toMatchObject({ state: "matched", baselineSource: "successful_apply" });
    expect(JSON.stringify(observed)).not.toMatch(/synthetic-new-secret|Env|Binds/);
    expect(JSON.stringify(store.load("project", project.id))).not.toMatch(/baseline|synthetic-new-secret|containers/);
    expect(store.ids("baseline")).toEqual([project.id]);
    store.save("baseline", project.id, null);
    expect((await engine.diagnostics(project.id)).configuration.state).toBe("unavailable");
    expect((await engine.apply((await engine.plan(project.id, input)).id, true)).status).toBe("succeeded");
    expect((await engine.diagnostics(project.id)).configuration.state).toBe("matched");
    docker.containers.delete(engine.projects()[0]!.clientIds[0]!);
    expect((await engine.diagnostics(project.id)).configuration.state).toBe("unavailable");
  });
  it("retains the previous comparison reference when apply completion fails and rolls back", async () => {
    const { engine, store } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const before = (await engine.diagnostics(project.id)).configuration;
    const save = store.save.bind(store); let once = true;
    vi.spyOn(store, "save").mockImplementation((kind, id, value) => {
      if (once && kind === "operation" && (value as any).status === "succeeded") { once = false; throw new Error("Synthetic storage failure"); }
      save(kind, id, value);
    });
    expect((await engine.apply((await engine.plan(project.id, input)).id, true)).status).toBe("rolled_back");
    expect((await engine.diagnostics(project.id)).configuration).toEqual(before);
  });
  it("does not allow retained originals from a successful operation to be adopted again", async () => {
    const { engine, docker } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    expect((await engine.apply((await engine.plan(project.id, input)).id, true)).status).toBe("succeeded");
    const before = docker.calls.slice();
    await expect(engine.adopt(vpnId, [clientId], true)).rejects.toThrow(/Retained recovery/);
    expect(docker.calls).toEqual(before);
  });
  it("keeps management bound to the adopted project when manual Compose names and pasted context differ", async () => {
    const { engine, docker } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const plan = await engine.plan(project.id, { ...input, gluetunServiceName: "unrelated-vpn", pastedCompose: "services:\n  unrelated-vpn:\n    image: qmcgaw/gluetun:latest\n" });
    expect(docker.calls).toEqual([]);
    expect((await engine.apply(plan.id, true)).status).toBe("succeeded");
    const updated = docker.containers.get(engine.projects()[0]!.vpnId)!;
    expect(updated.Name).toBe("/gluetun");
    expect(updated.Config.Env).toContain("OPENVPN_PASSWORD=synthetic-new-secret");
    expect([...docker.containers.values()].some(container => container.Name === "/unrelated-vpn")).toBe(false);
  });
  it("diagnoses only adopted applications and detects an outdated namespace after VPN replacement", async () => {
    const { engine, docker } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const healthy = await engine.diagnostics(project.id);
    expect(healthy.vpn.health).toBe("healthy"); expect(healthy.applications[0]?.namespace).toBe("attached");
    expect(JSON.stringify(healthy)).not.toContain("synthetic-old-secret"); expect(docker.calls).toEqual([]);
    const plan = await engine.plan(project.id, input);
    expect((await engine.apply(plan.id, true)).status).toBe("succeeded");
    const current = engine.projects()[0]!;
    docker.containers.get(current.clientIds[0]!)!.Name = "/jdownloader";
    docker.containers.get(current.clientIds[0]!)!.HostConfig.NetworkMode = `container:${vpnId}`;
    const before = docker.calls.slice();
    const diagnosis = await engine.diagnostics(project.id);
    expect(diagnosis.applications[0]).toMatchObject({ name: "jdownloader", namespace: "different", issue: expect.stringContaining("outdated") });
    expect(docker.calls).toEqual(before);
    await expect(engine.plan(project.id, input)).rejects.toThrow("no longer shares");
  });
  it("isolates missing and changed-project services without exposing unrelated container metadata", async () => {
    const { engine, docker } = setup(); const project = await engine.adopt(vpnId, [clientId], true);
    docker.containers.get(clientId)!.Config.Labels["com.docker.compose.project"] = "unapproved";
    expect((await engine.diagnostics(project.id)).applications[0]).toMatchObject({ availability: "out_of_scope", name: null });
    docker.containers.delete(vpnId);
    expect((await engine.diagnostics(project.id)).vpn.availability).toBe("missing");
    expect(docker.calls).toEqual([]);
    await expect(engine.diagnostics(crypto.randomUUID())).rejects.toThrow("state is missing");
  });

  it("checks address/protocol conflicts while planning and rechecks host occupancy before writes", async () => {
    const { engine, docker } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const input = { taskType: "publish_app_port" as const, hostAddress: "127.0.0.1", hostPort: 8080, containerPort: 80, protocol: "tcp" as const };
    docker.occupied = [{ address: "127.0.0.1", first: 8080, last: 8080, protocol: "udp" }];
    const plan = await engine.plan(project.id, input);
    docker.occupied = [{ address: "0.0.0.0", first: 8080, last: 8080, protocol: "tcp" }];
    expect((await engine.apply(plan.id, true)).status).toBe("rolled_back");
    expect(docker.calls).toEqual([]);
    await expect(engine.plan(project.id, input)).rejects.toThrow(/host port conflicts/);
    docker.occupied = [{ address: "127.0.0.2", first: 8080, last: 8080, protocol: "tcp" }];
    expect((await engine.plan(project.id, input)).portsChanged).toBe(true);
  });
  it("stops earlier restored clients when a later rollback health check fails", async () => {
    const { engine, docker } = setup();
    const secondId = "e".repeat(64);
    docker.containers.set(secondId, { ...structuredClone(docker.containers.get(clientId)!), Id: secondId, Name: "/second-client" });
    const project = await engine.adopt(vpnId, [clientId, secondId], true);
    docker.failNewHealth = true; docker.failClientHealth = secondId;
    const operation = await engine.apply((await engine.plan(project.id, input)).id, true);
    expect(operation.status).toBe("rollback_failed");
    expect(docker.calls).toContain(`start:${clientId}`);
    expect((await docker.inspect(clientId)).State.Running).toBe(false);
    expect((await docker.inspect(secondId)).State.Running).toBe(false);
  });
  it("restores ownership if saving the completion journal fails after recreation", async () => {
    const { engine, docker, store } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const plan = await engine.plan(project.id, input);
    const save = store.save.bind(store);
    let failOnce = true;
    vi.spyOn(store, "save").mockImplementation((kind, id, value) => {
      if (failOnce && kind === "operation" && (value as any).status === "succeeded") { failOnce = false; throw new Error("Synthetic journal write failure"); }
      save(kind, id, value);
    });
    expect((await engine.apply(plan.id, true)).status).toBe("rolled_back");
    expect(engine.projects()[0]?.vpnId).toBe(vpnId);
    expect(engine.projects()[0]?.clientIds).toEqual([clientId]);
    expect((await docker.inspect(clientId)).State.Running).toBe(true);
  });
  it("requires all routed applications and rejects static address migration", async () => {
    const { engine, docker } = setup();
    await expect(engine.adopt(vpnId, [], true)).rejects.toThrow(/every application/);
    docker.containers.get(vpnId)!.NetworkSettings = { Networks: { net: { IPAMConfig: { IPv4Address: "10.10.0.2" } } } };
    await expect(engine.adopt(vpnId, [clientId], true)).rejects.toThrow(/Static network/);
    expect(docker.calls).toEqual([]);
  });
  it("preserves anonymous volumes and rejects running-state changes after planning", async () => {
    const { engine, docker } = setup();
    docker.containers.get(clientId)!.Mounts = [{ Type: "volume", Name: "synthetic-anonymous-volume", Destination: "/config", RW: true }];
    const project = await engine.adopt(vpnId, [clientId], true);
    const stale = await engine.plan(project.id, input);
    docker.containers.get(clientId)!.State.Running = false;
    expect((await engine.apply(stale.id, true)).status).toBe("rolled_back");
    expect(docker.calls).toEqual([]);
    docker.containers.get(clientId)!.State.Running = true;
    expect((await engine.apply((await engine.plan(project.id, input)).id, true)).status).toBe("succeeded");
    const recreated = [...docker.containers.values()].find((container) => container.Name === "/downloader")!;
    expect(recreated.HostConfig.Mounts).toContainEqual({ Type: "volume", Source: "synthetic-anonymous-volume", Target: "/config", ReadOnly: false });
  });
  it("requires explicit adoption and rejects foreign projects, host mounts and incorrect namespace associations", async () => {
    const { engine, docker } = setup();
    await expect(engine.adopt(vpnId, [clientId], false)).rejects.toThrow(/Confirm/);
    docker.containers.get(clientId)!.HostConfig.Binds = ["/var/run/docker.sock:/socket"];
    await expect(engine.adopt(vpnId, [clientId], true)).rejects.toThrow(/bind mount/);
    docker.containers.get(clientId)!.HostConfig.Binds = [];
    docker.containers.get(clientId)!.Config.Labels["com.docker.compose.project"] = "foreign";
    await expect(engine.adopt(vpnId, [clientId], true)).rejects.toThrow(/allowlist/);
    docker.containers.get(clientId)!.Config.Labels["com.docker.compose.project"] = "synthetic-vpn";
    docker.containers.get(clientId)!.HostConfig.NetworkMode = `container:${"e".repeat(64)}`;
    await expect(engine.adopt(vpnId, [clientId], true)).rejects.toThrow(/different or replaced/);
  });
  it("coordinates recreation, preserves data and pins the current image, and supports the next change", async () => {
    const { engine, docker, store, directory } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const plan = await engine.plan(project.id, input);
    expect(plan.environmentKeys).toEqual(["OPENVPN_PASSWORD"]);
    expect(JSON.stringify(plan)).not.toContain("synthetic-old-secret");
    expect(JSON.stringify(plan)).not.toContain("synthetic-new-secret");
    await expect(engine.apply(plan.id, false)).rejects.toThrow(/Confirm/);
    const result = await engine.apply(plan.id, true);
    expect(result.status).toBe("succeeded");
    expect(docker.calls.indexOf(`stop:${clientId}`)).toBeLessThan(docker.calls.indexOf(`stop:${vpnId}`));
    const vpn = [...docker.containers.values()].find((container) => container.Name === "/gluetun")!;
    const client = [...docker.containers.values()].find((container) => container.Name === "/downloader")!;
    expect(vpn.Config.Image).toBe(imageId);
    expect(vpn.Config.Env).toContain("OPENVPN_PASSWORD=synthetic-new-secret");
    expect(vpn.Config.Env).toContain("HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE=synthetic-control-secret");
    expect(client.HostConfig.NetworkMode).toBe(`container:${vpn.Id}`);
    expect(client.HostConfig.Binds).toEqual(["/DATA/Downloads:/downloads"]);
    expect(docker.calls.indexOf(`healthy:${vpn.Id}`)).toBeLessThan(docker.calls.indexOf(`start:${client.Id}`));
    expect((await docker.inspect(vpnId)).State.Running).toBe(false);
    expect((await engine.plan(project.id, input)).interruptionRequired).toBe(false);
    await expect(engine.apply(plan.id, true)).rejects.toThrow(/already has an operation/);
    for (const name of fs.readdirSync(path.join(directory, "managed"))) expect(fs.readFileSync(path.join(directory, "managed", name), "utf8")).not.toContain("synthetic-");
    expect(store.ids("operation")).toHaveLength(1);
  });
  it("rolls back after unhealthy replacement and keeps clients stopped if rollback fails", async () => {
    const { engine, docker } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const plan = await engine.plan(project.id, input);
    docker.failNewHealth = true;
    const rolledBack = await engine.apply(plan.id, true);
    expect(rolledBack.status).toBe("rolled_back");
    expect((await docker.inspect(vpnId)).Name).toBe("/gluetun");
    expect((await docker.inspect(clientId)).State.Running).toBe(true);
    const secondPlan = await engine.plan(project.id, input);
    docker.failRollbackHealth = true;
    const failed = await engine.apply(secondPlan.id, true);
    expect(failed.status).toBe("rollback_failed");
    expect((await docker.inspect(clientId)).State.Running).toBe(false);
    expect(JSON.stringify(failed)).not.toContain("Synthetic secret-bearing health error");
    const before = docker.calls.slice();
    await expect(engine.plan(project.id, input)).rejects.toThrow(/locks this project/);
    expect(docker.calls).toEqual(before);
  });
  it("rejects drift and expired plans before touching containers", async () => {
    const { engine, docker } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const plan = await engine.plan(project.id, input);
    docker.containers.get(vpnId)!.Config.Env.push("SYNTHETIC_DRIFT=yes");
    expect((await engine.apply(plan.id, true)).status).toBe("rolled_back");
    expect(docker.calls).toEqual([]);
    const expired = await engine.plan(project.id, input);
    vi.useFakeTimers(); vi.advanceTimersByTime(6 * 60_000);
    await expect(engine.apply(expired.id, true)).rejects.toThrow(/expired/);
    expect(docker.calls).toEqual([]);
  });
  it("does not restart a stopped VPN or its clients without a separate start action", async () => {
    const { engine, docker } = setup();
    docker.containers.get(vpnId)!.State.Running = false;
    const project = await engine.adopt(vpnId, [clientId], true);
    expect((await engine.apply((await engine.plan(project.id, input)).id, true)).status).toBe("succeeded");
    expect(docker.calls.some((call) => call.startsWith("start:"))).toBe(false);
  });
  it("marks interrupted operations for manual recovery and authenticates encrypted record identities", async () => {
    const { engine, store, docker, catalog, directory } = setup();
    const project = await engine.adopt(vpnId, [clientId], true);
    const plan = await engine.plan(project.id, input);
    const id = crypto.randomUUID();
    store.save("operation", id, { id, projectId: project.id, planId: plan.id, status: "applying", snapshots: [], createdIds: [], renamedIds: [], error: null });
    const restarted = new ManagedStackEngine(docker, store, ["synthetic-vpn"], ["/DATA/Downloads"], catalog);
    expect(restarted.operations()[0]?.status).toBe("interrupted");
    await expect(restarted.apply(plan.id, true)).rejects.toThrow(/already has an operation/);
    expect(docker.calls).toEqual([]);
    const copyId = crypto.randomUUID();
    fs.copyFileSync(path.join(directory, "managed", `project-${project.id}.json`), path.join(directory, "managed", `project-${copyId}.json`));
    expect(() => store.load("project", copyId)).toThrow(/unreadable/);
    expect(() => store.load("project", "../../escape")).toThrow(/unreadable/);
  });
});
