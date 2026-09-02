import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children: ChildProcess[] = [];
const servers: http.Server[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test port unavailable.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForObserver(url: string, child: ChildProcess, stderr: () => string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Observer exited early: ${stderr()}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Observer did not become ready: ${stderr()}`);
}

describe("Docker observer helper process", () => {
  it("selects the labeled Gluetun container and supports compatible stats and inspect fallbacks", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-observer-"));
    temporaryDirectories.push(temporaryDirectory);
    const socketPath = path.join(temporaryDirectory, "docker.sock");
    const containerId = "abcdef1234567890";
    let oneShotRequested = false;
    let compatibleStatsRequested = false;
    const docker = http.createServer((request, response) => {
      const send = (status: number, value: unknown) => {
        const body = JSON.stringify(value);
        response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
        response.end(body);
      };
      if (request.url === "/containers/json?all=1") {
        return send(200, [
          { Id: "1111111111111111", Names: ["/old-gluetun"], Image: "qmcgaw/gluetun:latest", State: "exited" },
          {
            Id: containerId,
            Names: ["/vpn"],
            Image: "qmcgaw/gluetun:latest",
            State: "running",
            Labels: { "com.ishiku.tuniku.role": "gluetun" }
          }
        ]);
      }
      if (request.url === `/containers/${containerId}/stats?stream=false&one-shot=true`) {
        oneShotRequested = true;
        return send(400, { message: "one-shot is not supported" });
      }
      if (request.url === `/containers/${containerId}/stats?stream=false`) {
        compatibleStatsRequested = true;
        return send(200, { network: { rx_bytes: 12_345, tx_bytes: 6_789 } });
      }
      if (request.url === `/containers/${containerId}/json`) {
        return send(200, {
          Id: containerId,
          Name: "/vpn",
          Config: { Image: "qmcgaw/gluetun:latest", Env: [], ExposedPorts: { "8000/tcp": {} } },
          HostConfig: { PortBindings: { "5800/tcp": [{ HostIp: "0.0.0.0", HostPort: "5800" }] } },
          State: { Status: "running", ExitCode: 0 },
          NetworkSettings: { Ports: {}, Networks: { tuniku: {} } }
        });
      }
      return send(404, { message: "not found" });
    });
    servers.push(docker);
    await new Promise<void>((resolve) => docker.listen(socketPath, resolve));

    const port = await availablePort();
    let stderr = "";
    const child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "src/server/docker/observerProxy.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, DOCKER_SOCKET_PATH: socketPath, TUNIKU_OBSERVER_PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"]
    });
    children.push(child);
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const observerUrl = `http://127.0.0.1:${port}`;
    await waitForObserver(observerUrl, child, () => stderr);

    const trafficResponse = await fetch(`${observerUrl}/gluetun/traffic`);
    expect(trafficResponse.status).toBe(200);
    expect(await trafficResponse.json()).toMatchObject({
      containerId,
      receivedBytes: 12_345,
      sentBytes: 6_789
    });
    expect(oneShotRequested).toBe(true);
    expect(compatibleStatsRequested).toBe(true);

    const listResponse = await fetch(`${observerUrl}/containers/json?all=1`);
    expect(await listResponse.json()).toEqual([expect.objectContaining({ Id: containerId, Names: ["/vpn"] })]);
    const inspectResponse = await fetch(`${observerUrl}/containers/${containerId}/json`);
    expect(await inspectResponse.json()).toMatchObject({
      Config: { ExposedPorts: { "8000/tcp": {} } },
      HostConfig: { PortBindings: { "5800/tcp": [{ HostIp: "0.0.0.0", HostPort: "5800" }] } }
    });
  });
});
