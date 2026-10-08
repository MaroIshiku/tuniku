import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { ManagedError, type ManagedContainer, type ManagedDocker } from "./engine.js";
import type { HostBinding } from "../compose/ports.js";
import { managedInventory, type ManagedCandidate } from "./inventory.js";

export class SocketManagedDocker implements ManagedDocker {
  constructor(private readonly socketPath: string, private readonly healthTimeoutMs = 90_000, private readonly projects: string[] = []) {}
  private async request(method: string, pathname: string, body?: unknown): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const request = http.request({ socketPath: this.socketPath, path: pathname, method, headers: { accept: "application/json", ...(bytes ? { "content-type": "application/json", "content-length": bytes.length } : {}) } }, (response) => {
        const chunks: Buffer[] = []; let length = 0;
        response.on("data", (chunk: Buffer) => { length += chunk.length; if (length > 4 * 1024 * 1024) request.destroy(new ManagedError("Docker response exceeded its size limit.")); else chunks.push(chunk); });
        response.on("error", () => reject(new ManagedError("Docker response failed.")));
        response.on("end", () => {
          const status = response.statusCode ?? 502;
          if (status < 200 || status >= 400) reject(new ManagedError(`Docker operation returned HTTP ${status}.`, status === 404 ? "not_found" : "unavailable"));
          else resolve({ status, body: Buffer.concat(chunks) });
        });
      });
      request.setTimeout(40_000, () => request.destroy(new ManagedError("Docker operation timed out.")));
      request.on("error", () => reject(new ManagedError("Docker operation failed. Check the helper's socket access and Docker availability.")));
      request.end(bytes);
    });
  }
  private id(value: string): string { if (!/^[a-f0-9]{64}$/.test(value)) throw new ManagedError("Invalid managed container identity."); return value; }
  async candidates(projects: string[]): Promise<ManagedCandidate[]> {
    const response = await this.request("GET", "/containers/json?all=1");
    const containers = JSON.parse(response.body.toString());
    if (!Array.isArray(containers)) throw new ManagedError("Docker returned an invalid container list.");
    const scopedIds = new Set(managedInventory(containers, projects).map(candidate => candidate.id));
    const missing = containers.filter(container => scopedIds.has(container.Id) && !container.HostConfig?.NetworkMode).slice(0, 64);
    for (let index = 0; index < missing.length; index += 4) {
      await Promise.all(missing.slice(index, index + 4).map(async container => {
        try {
          const inspected = await this.inspect(container.Id);
          if (inspected.Config.Labels?.["com.docker.compose.project"] === container.Labels?.["com.docker.compose.project"]) container.HostConfig = { NetworkMode: inspected.HostConfig?.NetworkMode };
        } catch { /* Missing or inaccessible detail remains explicitly unknown. */ }
      }));
    }
    return managedInventory(containers, projects);
  }
  async inspect(id: string): Promise<ManagedContainer> {
    const result = await this.request("GET", `/containers/${this.id(id)}/json`);
    const container = JSON.parse(result.body.toString()) as ManagedContainer;
    if (container.Id !== id) throw new ManagedError("Docker returned a different container identity.");
    return container;
  }
  async dependents(vpn: ManagedContainer): Promise<string[]> {
    const result = await this.request("GET", "/containers/json?all=1");
    const containers = JSON.parse(result.body.toString());
    if (!Array.isArray(containers)) throw new ManagedError("Docker returned an invalid container list.");
    const targets = [vpn.Id, vpn.Id.slice(0, 12), vpn.Name.replace(/^\//, "")].map((value) => `container:${value}`);
    const project = vpn.Config.Labels?.["com.docker.compose.project"];
    const missing = containers.filter(container => typeof container.HostConfig?.NetworkMode !== "string" || !container.HostConfig.NetworkMode);
    if (missing.length > 64 || missing.some(container => ![project, ...this.projects].includes(container.Labels?.["com.docker.compose.project"]))) throw new ManagedError("Dependency completeness is unknown: missing network details outside this project. No change is allowed.");
    for (let index = 0; index < missing.length; index += 4) {
      await Promise.all(missing.slice(index, index + 4).map(async container => {
        const inspected = await this.inspect(container.Id);
        if (inspected.Config.Labels?.["com.docker.compose.project"] !== container.Labels?.["com.docker.compose.project"] || !inspected.HostConfig?.NetworkMode) throw new ManagedError("Dependency details are incomplete or changed project. No change is allowed.");
        container.HostConfig = { NetworkMode: inspected.HostConfig.NetworkMode };
      }));
    }
    return containers.filter((container) => targets.includes(container.HostConfig?.NetworkMode)).map((container) => this.id(container.Id));
  }
  async hostBindings(excludeId: string): Promise<HostBinding[]> {
    const result = await this.request("GET", "/containers/json?all=1");
    const containers = JSON.parse(result.body.toString());
    if (!Array.isArray(containers)) throw new ManagedError("Docker returned an invalid container list.");
    return containers.filter((container) => container.Id !== excludeId).flatMap((container) => (container.Ports ?? []).flatMap((port: any) => Number.isInteger(port.PublicPort) && port.PublicPort >= 1 && port.PublicPort <= 65535 && ["tcp", "udp"].includes(port.Type) ? [{ address: String(port.IP ?? ""), first: port.PublicPort, last: port.PublicPort, protocol: port.Type }] : []));
  }
  async create(name: string, configuration: Record<string, any>): Promise<string> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(name)) throw new ManagedError("Invalid managed container name.");
    const result = await this.request("POST", `/containers/create?name=${encodeURIComponent(name)}`, configuration);
    return this.id(JSON.parse(result.body.toString()).Id);
  }
  async rename(id: string, name: string): Promise<void> { if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/.test(name)) throw new ManagedError("Invalid recovery container name."); await this.request("POST", `/containers/${this.id(id)}/rename?name=${encodeURIComponent(name)}`); }
  async start(id: string): Promise<void> { await this.request("POST", `/containers/${this.id(id)}/start`); }
  async stop(id: string): Promise<void> { await this.request("POST", `/containers/${this.id(id)}/stop?t=15`); }
  async remove(id: string): Promise<void> { await this.request("DELETE", `/containers/${this.id(id)}?v=false&force=false`); }
  async waitHealthy(id: string, requireHealth: boolean): Promise<void> {
    const deadline = Date.now() + this.healthTimeoutMs;
    while (Date.now() < deadline) {
      const container = await this.inspect(id);
      if (!container.State.Running) throw new ManagedError("The recreated service stopped before verification.");
      const health = container.State.Health?.Status;
      if (health === "unhealthy") throw new ManagedError("The recreated service is unhealthy.");
      if (!requireHealth || health === "healthy") return;
      if (!container.State.Health) throw new ManagedError("The VPN service needs a Docker health check before automatic application.");
      await delay(500);
    }
    throw new ManagedError("Service health verification timed out.");
  }
}
