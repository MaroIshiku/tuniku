import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { buildApp } from "../src/server/app.js";
import { config } from "../src/server/config.js";

const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-e2e-"));
const mock = Fastify({ logger: false });
let vpnStatus = "stopped";
let dnsStatus = "running";

mock.get("/v1/vpn/status", async () => ({ status: vpnStatus }));
mock.put("/v1/vpn/status", async (request) => {
  vpnStatus = (request.body as { status: string }).status;
  return { outcome: vpnStatus };
});
mock.get("/v1/vpn/settings", async () => ({
  provider: "mockvpn",
  vpn_type: "wireguard",
  server_country: "Example",
  WIREGUARD_PRIVATE_KEY: "must-never-reach-the-browser"
}));
mock.get("/v1/publicip/ip", async () => ({
  public_ip: "203.0.113.42",
  country: "Germany",
  region: "Berlin",
  city: "Berlin"
}));
mock.get("/v1/dns/status", async () => ({ status: dnsStatus }));
mock.put("/v1/dns/status", async (request) => {
  dnsStatus = (request.body as { status: string }).status;
  return { status: dnsStatus };
});
mock.get("/v1/updater/status", async () => ({ status: "completed" }));
mock.put("/v1/updater/status", async () => ({ status: "running" }));
mock.get("/v1/portforward", async () => ({ ports: [51413] }));
mock.put("/v1/portforward", async (request) => request.body);

await mock.listen({ host: "127.0.0.1", port: 8199 });

const app = await buildApp({
  ...config,
  host: "127.0.0.1",
  port: 4173,
  dataPath,
  databasePath: path.join(dataPath, "tuniku.db"),
  registrationSecret: "tuniku-e2e-setup-secret",
  sessionSecret: "tuniku-e2e-session-secret-that-is-long",
  encryptionKey: "3".repeat(64),
  allowLoopbackUpstream: true
});
await app.listen({ host: "127.0.0.1", port: 4173 });

const shutdown = async () => {
  await Promise.all([app.close(), mock.close()]);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
