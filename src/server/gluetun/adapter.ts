import { Agent, fetch } from "undici";
import type {
  CapabilityMap,
  CapabilityName,
  CapabilityResult,
  InstanceRecord,
  OverviewSnapshot,
  PortForwardStatus,
  PublicIpStatus,
  UpstreamCredential,
  VpnStatus
} from "../types.js";
import { redactValue, validateUpstreamUrl } from "../security.js";

const READ_ROUTES = {
  vpn: "/v1/vpn/status",
  vpnSettings: "/v1/vpn/settings",
  publicIp: "/v1/publicip/ip",
  dns: "/v1/dns/status",
  updater: "/v1/updater/status",
  portForwarding: "/v1/portforward"
} as const satisfies Record<CapabilityName, string>;

const MUTATION_ROUTES = {
  vpn: "/v1/vpn/status",
  dns: "/v1/dns/status",
  updater: "/v1/updater/status",
  portForwarding: "/v1/portforward"
} as const;

export type MutationName = keyof typeof MUTATION_ROUTES;

export class GluetunError extends Error {
  constructor(
    readonly code:
      | "unreachable"
      | "timeout"
      | "tls"
      | "unauthorized"
      | "forbidden"
      | "unsupported"
      | "invalid_schema"
      | "upstream_error",
    message: string,
    readonly statusCode = 502
  ) {
    super(message);
  }
}

function statusPayload(value: unknown): VpnStatus {
  const status = value && typeof value === "object"
    ? (typeof (value as any).status === "string" ? (value as any).status : (value as any).outcome)
    : null;
  if (typeof status !== "string" || status.length === 0) {
    throw new GluetunError("invalid_schema", "Gluetun returned an unrecognized status response.");
  }
  return { status };
}

function publicIpPayload(value: unknown): PublicIpStatus {
  if (!value || typeof value !== "object" || typeof (value as any).public_ip !== "string") {
    throw new GluetunError("invalid_schema", "Gluetun returned an unrecognized public IP response.");
  }
  return { publicIp: (value as any).public_ip };
}

function portForwardPayload(value: unknown): PortForwardStatus {
  if (!value || typeof value !== "object") {
    throw new GluetunError("invalid_schema", "Gluetun returned an unrecognized port-forwarding response.");
  }
  const single = (value as any).port;
  const multiple = (value as any).ports;
  const ports = Array.isArray(multiple)
    ? multiple
    : Number.isInteger(single) && single > 0
      ? [single]
      : single === undefined || single === null || single === 0
        ? []
        : [single];
  if (!ports.every((port) => Number.isInteger(port) && port >= 1 && port <= 65_535)) {
    throw new GluetunError("invalid_schema", "Gluetun returned invalid forwarded port values.");
  }
  return { ports };
}

function capabilityFromError(error: unknown): CapabilityResult {
  if (!(error instanceof GluetunError)) return { state: "unreachable", detail: "Unexpected upstream error." };
  switch (error.code) {
    case "unsupported":
      return { state: "unsupported", detail: error.message };
    case "unauthorized":
    case "forbidden":
      return { state: "unauthorized", detail: error.message };
    case "invalid_schema":
      return { state: "invalid_schema", detail: error.message };
    default:
      return { state: "unreachable", detail: error.message };
  }
}

export class GluetunAdapter {
  private readonly dispatcher: Agent;
  private validatedOriginAt = 0;

  constructor(
    private readonly instance: InstanceRecord,
    private readonly credential: UpstreamCredential | null,
    private readonly allowLoopback: boolean
  ) {
    this.dispatcher = new Agent({ connect: { rejectUnauthorized: instance.tlsVerify } });
  }

