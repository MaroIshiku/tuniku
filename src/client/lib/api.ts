import type { ManagedPlan, ManagedStatus, Bootstrap, ComposeResult, GluetunProviderProfile, Instance, Overview, PortDetection, PortLabel, ServerOptions, SessionSummary, TrafficSummary, User } from "./models.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
    readonly requestId?: string
  ) {
    super(message);
  }
}

let csrfToken = "";
let sessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void { sessionExpired = handler; }

export function setCsrfToken(token: string | null): void {
  csrfToken = token || "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method)) headers.set("x-csrf-token", csrfToken);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal, headers, credentials: "same-origin" });
    const payload = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error;
      return {};
    });
    if (!response.ok) {
      const error = payload?.error ?? {};
      if (response.status === 401 && error.code === "authentication_required") { const handler = sessionExpired; sessionExpired = null; handler?.(); }
      throw new ApiError(
        error.message || `Request failed with HTTP ${response.status}.`,
        error.code || "request_failed",
        response.status,
        error.details,
        error.requestId
      );
    }
    return payload as T;
  } catch (error) {
    if (timedOut) throw new ApiError("The request timed out. Check the current state before repeating a change.", "request_timeout", 0);
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}

const json = (value: unknown): string => JSON.stringify(value);

export const api = {
  managementAction: <T = any>(action: "settings" | "export" | "prune" | "recovery-review" | "recovery-complete" | "cleanup-review" | "cleanup", body: unknown) => request<T>(`/api/v1/management/${action}`, { method: "POST", body: json(body) }),
  management: () => request<ManagedStatus>("/api/v1/management"),
  managementAdopt: (vpnId: string, clientIds: string[]) => request<{ project: { id: string; services: string[] } }>("/api/v1/management/adopt", { method: "POST", body: json({ vpnId, clientIds, confirmed: true }) }),
  managementDiagnostics: (projectId: string) => request<{ diagnostics: import("./models.js").ManagedDiagnostics }>("/api/v1/management/diagnostics", { method: "POST", body: json({ projectId }) }),
  managementPlan: (projectId: string, input: unknown) => request<{ plan: ManagedPlan }>("/api/v1/management/plan", { method: "POST", body: json({ projectId, input }) }),
  managementApply: (planId: string) => request<{ operation: ManagedStatus["operations"][number] }>("/api/v1/management/apply", { method: "POST", body: json({ planId, confirmed: true }) }),
  bootstrap: () => request<Bootstrap>("/api/v1/bootstrap"),
  register: (body: unknown) => request<{ user: User; csrfToken: string }>(
    "/api/v1/auth/register-first-admin",
    { method: "POST", body: json(body) }
  ),
  login: (body: unknown) => request<{ user: User; csrfToken: string }>("/api/v1/auth/login", { method: "POST", body: json(body) }),
  touchActivity: () => request<{ ok: boolean }>("/api/v1/auth/activity", { method: "POST", body: "{}" }),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST", body: "{}" }),
  sessions: () => request<{ sessions: SessionSummary }>("/api/v1/auth/sessions"),
  reauthenticate: (password: string) => request<{ ok: boolean; reauthenticatedAt: string }>(
    "/api/v1/auth/reauthenticate",
    { method: "POST", body: json({ password }) }
  ),
  revokeOtherSessions: () => request<{ revoked: number }>(
    "/api/v1/auth/sessions/others",
    { method: "DELETE" }
  ),
  instances: () => request<{ instances: Instance[] }>("/api/v1/instances"),
  saveInstance: (id: string, body: unknown) => request<{ instance: Instance }>(`/api/v1/instances/${id}`, { method: "PUT", body: json(body) }),
  testInstance: (id: string, body: unknown = {}) => request<any>(`/api/v1/instances/${id}/test`, { method: "POST", body: json(body) }),
  deleteCredential: (id: string) => request<{ ok: boolean }>(`/api/v1/instances/${id}/stored-credential`, { method: "DELETE" }),
  overview: (id: string, refresh = false, signal?: AbortSignal) => request<{ overview: Overview }>(`/api/v1/instances/${id}/overview${refresh ? "?refresh=true" : ""}`, { signal: signal ?? null }),
  control: (id: string, action: string, body: unknown = { confirmed: true }) =>
    request<any>(`/api/v1/instances/${id}/${action}`, { method: "POST", body: json(body) }),
  setForwardedPorts: (id: string, ports: number[]) =>
    request<any>(`/api/v1/instances/${id}/port-forwarding`, { method: "PUT", body: json({ ports, confirmed: true }) }),
  ports: (id: string, force = false, signal?: AbortSignal) => request<{ ports: PortLabel[]; detection: PortDetection }>(`/api/v1/instances/${id}/ports${force ? "?force=true" : ""}`, { signal: signal ?? null }),
  createPort: (id: string, body: unknown) => request<{ port: PortLabel }>(`/api/v1/instances/${id}/port-labels`, { method: "POST", body: json(body) }),
  updatePort: (id: string, portId: string, body: unknown) => request<{ port: PortLabel }>(`/api/v1/instances/${id}/port-labels/${portId}`, { method: "PUT", body: json(body) }),
  deletePort: (id: string, portId: string) => request<{ ok: boolean }>(`/api/v1/instances/${id}/port-labels/${portId}`, { method: "DELETE" }),
  generate: (body: unknown) => request<{ result: ComposeResult }>("/api/v1/compose/generate", { method: "POST", body: json(body) }),
  composeProviders: () => request<{ providers: GluetunProviderProfile[]; gluetunVersion: string; gluetunImage: string }>("/api/v1/compose/providers"),
  serverOptions: (provider: string, vpnType: "openvpn" | "wireguard", field: string, query = "", selection: Record<string, string> = {}, signal?: AbortSignal) =>
    request<{ options: ServerOptions }>(`/api/v1/compose/providers/${encodeURIComponent(provider)}/server-options?${new URLSearchParams({ ...selection, vpnType, field, q: query, limit: "50" })}`, { signal: signal ?? null }),
  refreshServerOptions: (provider: string) => request<{ refreshed: { sourceRevision: string; updatedAt: string | null } }>(
    `/api/v1/compose/providers/${encodeURIComponent(provider)}/server-options/refresh`,
    { method: "POST", body: "{}" }
  ),
  activity: () => request<{ events: any[] }>("/api/v1/activity"),
  diagnostics: () => request<any>("/api/v1/admin/diagnostics"),
  dockerObservation: (options: { tail?: number; since?: number; until?: number; includeLogs?: boolean; force?: boolean } = {}, signal?: AbortSignal) => request<{ observation: import("./models.js").DockerDiagnostic }>(`/api/v1/admin/docker-observation?${new URLSearchParams(Object.fromEntries(Object.entries(options).map(([key,value]) => [key,String(value)])))}`, { signal: signal ?? null }),
  traffic: (signal?: AbortSignal) => request<{ traffic: TrafficSummary; privacy: string }>("/api/v1/admin/traffic", { signal: signal ?? null }),
  logs: () => request<{ logs: any[] }>("/api/v1/admin/logs"),
  debugDetails: () => request<any>("/api/v1/admin/debug-details"),
  drafts: (offset = 0, signal?: AbortSignal) => request<{ drafts: import("./models.js").ComposeDraftSummary[]; hasMore: boolean }>(`/api/v1/compose/drafts?summary=true&offset=${offset}`, { signal: signal ?? null }),
  draft: (id: string, signal?: AbortSignal) => request<{ draft: import("./models.js").ComposeDraft }>(`/api/v1/compose/drafts/${encodeURIComponent(id)}`, { signal: signal ?? null }),
  deleteDraft: (id: string) => request<{ deleted: boolean }>(`/api/v1/compose/drafts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  clearDrafts: () => request<{ deleted: number }>("/api/v1/compose/drafts", { method: "DELETE" })
};
