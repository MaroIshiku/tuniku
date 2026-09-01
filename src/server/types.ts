export type AuthMode = "none" | "api_key" | "basic";
export type CapabilityName =
  | "vpn"
  | "vpnSettings"
  | "publicIp"
  | "dns"
  | "updater"
  | "portForwarding";

export type CapabilityState = "available" | "unsupported" | "unauthorized" | "invalid_schema" | "unreachable";

export interface CapabilityResult {
  state: CapabilityState;
  detail?: string;
}

export type CapabilityMap = Record<CapabilityName, CapabilityResult>;

export interface InstanceRecord {
  id: string;
  displayName: string;
  baseUrl: string;
  authMode: AuthMode;
  tlsVerify: boolean;
  requestTimeoutSeconds: number;
  hasStoredCredential: boolean;
  capabilityCache: CapabilityMap | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpstreamCredential {
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "admin";
}

export interface VpnStatus {
  status: string;
}

export interface PublicIpStatus {
  publicIp: string;
}

export interface PortForwardStatus {
  ports: number[];
}

export interface TrafficCounterSnapshot {
  containerId: string;
  receivedBytes: number;
  sentBytes: number;
  observedAt: string;
}

export interface TrafficSummary {
  available: boolean;
  source: "docker_stats";
  observedAt: string | null;
  downloadBytesPerSecond: number;
  uploadBytesPerSecond: number;
  sessionDownloadedBytes: number;
  sessionUploadedBytes: number;
  todayDownloadedBytes: number;
  todayUploadedBytes: number;
  trackedDownloadedBytes: number;
  trackedUploadedBytes: number;
}

export interface OverviewSnapshot {
  instanceId: string;
  connected: boolean;
  stale: boolean;
  lastUpdatedAt: string;
  error: { code: string; message: string } | null;
  vpn: VpnStatus | null;
  publicIp: PublicIpStatus | null;
  dns: VpnStatus | null;
  updater: VpnStatus | null;
  portForwarding: PortForwardStatus | null;
  settings: Record<string, unknown> | null;
  capabilities: CapabilityMap;
}

export interface LocalPortLabel {
  id: string;
  instanceId: string;
  label: string;
  hostAddress: string | null;
  hostPort: number | null;
  containerPort: number;
  protocol: "tcp" | "udp";
  sourceType: "manual" | "docker";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