  close(): void {
    void this.dispatcher.close();
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.instance.authMode === "api_key" && this.credential?.apiKey) {
      headers["x-api-key"] = this.credential.apiKey;
    }
    if (this.instance.authMode === "basic" && this.credential?.username !== undefined && this.credential.password !== undefined) {
      headers.authorization = `Basic ${Buffer.from(`${this.credential.username}:${this.credential.password}`).toString("base64")}`;
    }
    return headers;
  }

  private async validateOrigin(): Promise<void> {
    if (Date.now() - this.validatedOriginAt < 30_000) return;
    await validateUpstreamUrl(this.instance.baseUrl, this.allowLoopback);
    this.validatedOriginAt = Date.now();
  }

  private async request(path: string, method: "GET" | "PUT" = "GET", body?: unknown): Promise<unknown> {
    await this.validateOrigin();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.instance.requestTimeoutSeconds * 1000);
    try {
      const response = await fetch(`${this.instance.baseUrl}${path}`, {
        method,
        headers: {
          ...this.headers(),
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        dispatcher: this.dispatcher
      });
      if (response.status === 401) throw new GluetunError("unauthorized", "Gluetun rejected the configured authentication.", 401);
      if (response.status === 403) throw new GluetunError("forbidden", "The Gluetun role does not permit this route.", 403);
      if (response.status === 404 || response.status === 405) {
        throw new GluetunError("unsupported", "This route is not supported by the connected Gluetun version.", 404);
      }
      if (!response.ok) throw new GluetunError("upstream_error", `Gluetun returned HTTP ${response.status}.`);
      const text = await response.text();
      if (text.length > 1_048_576) throw new GluetunError("invalid_schema", "Gluetun returned an unexpectedly large response.");
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw new GluetunError("invalid_schema", "Gluetun returned invalid JSON.");
      }
    } catch (error: any) {
      if (error instanceof GluetunError) throw error;
      if (error?.name === "AbortError") throw new GluetunError("timeout", "The Gluetun request timed out.", 504);
      const message = String(error?.message || error);
      if (/certificate|self[- ]signed|tls/i.test(message)) {
        throw new GluetunError("tls", "TLS certificate verification failed. Verify the certificate before considering a bypass.");
      }
      throw new GluetunError("unreachable", "Tuniku is online but cannot reach the configured Gluetun Control Server.");
    } finally {
      clearTimeout(timeout);
    }
  }

  async read(capability: CapabilityName): Promise<unknown> {
    const payload = await this.request(READ_ROUTES[capability]);
    switch (capability) {
      case "vpn":
      case "dns":
      case "updater":
        return statusPayload(payload);
      case "publicIp":
        return publicIpPayload(payload);
      case "portForwarding":
        return portForwardPayload(payload);
      case "vpnSettings":
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new GluetunError("invalid_schema", "Gluetun returned an unrecognized settings response.");
        }
        return redactValue(payload);
    }
  }

  async probe(): Promise<CapabilityMap> {
    const entries = await Promise.all(
      (Object.keys(READ_ROUTES) as CapabilityName[]).map(async (name) => {
        try {
          await this.read(name);
          return [name, { state: "available" } satisfies CapabilityResult] as const;
        } catch (error) {
          return [name, capabilityFromError(error)] as const;
        }
      })
    );
    return Object.fromEntries(entries) as CapabilityMap;
  }

  async overview(previous: OverviewSnapshot | null = null): Promise<OverviewSnapshot> {
    const timestamp = new Date().toISOString();
    const capabilities = await this.probe();
    const value = async <T>(name: CapabilityName): Promise<T | null> => {
      if (capabilities[name].state !== "available") return null;
      return await this.read(name) as T;
    };
    try {
      const [vpn, publicIp, dns, updater, portForwarding, settings] = await Promise.all([
        value<VpnStatus>("vpn"),
        value<PublicIpStatus>("publicIp"),
        value<VpnStatus>("dns"),
        value<VpnStatus>("updater"),
        value<PortForwardStatus>("portForwarding"),
        value<Record<string, unknown>>("vpnSettings")
      ]);
      const connected = Object.values(capabilities).some((state) => state.state === "available");
      return {
        instanceId: this.instance.id,
        connected,
        stale: false,
        lastUpdatedAt: timestamp,
        error: connected ? null : { code: "gluetun_unreachable", message: "No supported Gluetun route was reachable." },
        vpn,
        publicIp,
        dns,
        updater,
        portForwarding,
        settings,
        capabilities
      };
    } catch (error) {
      const known = error instanceof GluetunError ? error : new GluetunError("unreachable", "Unexpected upstream error.");
      return {
        ...(previous ?? {
          instanceId: this.instance.id,
          vpn: null,
          publicIp: null,
          dns: null,
          updater: null,
          portForwarding: null,
          settings: null
        }),
        connected: false,
        stale: true,
        lastUpdatedAt: previous?.lastUpdatedAt ?? timestamp,
        error: { code: known.code, message: known.message },
        capabilities
      };
    }
  }

  async mutate(operation: MutationName, payload: unknown): Promise<unknown> {
    if (!Object.prototype.hasOwnProperty.call(MUTATION_ROUTES, operation)) {
      throw new GluetunError("unsupported", "The requested operation is not allow-listed.");
    }
    if (operation === "vpn" || operation === "dns" || operation === "updater") {
      const status = (payload as any)?.status;
      const allowed = operation === "updater" ? ["running", "stopped"] : ["running", "stopped"];
      if (!allowed.includes(status)) throw new GluetunError("invalid_schema", "Invalid control status.", 400);
      return statusPayload(await this.request(MUTATION_ROUTES[operation], "PUT", { status }));
    }
    const ports = (payload as any)?.ports;
    if (!Array.isArray(ports) || ports.length > 10 || !ports.every((port) => Number.isInteger(port) && port >= 1 && port <= 65_535)) {
      throw new GluetunError("invalid_schema", "Forwarded ports must be an array of valid port numbers.", 400);
    }
    const response = await this.request(MUTATION_ROUTES.portForwarding, "PUT", { ports });
    if (response && typeof response === "object" && Object.keys(response as object).length > 0) {
      return portForwardPayload(response);
    }
    return { ports };
  }
}

export const gluetunRoutes = {
  read: READ_ROUTES,
  mutations: MUTATION_ROUTES
} as const;
