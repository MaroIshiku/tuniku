import type { Bootstrap, ComposeResult, Instance, Overview, PortLabel, User } from "./models.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
  }
}

let csrfToken = "";

export function setCsrfToken(token: string | null): void {
  csrfToken = token || "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (csrfToken && init.method && !["GET", "HEAD"].includes(init.method)) headers.set("x-csrf-token", csrfToken);
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message || `Request failed with HTTP ${response.status}.`, error.code || "request_failed", response.status, error.details);
  }
  return payload as T;
}

const json = (value: unknown): string => JSON.stringify(value);

export const api = {
  bootstrap: () => request<Bootstrap>("/api/v1/bootstrap"),
  register: (body: unknown) => request<{ user: User; csrfToken: string }>(
    "/api/v1/auth/register-first-admin",
    { method: "POST", body: json(body) }
  ),
  login: (body: unknown) => request<{ user: User; csrfToken: string }>("/api/v1/auth/login", { method: "POST", body: json(body) }),
  logout: () => request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST", body: "{}" }),
  instances: () => request<{ instances: Instance[] }>("/api/v1/instances"),
  saveInstance: (id: string, body: unknown) => request<{ instance: Instance }>(`/api/v1/instances/${id}`, { method: "PUT", body: json(body) }),
  testInstance: (id: string, body: unknown = {}) => request<any>(`/api/v1/instances/${id}/test`, { method: "POST", body: json(body) }),
  deleteCredential: (id: string) => request<{ ok: boolean }>(`/api/v1/instances/${id}/stored-credential`, { method: "DELETE" }),
  overview: (id: string) => request<{ overview: Overview }>(`/api/v1/instances/${id}/overview`),
  control: (id: string, action: string, body: unknown = { confirmed: true }) =>
    request<any>(`/api/v1/instances/${id}/${action}`, { method: "POST", body: json(body) }),
  setForwardedPorts: (id: string, ports: number[]) =>
    request<any>(`/api/v1/instances/${id}/port-forwarding`, { method: "PUT", body: json({ ports, confirmed: true }) }),
  ports: (id: string) => request<{ ports: PortLabel[] }>(`/api/v1/instances/${id}/ports`),
  createPort: (id: string, body: unknown) => request<{ port: PortLabel }>(`/api/v1/instances/${id}/port-labels`, { method: "POST", body: json(body) }),
  updatePort: (id: string, portId: string, body: unknown) => request<{ port: PortLabel }>(`/api/v1/instances/${id}/port-labels/${portId}`, { method: "PUT", body: json(body) }),
  deletePort: (id: string, portId: string) => request<{ ok: boolean }>(`/api/v1/instances/${id}/port-labels/${portId}`, { method: "DELETE" }),
  generate: (body: unknown) => request<{ result: ComposeResult }>("/api/v1/compose/generate", { method: "POST", body: json(body) }),
  activity: () => request<{ events: any[] }>("/api/v1/activity"),
  diagnostics: () => request<any>("/api/v1/admin/diagnostics"),
  dockerObservation: () => request<any>("/api/v1/admin/docker-observation"),
  logs: () => request<{ logs: any[] }>("/api/v1/admin/logs"),
  debugDetails: () => request<any>("/api/v1/admin/debug-details"),
  clearDrafts: () => request<{ deleted: number }>("/api/v1/compose/drafts", { method: "DELETE" })
};
