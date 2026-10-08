import { gluetunStorage, readStorageSummary, type GluetunStorage } from "./storage.js";
import { logQuery, type DockerLogOptions } from "./logOptions.js";
import net from "node:net";
import { matchDockerEndpoint, type DockerAssociation } from "./association.js";
import { Agent, fetch } from "undici";
import { redactText, safeLookup, validateUpstreamUrl } from "../security.js";
import { readBoundedBody } from "../http.js";
import { getProviderProfile } from "../compose/providers.js";
import type { TrafficCounterSnapshot } from "../types.js";

const sensitiveName = /(password|token|secret|private[_-]?key|api[_-]?key|auth|openvpn_user|wireguard)/i;
type DisplayState = "Running" | "Stopped" | "Restarting" | "Failed" | "Paused" | "Unknown";

function stripAnsi(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === "[") {
      index += 2;
      while (index < value.length && (value.charCodeAt(index) < 64 || value.charCodeAt(index) > 126)) index += 1;
      continue;
    }
    output += value[index];
  }
  return output;
}

export interface DockerObservation {
  observedAt?: string;
  available: boolean;
  association?: DockerAssociation;
  storage?: GluetunStorage;
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
  private readonly dispatcher: Agent;

  constructor(
    private readonly baseUrl: string,
    private readonly allowLoopback: boolean
  ) { this.dispatcher = new Agent({ connect: { lookup: safeLookup(allowLoopback) } }); }

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
    try {
      const baseUrl = await validateUpstreamUrl(this.baseUrl, this.allowLoopback);
      const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(5_000)
      });
      const text = (await readBoundedBody(response, 2_097_152)).toString("utf8");
      if (text.length > 2_097_152) throw new Error("Docker proxy response exceeds the safe size limit.");
      let value: any = null;
      try {
        value = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("Docker observer returned malformed JSON.");
      }
      if (!response.ok) {
        const code = typeof value?.error === "string" ? value.error : "";
        if (code === "gluetun_not_found") throw new Error("No Gluetun container was found by the Docker observer.");
        if (code === "gluetun_not_running") throw new Error("Gluetun is not running, so live traffic counters are unavailable.");
        if (code === "network_counters_unavailable") throw new Error("Docker did not return network counters for the Gluetun container.");
        if (code === "stats_failed") throw new Error("Docker could not read Gluetun traffic counters.");
        if (code === "gluetun_ambiguous") throw new Error("Multiple Gluetun containers match the observer. Assign com.ishiku.tuniku.role=gluetun to exactly one intended VPN container before using Docker diagnostics.");
        if (code === "docker_socket_missing") throw new Error("The observer is running but its Docker socket is missing. Check the host socket path and redeploy the observer mount.");
        if (code === "docker_socket_permission_denied") throw new Error("The observer cannot access the Docker socket. Check its runtime user, socket permissions and supplementary group.");
        if (code === "docker_unavailable") throw new Error("The observer is running but Docker is unavailable. Check the Docker service and the observer's socket access.");
        throw new Error(`Docker observer returned HTTP ${response.status}.`);
      }
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
        throw new Error("The Docker observer helper cannot be resolved. Redeploy the complete current Tuniku Compose so the tuniku-docker-observer service and internal network are created.", { cause: error });
      }
      if (/ECONNREFUSED/i.test(message)) {
        throw new Error("The Docker observer helper is not running or refused the connection.", { cause: error });
      }
      throw error;
    }
  }

  async observeTraffic(expectedBaseUrl?: string): Promise<TrafficCounterSnapshot> {
    const observation = expectedBaseUrl ? await this.observeGluetun(expectedBaseUrl, false) : null;
    if (expectedBaseUrl && (!observation?.container || observation.association?.state !== "matched")) throw new Error(observation?.association?.message ?? "No associated Gluetun container is available for traffic accounting.");
    const value = await this.get("/gluetun/traffic");
    if (
      !value ||
      typeof value.containerId !== "string" ||
      typeof value.observedAt !== "string" ||
      !Number.isSafeInteger(value.receivedBytes) || value.receivedBytes < 0 ||
      !Number.isSafeInteger(value.sentBytes) || value.sentBytes < 0
    ) {
      throw new Error("Docker observer returned an unrecognized traffic response.");
    }
    if (observation?.container && value.containerId !== observation.container.id) throw new Error("The Docker container changed during traffic collection. Retry after refreshing its association.");
    return value as TrafficCounterSnapshot;
  }

  private async getBytes(path: string): Promise<Uint8Array> {
    const baseUrl = await validateUpstreamUrl(this.baseUrl, this.allowLoopback);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      redirect: "error",
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`Docker proxy returned HTTP ${response.status} for container logs.`);
    const bytes = await readBoundedBody(response, 524_288);
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

  async observeGluetun(expectedBaseUrl?: string, includeLogs = true, logOptions: DockerLogOptions = {}): Promise<DockerObservation> {
    const containers = await this.get("/containers/json?all=1");
    if (!Array.isArray(containers)) throw new Error("Docker proxy returned an unrecognized container list.");
    const match = containers.find((container: any) => {
      const names = Array.isArray(container?.Names) ? container.Names.join(" ") : "";
      return container?.Labels?.["com.ishiku.tuniku.role"] === "gluetun" || /gluetun/i.test(`${names} ${container?.Image || ""}`);
    });
    if (!match?.Id) {
      return { available: true, container: null, ports: [], environment: [], networks: [], logs: null, logsError: null, issues: ["No Gluetun container was found."] };
    }
    const inspected = await this.get(`/containers/${encodeURIComponent(match.Id)}/json`);
    if (inspected?.Id !== match.Id) throw new Error("The Docker container identity changed during inspection.");
    let association: DockerAssociation | undefined;
    if (expectedBaseUrl) {
      try {
        const endpoint = new URL(expectedBaseUrl);
        const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
        const addresses = net.isIP(hostname) ? [hostname] : await new Promise<string[]>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Endpoint lookup timed out.")), 3_000);
          safeLookup(this.allowLoopback)(hostname, { all: true }, (error: Error | null, values: any) => {
            clearTimeout(timeout);
            if (error) reject(error); else resolve(Array.isArray(values) ? values.map((entry: any) => entry.address) : []);
          });
        });
        association = matchDockerEndpoint(endpoint, addresses, inspected);
      } catch { association = { state: "unverified", message: "The saved Control API address could not be resolved or associated with this Docker container. Docker ports and traffic are not attributed to the API instance." }; }
    }
    const environmentEntries: string[] = Array.isArray(inspected?.Config?.Env) ? inspected.Config.Env : [];
    const environment = environmentEntries
      .map((entry: string) => {
        const name = entry.split("=", 1)[0] || "UNKNOWN";
        return { name, sensitive: sensitiveName.test(name) };
      });
    const ports: DockerObservation["ports"] = [];
    const networkBindings = inspected?.NetworkSettings?.Ports && typeof inspected.NetworkSettings.Ports === "object"
      ? inspected.NetworkSettings.Ports
      : {};
    const configuredBindings = inspected?.HostConfig?.PortBindings && typeof inspected.HostConfig.PortBindings === "object"
      ? inspected.HostConfig.PortBindings
      : {};
    const exposedPorts = inspected?.Config?.ExposedPorts && typeof inspected.Config.ExposedPorts === "object"
      ? inspected.Config.ExposedPorts
      : {};
    const containerKeys = new Set([
      ...Object.keys(networkBindings),
      ...Object.keys(configuredBindings),
      ...Object.keys(exposedPorts)
    ]);
    for (const containerKey of containerKeys) {
      const [portText, protocolText] = containerKey.split("/");
      const containerPort = Number(portText);
      if (!Number.isInteger(containerPort) || !["tcp", "udp"].includes(protocolText || "")) continue;
      const runtime = networkBindings[containerKey];
      const configured = configuredBindings[containerKey];
      const hostBindings = Array.isArray(runtime) && runtime.length > 0 ? runtime : configured ?? runtime;
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
    const storage = inspected.Storage ? readStorageSummary(inspected.Storage) : gluetunStorage(inspected);
    const issues: string[] = [];
    if (!["volume", "bind"].includes(storage.state) || storage.writable === false) issues.push(storage.message);
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
      const bytes = includeLogs ? await this.getBytes(`/containers/${encodeURIComponent(match.Id)}/logs?${logQuery(logOptions)}`) : new Uint8Array();
      logs = redactText(stripAnsi(this.decodeLogs(bytes)).trim()).slice(-262_144) || null;
      if (logs && /TUN device.*(?:permission denied|not available)/i.test(logs)) {
        issues.push("Docker cannot use /dev/net/tun. Verify that the device exists and that the Gluetun service has /dev/net/tun plus NET_ADMIN access.");
      }
      if (logs && /(?:country|region|city|hostname|server name).*not valid|no possible value available/i.test(logs)) {
        issues.push("Gluetun rejected the selected server filter. Choose a current value from Tuniku's provider-specific server list.");
      }
      if (logs && /AUTH_FAILED|authentication failed|credentials.*(?:invalid|rejected)/i.test(logs)) {
        issues.push("The VPN provider rejected the configured credentials.");
      }
      if (logs && /(?:permission denied.*\/gluetun|\/gluetun.*permission denied)/i.test(logs)) {
        issues.push("Gluetun cannot write its /gluetun storage. Check the volume or host-directory ownership and permissions.");
      }
    } catch (error) {
      logsError = error instanceof Error ? error.message : "Docker logs could not be read.";
    }
    return {
      available: true,
      storage,
      ...(association ? { association } : {}),
      container: {
        id: String(inspected?.Id || match.Id),
        name: String(inspected?.Name || "").replace(/^\//, ""),
        image: String(inspected?.Config?.Image || match.Image || ""),
        state: stateName,
        displayState: this.displayState(stateName, exitCode),
        health: state.Health?.Status ? String(state.Health.Status) : null,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        startedAt: state.StartedAt ? String(state.StartedAt) : null,
        finishedAt: state.FinishedAt ? String(state.FinishedAt) : null,
        error: state.Error ? redactText(String(state.Error)) : null,
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
