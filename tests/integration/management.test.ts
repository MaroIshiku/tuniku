import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildManager } from "../../src/server/management/server.js";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";
import { SocketManagedDocker } from "../../src/server/management/docker.js";

it("authenticates the helper, rejects arbitrary Docker operations and applies only confirmed adopted plans", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-manager-api-"));
  const key = "synthetic-manager-key-with-at-least-32-characters";
  const keyFile = path.join(directory, "manager-key"); fs.writeFileSync(keyFile, key, { mode: 0o600 });
  const socketPath = path.join(directory, "docker.sock");
  const vpnId = "a".repeat(64), replacementId = "b".repeat(64), image = `sha256:${"c".repeat(64)}`;
  const containers: Record<string, any> = { [vpnId]: { Id: vpnId, Name: "/synthetic-gluetun", Image: image, Config: { Image: "qmcgaw/gluetun:latest", Env: ["VPN_SERVICE_PROVIDER=private internet access", "VPN_TYPE=openvpn", "OPENVPN_USER=synthetic-user", "OPENVPN_PASSWORD=synthetic-old-value"], Labels: { "com.docker.compose.project": "synthetic-vpn" } }, HostConfig: { NetworkMode: "synthetic-network", Binds: ["synthetic-volume:/gluetun"], CapAdd: ["NET_ADMIN"] }, State: { Running: true, Health: { Status: "healthy" } } } };
  const mutations: string[] = [];
  const socket = http.createServer(async (request, response) => {
    const url = new URL(request.url!, "http://docker.local");
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const payload = Buffer.concat(chunks).toString();
    const send = (code: number, value?: unknown) => { response.writeHead(code, { "content-type": "application/json" }); response.end(value === undefined ? undefined : JSON.stringify(value)); };
    if (request.method === "GET" && url.pathname === "/containers/json") return send(200, Object.values(containers).map((container) => ({ Id: container.Id, Names: [container.Name], Image: container.Config.Image, State: "running", HostConfig: container.HostConfig, Labels: container.Config.Labels })));
    const match = url.pathname.match(/^\/containers\/([a-f0-9]{64})\/(json|stop|start|rename)$/);
    if (match && containers[match[1]!]) {
      const container = containers[match[1]!]!;
      if (request.method === "GET" && match[2] === "json") return send(200, container);
      if (request.method === "POST") {
        mutations.push(`${match[2]}:${match[1]}`);
        if (match[2] === "rename") container.Name = `/${url.searchParams.get("name")}`;
        if (match[2] === "start") container.State.Running = true;
        if (match[2] === "stop") container.State.Running = false;
        return send(204);
      }
    }
    if (request.method === "POST" && url.pathname === "/containers/create") {
      const configuration = JSON.parse(payload);
      const { HostConfig, ...Config } = configuration;
      containers[replacementId] = { Id: replacementId, Name: `/${url.searchParams.get("name")}`, Image: image, Config, HostConfig, State: { Running: false, Health: { Status: "healthy" } } };
      mutations.push("create"); return send(201, { Id: replacementId });
    }
    return send(403, { error: "Synthetic disallowed Docker operation." });
  });
  await new Promise<void>((resolve) => socket.listen(socketPath, resolve));
  const app = await buildManager({ dataPath: path.join(directory, "managed"), keyFile, socketPath, projects: ["synthetic-vpn"], bindRoots: [] });
  try {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/status" })).statusCode).toBe(401);
    for (const action of ["settings", "export", "prune", "recovery-review", "recovery-complete", "cleanup-review", "cleanup"]) expect((await app.inject({ method: "POST", url: `/${action}`, payload: {} })).statusCode).toBe(401);
    const headers = { authorization: `Bearer ${key}` };
    const initial = await app.inject({ method: "GET", url: "/status", headers });
    expect(initial.statusCode).toBe(200); expect(initial.json().candidates[0]).toMatchObject({ id: vpnId, network: { kind: "vpn", vpnId }, recovery: false });
    expect(initial.body).not.toContain("synthetic-old-value"); expect(mutations).toEqual([]);
    for (const url of ["/containers/create", "/exec", "/images/create", "/archive"]) expect((await app.inject({ method: "POST", url, headers, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/adopt", headers, payload: { vpnId, clientIds: [], confirmed: false } })).statusCode).toBe(400);
    const adopted = await app.inject({ method: "POST", url: "/adopt", headers, payload: { vpnId, clientIds: [], confirmed: true } });
    expect(adopted.statusCode).toBe(200);
    const diagnosed = await app.inject({ method: "POST", url: "/diagnostics", headers, payload: { projectId: adopted.json().project.id } });
    expect(diagnosed.statusCode).toBe(200); expect(diagnosed.json().diagnostics.vpn.availability).toBe("available");
    expect(diagnosed.body).not.toContain("synthetic-old-value"); expect(mutations).toEqual([]);
    expect((await app.inject({ method: "POST", url: "/diagnostics", payload: { projectId: adopted.json().project.id } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/diagnostics", headers, payload: { projectId: "invalid" } })).statusCode).toBe(400);
    const planned = await app.inject({ method: "POST", url: "/plan", headers, payload: { projectId: adopted.json().project.id, input: { taskType: "configure_provider", provider: "private internet access", vpnType: "openvpn", openvpnPassword: "synthetic-new-value" } } });
    expect(planned.statusCode).toBe(200);
    expect(planned.body).not.toContain("synthetic-new-value");
    expect(planned.body).not.toContain("synthetic-old-value");
    expect(mutations).toEqual([]);
    const planId = planned.json().plan.id;
    expect((await app.inject({ method: "POST", url: "/apply", headers, payload: { planId, confirmed: false } })).statusCode).toBe(400);
    expect(mutations).toEqual([]);
    const applied = await app.inject({ method: "POST", url: "/apply", headers, payload: { planId, confirmed: true } });
    expect(applied.statusCode).toBe(202);
    await app.close();
    expect(mutations).toEqual([`stop:${vpnId}`, `rename:${vpnId}`, "create", `start:${replacementId}`]);
    expect(containers[replacementId].Config.Env).toContain("OPENVPN_PASSWORD=synthetic-new-value");
    expect(containers[replacementId].Config.Env).toContain("OPENVPN_USER=synthetic-user");
    expect(containers[replacementId].HostConfig.Binds).toEqual(["synthetic-volume:/gluetun"]);
  } finally { await app.close(); await new Promise<void>((resolve) => socket.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); }
});

it("protects management gateway requests with session and CSRF while keeping optional management disabled", async () => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-manager-gateway-"));
  const app = await buildApp({ ...config, dataPath, databasePath: path.join(dataPath, "test.db"), logLevel: "silent", registrationSecret: "synthetic-setup-secret", sessionSecret: "synthetic-session-key-with-at-least-32-characters", encryptionKey: "3".repeat(64), managerUrl: null });
  try {
    expect((await app.inject({ method: "GET", url: "/api/v1/management" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/management/apply", payload: { confirmed: true } })).statusCode).toBe(401);
    const registration = await app.inject({ method: "POST", url: "/api/v1/auth/register-first-admin", payload: { setupSecret: "synthetic-setup-secret", displayName: "Synthetic Admin", username: "manager-test", password: "synthetic-admin-password", passwordConfirm: "synthetic-admin-password" } });
    const cookie = registration.headers["set-cookie"] as string;
    const headers = { cookie, "x-csrf-token": registration.json().csrfToken };
    expect((await app.inject({ method: "GET", url: "/api/v1/management", headers })).json().enabled).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/v1/management/diagnostics", headers: { cookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/management/apply", headers: { cookie }, payload: {} })).statusCode).toBe(403);
    for (const action of ["settings", "export", "prune", "recovery-review", "recovery-complete", "cleanup-review", "cleanup"]) expect((await app.inject({ method: "POST", url: `/api/v1/management/${action}`, headers: { cookie }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/v1/management/apply", headers, payload: {} })).statusCode).toBe(409);
  } finally { await app.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
});


it("reads missing inventory network details only within the allowlist and keeps failures unknown", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-inventory-api-"));
  const socketPath = path.join(directory, "docker.sock");
  const vpnId = "a".repeat(64), clientId = "b".repeat(64), missingId = "c".repeat(64), outsideId = "d".repeat(64);
  const reads: string[] = [];
  const socket = http.createServer((request, response) => {
    const url = new URL(request.url!, "http://docker.local");
    const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    if (request.method !== "GET") return send(403, {});
    if (url.pathname === "/containers/json") return send(200, [vpnId, clientId, missingId, outsideId].map(id => ({ Id: id, Names: ["/fixture-" + id[0]], Image: id === vpnId ? "qmcgaw/gluetun:latest" : "synthetic:local", Labels: { "com.docker.compose.project": id === outsideId ? "outside" : "approved" } })));
    const id = url.pathname.split("/")[2]!; reads.push(id);
    if (id === missingId) return send(404, {});
    return send(200, { Id: id, Config: { Labels: { "com.docker.compose.project": "approved" }, Env: ["SECRET=never-return"] }, HostConfig: { NetworkMode: id === clientId ? "container:" + vpnId : "none" } });
  });
  await new Promise<void>(resolve => socket.listen(socketPath, resolve));
  try {
    const candidates = await new SocketManagedDocker(socketPath).candidates(["approved"]);
    expect(candidates.find(candidate => candidate.id === clientId)?.network).toEqual({ kind: "vpn_namespace", vpnId });
    expect(candidates.find(candidate => candidate.id === missingId)?.network).toEqual({ kind: "unknown", vpnId: null });
    expect(reads.sort()).toEqual([vpnId, clientId, missingId].sort());
    expect(JSON.stringify(candidates)).not.toContain("never-return");
    expect(candidates.some(candidate => candidate.id === outsideId)).toBe(false);
  } finally { await new Promise<void>(resolve => socket.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); }
});

it("requires authoritative dependency details and refuses unknown foreign-project metadata without inspecting it", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-dependencies-")); const socketPath = path.join(directory, "docker.sock"); const vpnId = "a".repeat(64), clientId = "b".repeat(64); let foreign = false, missing = false; const reads: string[] = [];
  const socket = http.createServer((request, response) => {
    const url = new URL(request.url!, "http://docker.local"); const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    if (url.pathname === "/containers/json") return send(200, [{ Id: vpnId, Labels: { "com.docker.compose.project": "approved" }, HostConfig: { NetworkMode: "bridge" } }, { Id: clientId, Labels: { "com.docker.compose.project": foreign ? "outside" : "approved" } }]);
    reads.push(url.pathname); if (missing) return send(404, {}); return send(200, { Id: clientId, Config: { Labels: { "com.docker.compose.project": "approved" } }, HostConfig: { NetworkMode: `container:${vpnId}` } });
  });
  await new Promise<void>(resolve => socket.listen(socketPath, resolve)); const docker = new SocketManagedDocker(socketPath); const vpn = { Id: vpnId, Name: "/vpn", Config: { Labels: { "com.docker.compose.project": "approved" } }, HostConfig: {}, State: {} };
  try { expect(await docker.dependents(vpn)).toEqual([clientId]); missing = true; await expect(docker.dependents(vpn)).rejects.toThrow(); foreign = true; const count = reads.length; await expect(docker.dependents(vpn)).rejects.toThrow(/unknown/); expect(reads).toHaveLength(count); } finally { await new Promise<void>(resolve => socket.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); }
});
