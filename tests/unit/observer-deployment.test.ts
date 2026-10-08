import fs from "node:fs";
import { expect, it } from "vitest";
import YAML from "yaml";
import { generateCompose } from "../../src/server/compose/generator.js";

const primary = YAML.parse(fs.readFileSync("docker-compose.yml", "utf8"));

it("isolates the read-only Docker observer while keeping Tuniku independent of VPN health", () => {
  const app = primary.services.tuniku;
  const observer = primary.services["tuniku-docker-observer"];
  expect(app.network_mode).toBeUndefined();
  expect(app.depends_on).toBeUndefined();
  expect(app.volumes.some((mount: { source: string }) => mount.source.endsWith("docker.sock"))).toBe(false);
  expect(observer.ports).toBeUndefined();
  expect(observer.networks.length).toBeGreaterThan(0);
  for (const network of observer.networks) {
    expect(primary.networks[network].internal).toBe(true);
    expect(app.networks).toContain(network);
  }
  expect(app.networks.some((network: string) => !primary.networks[network].internal)).toBe(true);
  const proxy = new URL(app.environment.TUNIKU_DOCKER_PROXY_URL);
  expect(proxy.hostname).toBe("tuniku-docker-observer");
  expect(Number(proxy.port)).toBe(Number(observer.environment.TUNIKU_OBSERVER_PORT));
  expect(observer.image).toBe(app.image);
  expect(observer.volumes.filter((mount: { target: string }) => mount.target.endsWith("docker.sock"))).toEqual([
    expect.objectContaining({ read_only: true, target: "/var/run/docker.sock" })
  ]);
  expect(observer.read_only).toBe(true);
  expect(observer.cap_drop).toContain("ALL");
  expect(observer.security_opt).toContain("no-new-privileges:true");
  expect(observer.command).toEqual(["dist/server/docker/observerProxy.js"]);
  for (const service of [app, observer]) {
    expect(service.healthcheck.test.slice(0, 2)).toEqual(["CMD", "/nodejs/bin/node"]);
    expect(service.healthcheck.test).not.toContain("CMD-SHELL");
  }
});

it("connects generated VPN add-ons to the application network without granting observer-network access", () => {
  const result = generateCompose({ taskType: "new_gluetun_setup", provider: "mullvad", vpnType: "wireguard", wireguardPrivateKey: Buffer.alloc(32, 1).toString("base64"), wireguardAddresses: "10.0.0.2/32", authMode: "api_key", apiKey: "synthetic-observer-regression-key", includeSecrets: true });
  expect(result.validation.valid).toBe(true);
  const addon = YAML.parse(result.snippets.compose);
  expect(Object.keys(addon.services)).toEqual(["gluetun"]);
  for (const network of addon.services.gluetun.networks) {
    expect(addon.networks[network].external).toBe(true);
    expect(primary.networks[network].internal).not.toBe(true);
    expect(addon.networks[network].name).toBe(primary.networks[network].name);
    expect(primary.services.tuniku.networks).toContain(network);
    expect(primary.services["tuniku-docker-observer"].networks).not.toContain(network);
  }
});
