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
  return containers.find((container: any) => {
    const names = Array.isArray(container?.Names) ? container.Names.join(" ") : "";
    return /gluetun/i.test(`${names} ${container?.Image || ""}`);
  }) ?? null;
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
    if (url.pathname === "/containers/json" && url.searchParams.get("all") === "1") {
      const container = await gluetunContainer();
      return sendJson(response, 200, container ? [{
        Id: container.Id,
        Names: container.Names,
        Image: container.Image,
        State: container.State
      }] : []);
    }
    const inspectMatch = url.pathname.match(/^\/containers\/([a-f0-9]{12,64})\/json$/i);
    const logsMatch = url.pathname.match(/^\/containers\/([a-f0-9]{12,64})\/logs$/i);
    if (!inspectMatch && !logsMatch) return sendJson(response, 404, { error: "route_not_allowed" });
    const container = await gluetunContainer();
    const requestedId = (inspectMatch ?? logsMatch)?.[1] ?? "";
    if (!container?.Id || !String(container.Id).startsWith(requestedId)) return sendJson(response, 404, { error: "gluetun_not_found" });
    if (logsMatch) {
      const logs = await dockerRequest(`/containers/${encodeURIComponent(container.Id)}/logs?stdout=1&stderr=1&tail=200&timestamps=1`);
      response.writeHead(logs.status, { "content-type": logs.headers["content-type"] || "application/octet-stream", "content-length": logs.body.length });
      response.end(logs.body);
      return;
    }
    const inspectedResponse = await dockerRequest(`/containers/${encodeURIComponent(container.Id)}/json`);
    if (inspectedResponse.status !== 200) return sendJson(response, inspectedResponse.status, { error: "inspect_failed" });
    const inspected = JSON.parse(inspectedResponse.body.toString("utf8"));
    const safeEnvironment = Array.isArray(inspected?.Config?.Env) ? inspected.Config.Env.map((entry: string) => {
      const separator = entry.indexOf("=");
      const name = separator === -1 ? entry : entry.slice(0, separator);
      if (["VPN_SERVICE_PROVIDER", "VPN_TYPE"].includes(name)) return entry;
      return `${name}=`;
    }) : [];
    return sendJson(response, 200, {
      Id: inspected?.Id,
      Name: inspected?.Name,
      Config: { Image: inspected?.Config?.Image, Env: safeEnvironment },
      State: inspected?.State,
      RestartCount: inspected?.RestartCount,
      NetworkSettings: { Ports: inspected?.NetworkSettings?.Ports, Networks: inspected?.NetworkSettings?.Networks }
    });
  } catch (error) {
    return sendJson(response, 502, { error: error instanceof Error ? error.message : "docker_observation_failed" });
  }
});

server.listen(port, "0.0.0.0");

const shutdown = (): void => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
