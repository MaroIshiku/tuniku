import { gluetunStorage } from "./storage.js";
import { logQuery } from "./logOptions.js";
import { aggregateNetworkCounters } from "./trafficCounters.js";
import http from "node:http";

const socketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const port = Number.parseInt(process.env.TUNIKU_OBSERVER_PORT || "2375", 10);
const maxBytes = 512 * 1024;

function dockerRequest(path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path, method: "GET", headers: { accept: "application/json" } }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error("Docker response exceeds the observer safety limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode || 502, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.setTimeout(5_000, () => request.destroy(new Error("Docker observation timed out.")));
    request.on("error", reject);
    request.end();
  });
}

async function gluetunContainer(): Promise<any | null> {
  const response = await dockerRequest("/containers/json?all=1");
  if (response.status !== 200) throw new Error(`Docker returned HTTP ${response.status}.`);
  const containers = JSON.parse(response.body.toString("utf8"));
  if (!Array.isArray(containers)) throw new Error("Docker returned an invalid container list.");
  const scored = containers.filter((container: any) => !(["exited", "created"].includes(String(container.State)) && (container.Names ?? []).some((name: string) => /-tuniku-backup-[a-f0-9]{8}$/.test(name)))).map((container: any) => {
    const names = Array.isArray(container?.Names) ? container.Names.map((name: unknown) => String(name).replace(/^\//, "")) : [];
    const labels = container?.Labels && typeof container.Labels === "object" ? container.Labels : {};
    const image = String(container?.Image || "");
    let score = 0;
    if (labels["com.ishiku.tuniku.role"] === "gluetun") score += 1_000;
    if (labels["com.docker.compose.service"] === "gluetun") score += 500;
    if (names.includes("gluetun")) score += 300;
    if (/(?:^|\/)gluetun(?:[:@]|$)/i.test(image)) score += 200;
    if (score > 0 && String(container?.State || "").toLowerCase() === "running") score += 20;
    return { container, score };
  }).filter(({ score }: { score: number }) => score > 0);
  const explicit = scored.filter(({ container }: { container: any }) => container.Labels?.["com.ishiku.tuniku.role"] === "gluetun");
  const candidates = explicit.length ? explicit : scored;
  if (candidates.length > 1) throw Object.assign(new Error("Ambiguous Gluetun association."), { code: "GLUETUN_AMBIGUOUS" });
  return candidates[0]?.container ?? null;
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json", "content-length": body.length });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://observer.local");
    if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
    if (url.pathname === "/health") return sendJson(response, 200, { status: "ok" });
    if (url.pathname === "/readyz") {
      const ping = await dockerRequest("/_ping");
      if (ping.status !== 200 || ping.body.toString().trim() !== "OK") return sendJson(response, 503, { error: "docker_unavailable" });
      return sendJson(response, 200, { status: "ready" });
    }
    if (url.pathname === "/containers/json" && url.searchParams.get("all") === "1") {
      const container = await gluetunContainer();
      return sendJson(response, 200, container ? [{
        Id: container.Id,
        Names: container.Names,
        Image: container.Image,
        Labels: { "com.ishiku.tuniku.role": "gluetun" },
        State: container.State
      }] : []);
    }
    if (url.pathname === "/gluetun/traffic") {
      const container = await gluetunContainer();
      if (!container?.Id) return sendJson(response, 404, { error: "gluetun_not_found" });
      if (String(container.State || "").toLowerCase() !== "running") {
        return sendJson(response, 409, { error: "gluetun_not_running" });
      }
      let statsResponse = await dockerRequest(`/containers/${encodeURIComponent(container.Id)}/stats?stream=false&one-shot=true`);
      if (statsResponse.status === 400) {
        statsResponse = await dockerRequest(`/containers/${encodeURIComponent(container.Id)}/stats?stream=false`);
      }
      if (statsResponse.status !== 200) return sendJson(response, statsResponse.status, { error: "stats_failed" });
      const stats = JSON.parse(statsResponse.body.toString("utf8"));
      let counters: { receivedBytes: number; sentBytes: number };
      try { counters = aggregateNetworkCounters(stats); }
      catch { return sendJson(response, 422, { error: "network_counters_unavailable" }); }
      return sendJson(response, 200, {
        containerId: String(container.Id),
        ...counters,
        observedAt: new Date().toISOString()
      });
    }
    const inspectMatch = url.pathname.match(/^\/containers\/([a-f0-9]{12,64})\/json$/i);
    const logsMatch = url.pathname.match(/^\/containers\/([a-f0-9]{12,64})\/logs$/i);
    if (!inspectMatch && !logsMatch) return sendJson(response, 404, { error: "route_not_allowed" });
    const container = await gluetunContainer();
    const requestedId = (inspectMatch ?? logsMatch)?.[1] ?? "";
    if (!container?.Id || !String(container.Id).startsWith(requestedId)) return sendJson(response, 404, { error: "gluetun_not_found" });
    if (logsMatch) {
      let query: string;
      try { query = logQuery(Object.fromEntries(["tail", "since", "until"].filter((key) => url.searchParams.has(key)).map((key) => [key, Number(url.searchParams.get(key))]))); }
      catch { return sendJson(response, 400, { error: "invalid_log_query" }); }
      const logs = await dockerRequest(`/containers/${encodeURIComponent(container.Id)}/logs?${query}`);
      response.writeHead(logs.status, { "content-type": logs.headers["content-type"] || "application/octet-stream", "content-length": logs.body.length });
      response.end(logs.body);
      return;
    }
    const inspectedResponse = await dockerRequest(`/containers/${encodeURIComponent(container.Id)}/json`);
    if (inspectedResponse.status !== 200) return sendJson(response, inspectedResponse.status, { error: "inspect_failed" });
    const inspected = JSON.parse(inspectedResponse.body.toString("utf8"));
    const safeEnvironment = Array.isArray(inspected?.Config?.Env) ? inspected.Config.Env.flatMap((entry: string) => {
      const separator = entry.indexOf("=");
      const name = separator === -1 ? entry : entry.slice(0, separator);
      const value = separator === -1 ? "" : entry.slice(separator + 1);
      if (["VPN_SERVICE_PROVIDER", "VPN_TYPE"].includes(name)) return [entry];
      return value ? [`${name}=`] : [];
    }) : [];
    const controlAddress = (inspected?.Config?.Env ?? []).find((entry: string) => entry.startsWith("HTTP_CONTROL_SERVER_ADDRESS="))?.slice("HTTP_CONTROL_SERVER_ADDRESS=".length) ?? ":8000";
    const portMatch = String(controlAddress).match(/:(\d+)$/);
    const controlPort = portMatch ? Number(portMatch[1]) : null;
    return sendJson(response, 200, {
      Storage: gluetunStorage(inspected),
      ControlServer: { port: controlPort && controlPort <= 65535 ? controlPort : null },
      Id: inspected?.Id,
      Name: inspected?.Name,
      Config: { Image: inspected?.Config?.Image, Env: safeEnvironment, ExposedPorts: inspected?.Config?.ExposedPorts },
      HostConfig: { PortBindings: inspected?.HostConfig?.PortBindings },
      State: inspected?.State,
      RestartCount: inspected?.RestartCount,
      NetworkSettings: { Ports: inspected?.NetworkSettings?.Ports, Networks: inspected?.NetworkSettings?.Networks }
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const reason = code === "GLUETUN_AMBIGUOUS" ? "gluetun_ambiguous" : code === "ENOENT" ? "docker_socket_missing" : ["EACCES", "EPERM"].includes(code ?? "") ? "docker_socket_permission_denied" : "docker_unavailable";
    return sendJson(response, request.url === "/readyz" ? 503 : code === "GLUETUN_AMBIGUOUS" ? 409 : 502, { error: reason });
  }
});

server.listen(port, "0.0.0.0");

const shutdown = (): void => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
