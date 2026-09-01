export type Theme = "lavender" | "mint" | "sky" | "amber" | "rose" | "graphite";
export type Mode = "system" | "light" | "dark";
export type Section = "overview" | "control" | "ports" | "assistant";
export type Language = "en";

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: "admin";
}

export interface Bootstrap {
  setup: {
    state: "completed" | "unconfigured" | "ready_to_register";
    missingConfiguration: string[];
  };
  session: { user: User; csrfToken: string } | null;
  app: { name: string; subtitle: string; version: string };
}

export interface SessionSummary {
  current: {
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
    reauthenticatedAt: string;
  };
  otherCount: number;
}

export interface Instance {
  id: string;
  displayName: string;
  baseUrl: string;
  authMode: "none" | "api_key" | "basic";
  tlsVerify: boolean;
  requestTimeoutSeconds: number;
  hasStoredCredential: boolean;
  capabilityCache: Record<string, { state: string; detail?: string }> | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Overview {
  instanceId: string;
  connected: boolean;
  stale: boolean;
  lastUpdatedAt: string;
  error: { code: string; message: string } | null;
  vpn: { status: string } | null;
  publicIp: { publicIp: string } | null;
  dns: { status: string } | null;
  updater: { status: string } | null;
  portForwarding: { ports: number[] } | null;
  settings: Record<string, unknown> | null;
  capabilities: Record<string, { state: string; detail?: string }>;
}

export interface PortLabel {
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

export interface PortDetection {
  available: boolean;
  error: string | null;
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

export interface ComposeResult {
  detectedConfiguration: Record<string, unknown>;
  recommendedChange: string;
  snippets: { compose: string; env: string; secrets: string; steps: string };
  manualSteps: string[];
  securityWarnings: string[];
  validation: { valid: boolean; errors: string[]; warnings: string[] };
  artifacts: Array<{ filename: string; content: string; mediaType: string }>;
  containsSecretValues: boolean;
  redacted: boolean;
}

export interface GluetunProviderProfile {
  id: string;
  label: string;
  protocols: Array<"openvpn" | "wireguard">;
  guidance: string;
  docsUrl: string;
  openvpnCredentials: "required" | "optional" | "none";
  openvpnCertificate: "none" | "client_key" | "encrypted_key";
  wireguardAddresses: boolean;
  wireguardPresharedKey: boolean;
  customConfiguration: boolean;
  serverFilters: Array<"countries" | "regions" | "cities" | "hostnames" | "names" | "categories" | "isps">;
  options: Array<{
    env: string;
    label: string;
    kind: "boolean" | "number" | "select";
    protocols?: Array<"openvpn" | "wireguard">;
    choices?: string[];
    enabledValue?: string;
    description: string;
  }>;
}

export interface ServerOptions {
  values: string[];
  source: "refreshed" | "bundled";
  sourceRevision: string;
  updatedAt: string | null;
}
