import { Agent, fetch } from "undici";
import { redactText, validateUpstreamUrl } from "../security.js";
import { getProviderProfile } from "../compose/providers.js";

const sensitiveName = /(password|token|secret|private[_-]?key|api[_-]?key|auth|openvpn_user|wireguard)/i;
const ansiColor = new RegExp("\\u001b\\[[0-9;]*m", "g");
type DisplayState = "Running" | "Stopped" | "Restarting" | "Failed" | "Paused" | "Unknown";

export interface DockerObservation {
  available: boolean;
  container: {
    id: string;
    name: string;
    image: string;
    state: string;
    displayState: DisplayState;
    health: string | null;
    exitCode: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    oomKilled: boolean;
    restartCount: number;
  } | null;
  ports: Array<{
    hostAddress: string | null;
    hostPort: number | null;
    containerPort: number;
    protocol: "tcp" | "udp";
  }>;
  environment: Array<{ name: string; sensitive: boolean }>;
  networks: string[];
  logs: string | null;
  logsError: string | null;
  issues: string[];
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

  private displayState(status: string, exitCode: number): DisplayState {
    if (status === "running") return "Running";
    if (status === "restarting") return "Restarting";
    if (status === "paused") return "Paused";
    if (status === "dead" || (status === "exited" && exitCode !== 0)) return "Failed";
    if (status === "created" || status === "exited") return "Stopped";
    return "Unknown";
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

  private async getBytes(path: string): Promise<Uint8Array> {
    const baseUrl = await validateUpstreamUrl(this.baseUrl, this.allowLoopback);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`Docker proxy returned HTTP ${response.status} for container logs.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 524_288) throw new Error("Docker log response exceeds the 512 KiB safety limit.");
    return bytes;
  }

  private decodeLogs(bytes: Uint8Array): string {
    const decoder = new TextDecoder();
    if (bytes.byteLength < 8 || ![0, 1, 2, 3].includes(bytes[0] ?? -1) || bytes[1] !== 0 || bytes[2] !== 0 || bytes[3] !== 0) {
      return decoder.decode(bytes);
    }
    const chunks: string[] = [];
    for (let offset = 0; offset + 8 <= bytes.byteLength;) {
      const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0);
      offset += 8;
      if (offset + size > bytes.byteLength) break;
      chunks.push(decoder.decode(bytes.subarray(offset, offset + size)));
      offset += size;
    }
    return chunks.join("");
  }

  async observeGluetun(): Promise<DockerObservation> {
    const containers = await this.get("/containers/json?all=1");
    if (!Array.isArray(containers)) throw new Error("Docker proxy returned an unrecognized container list.");
    const match = containers.find((container: any) => {
      const names = Array.isArray(container?.Names) ? container.Names.join(" ") : "";
      return /gluetun/i.test(`${names} ${container?.Image || ""}`);
    });
    if (!match?.Id) {
      return { available: true, container: null, ports: [], environment: [], networks: [], logs: null, logsError: null, issues: ["No Gluetun container was found."] };
    }
    const inspected = await this.get(`/containers/${encodeURIComponent(match.Id)}/json`);
    const environmentEntries: string[] = Array.isArray(inspected?.Config?.Env) ? inspected.Config.Env : [];
    const environment = environmentEntries
      .map((entry: string) => {
        const name = entry.split("=", 1)[0] || "UNKNOWN";
        return { name, sensitive: sensitiveName.test(name) };
      });
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
    const networks = networkMap && typeof networkMap === "object" ? Object.keys(networkMap) : [];
    const safeEnvironment = new Map(environmentEntries.map((entry) => {
      const separator = entry.indexOf("=");
      return separator === -1 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
    const provider = safeEnvironment.get("VPN_SERVICE_PROVIDER") ?? "";
    const vpnType = safeEnvironment.get("VPN_TYPE") || "openvpn";
    const profile = getProviderProfile(provider);
    const filterNames: Record<string, string> = {
      SERVER_COUNTRIES: "countries", SERVER_REGIONS: "regions", SERVER_CITIES: "cities",
      SERVER_HOSTNAMES: "hostnames", SERVER_NAMES: "names", SERVER_CATEGORIES: "categories", ISP: "isps"
    };
    const issues: string[] = [];
    if (!networks.includes("tuniku")) issues.push("Gluetun is not attached to the external tuniku network, so Tuniku cannot reach its Control Server by container name.");
    if (!profile) issues.push(provider ? `VPN_SERVICE_PROVIDER=${provider} is not accepted by the current Tuniku provider schema.` : "VPN_SERVICE_PROVIDER is missing.");
    if (profile && !profile.protocols.includes(vpnType as any)) issues.push(`${profile.label} does not support VPN_TYPE=${vpnType} in the current Gluetun latest image.`);
    if (profile) {
      for (const [name, filter] of Object.entries(filterNames)) {
        if (safeEnvironment.has(name) && !profile.serverFilters.includes(filter as any)) issues.push(`${name} is not supported for ${profile.label}.`);
      }
    }
    const state = inspected?.State ?? {};
    const stateName = String(state.Status || match.State || "unknown");
    const exitCode = Number(state.ExitCode);
    if (Number.isInteger(exitCode) && exitCode !== 0 && state.Status !== "running") issues.push(`Gluetun exited with code ${exitCode}.`);
    if (state.OOMKilled) issues.push("Gluetun was terminated by the out-of-memory killer.");
    if (state.Error) issues.push(`Docker runtime error: ${String(state.Error)}`);
    let logs: string | null = null;
    let logsError: string | null = null;
    try {
      const bytes = await this.getBytes(`/containers/${encodeURIComponent(match.Id)}/logs?stdout=1&stderr=1&tail=200&timestamps=1`);
      logs = redactText(this.decodeLogs(bytes).replace(ansiColor, "").trim()).slice(-262_144) || null;
    } catch (error) {
      logsError = error instanceof Error ? error.message : "Docker logs could not be read.";
    }
    return {
      available: true,
      container: {
        id: String(inspected?.Id || match.Id).slice(0, 12),
        name: String(inspected?.Name || "").replace(/^\//, ""),
        image: String(inspected?.Config?.Image || match.Image || ""),
        state: stateName,
        displayState: this.displayState(stateName, exitCode),
        health: state.Health?.Status ? String(state.Health.Status) : null,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        startedAt: state.StartedAt ? String(state.StartedAt) : null,
        finishedAt: state.FinishedAt ? String(state.FinishedAt) : null,
        error: state.Error ? String(state.Error) : null,
        oomKilled: Boolean(state.OOMKilled),
        restartCount: Number(inspected?.RestartCount) || 0
      },
      ports,
      environment,
      networks,
      logs,
      logsError,
      issues
    };
  }
}
