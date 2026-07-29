import { Agent, fetch } from "undici";
import { validateUpstreamUrl } from "../security.js";

const sensitiveName = /(password|token|secret|private[_-]?key|api[_-]?key|auth|openvpn_user|wireguard)/i;

export interface DockerObservation {
  available: boolean;
  container: {
    id: string;
    name: string;
    image: string;
    state: string;
    health: string | null;
  } | null;
  ports: Array<{
    hostAddress: string | null;
    hostPort: number | null;
    containerPort: number;
    protocol: "tcp" | "udp";
  }>;
  environment: Array<{ name: string; sensitive: boolean }>;
  networks: string[];
}

export class DockerObserver {
  private readonly dispatcher = new Agent();

  constructor(
    private readonly baseUrl: string,
    private readonly allowLoopback: boolean
  ) {}

  close(): void {
    void this.dispatcher.close();
  }

  private async get(path: string): Promise<any> {
    const baseUrl = await validateUpstreamUrl(this.baseUrl, this.allowLoopback);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`Docker proxy returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 2_097_152) throw new Error("Docker proxy response exceeds the safe size limit.");
    return text ? JSON.parse(text) : null;
  }

  async observeGluetun(): Promise<DockerObservation> {
    const containers = await this.get("/containers/json?all=1");
    if (!Array.isArray(containers)) throw new Error("Docker proxy returned an unrecognized container list.");
    const match = containers.find((container: any) => {
      const names = Array.isArray(container?.Names) ? container.Names.join(" ") : "";
      return /gluetun/i.test(`${names} ${container?.Image || ""}`);
    });
    if (!match?.Id) {
      return { available: true, container: null, ports: [], environment: [], networks: [] };
    }
    const inspected = await this.get(`/containers/${encodeURIComponent(match.Id)}/json`);
    const environment = Array.isArray(inspected?.Config?.Env)
      ? inspected.Config.Env.map((entry: string) => {
        const name = entry.split("=", 1)[0] || "UNKNOWN";
        return { name, sensitive: sensitiveName.test(name) };
      })
      : [];
    const ports: DockerObservation["ports"] = [];
    const bindings = inspected?.NetworkSettings?.Ports;
    if (bindings && typeof bindings === "object") {
      for (const [containerKey, hostBindings] of Object.entries(bindings)) {
        const [portText, protocolText] = containerKey.split("/");
        const containerPort = Number(portText);
        if (!Number.isInteger(containerPort) || !["tcp", "udp"].includes(protocolText || "")) continue;
        if (!Array.isArray(hostBindings) || hostBindings.length === 0) {
          ports.push({ hostAddress: null, hostPort: null, containerPort, protocol: protocolText as "tcp" | "udp" });
          continue;
        }
        for (const binding of hostBindings as any[]) {
          const hostPort = Number(binding?.HostPort);
          ports.push({
            hostAddress: binding?.HostIp || null,
            hostPort: Number.isInteger(hostPort) ? hostPort : null,
            containerPort,
            protocol: protocolText as "tcp" | "udp"
          });
        }
      }
    }
    const networkMap = inspected?.NetworkSettings?.Networks;
    return {
      available: true,
      container: {
        id: String(inspected?.Id || match.Id).slice(0, 12),
        name: String(inspected?.Name || "").replace(/^\//, ""),
        image: String(inspected?.Config?.Image || match.Image || ""),
        state: String(inspected?.State?.Status || match.State || "unknown"),
        health: inspected?.State?.Health?.Status ? String(inspected.State.Health.Status) : null
      },
      ports,
      environment,
      networks: networkMap && typeof networkMap === "object" ? Object.keys(networkMap) : []
    };
  }
}
