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
  publicIp: { publicIp: string; country: string | null; region: string | null; city: string | null } | null;
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
  observedAt?: string;
  available: boolean;
  error: string | null;
}

export interface TrafficSummary {
  available: boolean;
  source: "docker_stats";
  sampleQuality?: "unknown" | "baseline" | "continuous" | "gap" | "reset";
  sampleIntervalSeconds?: number | null;
  history?: { timeZone: string; days: Array<{ day: string; downloadedBytes: number; uploadedBytes: number }> };
  observedAt: string | null;
  downloadBytesPerSecond: number;
  uploadBytesPerSecond: number;
  sessionDownloadedBytes: number;
  sessionUploadedBytes: number;
  todayDownloadedBytes: number;
  todayUploadedBytes: number;
  trackedDownloadedBytes: number;
  trackedUploadedBytes: number;
  error?: string | null;
}

export interface ComposeResult {
  detectedConfiguration: Record<string, unknown>;
  recommendedChange: string;
  snippets: { compose: string; env: string; secrets: string; steps: string };
  manualSteps: string[];
  securityWarnings: string[];
  validation: { valid: boolean; errors: string[]; warnings: string[]; checks?: Array<{ id: string; label: string; status: "passed" | "failed" | "not_run" | "not_applicable"; detail: string }> };
  artifacts: Array<{ filename: string; content: string; mediaType: string }>;
  containsSecretValues: boolean;
  redacted: boolean;
}

export interface GluetunProviderProfile {
  schemaReview?: { status: "matched" | "changed" | "unavailable"; reviewedAt: string | null; sourceRevision: string | null; sourceUrl: string | null; sourceSha256: string | null; scope: string[]; runtimeValidated: false };
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
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  bundledAt?: string | null;
  sourceSha256?: string | null;
  runtimeComparison?: "unavailable";
}

export interface ManagedStatus {
  enabled: boolean;
  storage?: { plans: number; expiredUnreferenced: number; bytes: number; retainedContainers: number; limit: number };
  prerequisites?: { projects: string[]; bindRootsConfigured: boolean; adoptionOnly: boolean; restartAlwaysSupported: boolean };
  candidates: Array<{ id: string; name: string; image: string; state: string; project: string; role: "vpn" | "application"; network?: { kind: "vpn" | "vpn_namespace" | "other_container" | "other_network" | "unknown"; vpnId: string | null }; recovery?: boolean }>;
  projects: Array<{ id: string; vpnId: string; clientIds: string[]; composeProject: string }>;
  operations: Array<{ id: string; projectId: string; planId: string; status: "applying" | "succeeded" | "rolled_back" | "rollback_failed" | "interrupted"; step: string; startedAt: string; finishedAt: string | null; error: string | null; cleanupStatus?: "applying" | "completed" | "interrupted" }>;
}
export interface ManagedPlan {
  id: string;
  projectId: string;
  expiresAt: string;
  environmentKeys: string[];
  removedEnvironmentKeys?: string[];
  portsChanged: boolean;
  portsBefore: Record<string, unknown>;
  portsAfter: Record<string, unknown>;
  services: Array<{ name: string; image: string; running: boolean }>;
  interruptionRequired: boolean;
  warnings: string[];
}


export interface DockerDiagnostic {
  observedAt?: string;
  available: boolean;
  container: { id: string; name: string; state: string; displayState: string; health: string | null; exitCode: number | null; restartCount: number; error: string | null } | null;
  association?: { state: "matched" | "unverified"; message: string };
  issues: string[];
  logsError: string | null;
  reason?: string;
}


export interface ManagedServiceDiagnostic {
  id: string; name: string | null; availability: "available" | "missing" | "unavailable" | "out_of_scope";
  state: string | null; health: string | null; exitCode: number | null;
  namespace: "vpn" | "attached" | "different" | "not_shared" | "unknown"; issue: string | null;
}
export interface ManagedDiagnostics {
  projectId: string; observedAt: string; stale: boolean;
  vpn: ManagedServiceDiagnostic; applications: ManagedServiceDiagnostic[];
  configuration?: { state: "matched" | "drifted" | "unavailable"; baselineAt: string | null; baselineSource: "adoption" | "successful_apply" | "unavailable"; changedServiceIds: string[] };
  publishedPorts?: Record<string, unknown> | null;
}

export interface ComposeDraftSummary { id: string; instanceId: string | null; title: string; taskType: string; createdAt: string; updatedAt: string; }
export interface ComposeDraft extends ComposeDraftSummary { input: unknown; }
