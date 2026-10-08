import { expect, it } from "vitest";
import YAML from "yaml";
import { generateCompose, inspectCompose } from "../../src/server/compose/generator.js";

const base = YAML.stringify({ name: "existing-stack", services: { "VPN.Main": { image: "qmcgaw/gluetun:latest", container_name: "existing-container", volumes: ["existing-data:/gluetun"], networks: ["existing-net"], labels: { keep: "yes" }, ports: ["127.0.0.1:8080:8080/tcp"] }, "Downloader.Main": { image: "example/app:1", volumes: ["downloads:/downloads"] } }, volumes: { "existing-data": {}, downloads: {} }, networks: { "existing-net": {} } });

it("detects a renamed VPN service and preserves exact existing application names and fragment boundaries", () => {
  expect(inspectCompose(base).detected).toMatchObject({ hasGluetunService: true, gluetunServices: ["VPN.Main"] });
  const result = generateCompose({ taskType: "route_app_manually", pastedCompose: base, appName: "Downloader.Main", appImage: "example/app:1", hostAddress: "127.0.0.1", hostPort: 8080, containerPort: 8080 });
  expect(result.validation.valid).toBe(true);
  const proposal = YAML.parse(result.snippets.compose);
  expect(Object.keys(proposal.services)).toEqual(["VPN.Main", "Downloader.Main"]);
  expect(proposal.services["Downloader.Main"]).toMatchObject({ network_mode: "service:VPN.Main", depends_on: ["VPN.Main"] });
  expect(proposal.services["VPN.Main"].container_name).toBeUndefined(); expect(proposal.services["VPN.Main"].volumes).toBeUndefined(); expect(proposal.services["VPN.Main"].networks).toBeUndefined();
  expect(proposal.name).toBeUndefined(); expect(proposal.networks).toBeUndefined(); expect(proposal.volumes).toBeUndefined();
  const underscored = YAML.parse(base); underscored.services._vpn = underscored.services["VPN.Main"]; delete underscored.services["VPN.Main"];
  expect(Object.keys(YAML.parse(generateCompose({ taskType: "publish_app_port", pastedCompose: YAML.stringify(underscored), hostPort: 8080, containerPort: 8080, hostAddress: "127.0.0.1" }).snippets.compose).services)).toEqual(["_vpn"]);
});

it("requires an unambiguous existing VPN target and refuses absent targets and routing-name collisions", () => {
  const two = YAML.parse(base); two.services.other = { image: "qmcgaw/gluetun@sha256:" + "a".repeat(64) };
  const input = { taskType: "publish_app_port" as const, hostPort: 8090, containerPort: 80, pastedCompose: YAML.stringify(two) };
  expect(() => generateCompose(input)).toThrow(/Several Gluetun/);
  expect(Object.keys(YAML.parse(generateCompose({ ...input, gluetunServiceName: "other" }).snippets.compose).services)).toEqual(["other"]);
  expect(() => generateCompose({ ...input, gluetunServiceName: "missing" })).toThrow(/does not exist/);
  expect(() => generateCompose({ ...input, gluetunServiceName: "Downloader.Main" })).toThrow(/not identified as Gluetun/);
  expect(() => generateCompose({ taskType: "route_app_manually", gluetunServiceName: "vpn", appName: "vpn", hostPort: 8090, containerPort: 80 })).toThrow(/must be different/);
});

it("uses reviewed new-stack names consistently including an env package and rejects unsafe identifiers", () => {
  const input = { taskType: "new_gluetun_setup" as const, provider: "mullvad", vpnType: "wireguard" as const, wireguardPrivateKey: Buffer.alloc(32, 1).toString("base64"), wireguardAddresses: "10.0.0.2/32", authMode: "api_key" as const, apiKey: "synthetic-name-key", gluetunServiceName: "vpn-main", gluetunContainerName: "vpn-container", composeProjectName: "vpn-project", externalNetworkName: "existing-public-network", useEnvFile: true };
  const result = generateCompose(input); expect(result.validation.valid).toBe(true); const document = YAML.parse(result.snippets.compose);
  expect(document.name).toBe("vpn-project"); expect(document.services["vpn-main"].container_name).toBe("vpn-container"); expect(document.services["vpn-main"].env_file).toEqual(["./gluetun.optional.env"]); expect(document.networks.tuniku).toEqual({ external: true, name: "existing-public-network" });
  expect(result.snippets.steps).toContain("http://vpn-main:8000"); expect(result.snippets.steps).toContain("existing-public-network");
  for (const name of ["bad:name", "../escape", "user@host", "${INJECT}", "__proto__", "constructor", "a".repeat(129)]) expect(() => generateCompose({ ...input, gluetunServiceName: name })).toThrow();
  expect(() => generateCompose({ ...input, composeProjectName: "UpperCase" })).toThrow();
  expect(() => generateCompose({ ...input, gluetunServiceName: "Tuniku" })).toThrow(/helper services/);
  expect(() => generateCompose({ ...input, gluetunContainerName: "tuniku-docker-observer" })).toThrow(/helper containers/);
  expect(() => generateCompose({ ...input, composeProjectName: "tuniku" })).toThrow(/separate project/);
  expect(() => generateCompose({ ...input, externalNetworkName: "tuniku-observer" })).toThrow(/private Docker observer/);
});

it("keeps separate-project routing and VPN port changes in different fragments", () => {
  const input = { taskType: "route_app_manually" as const, routingScope: "separate_project" as const, gluetunContainerName: "existing-container", pastedCompose: base, appName: "Downloader.Main", appImage: "example/app:1", hostPort: 8099, containerPort: 80 };
  const result = generateCompose(input);
  expect(result.validation.valid).toBe(true);
  const app = YAML.parse(result.snippets.compose);
  expect(Object.keys(app.services)).toEqual(["Downloader.Main"]);
  expect(app.services["Downloader.Main"]).toMatchObject({ network_mode: "container:existing-container" });
  expect(app.services["Downloader.Main"].depends_on).toBeUndefined();
  const ports = YAML.parse(result.artifacts.find(artifact => artifact.filename === "docker-compose.vpn-ports.fragment.yml")!.content);
  expect(Object.keys(ports.services)).toEqual(["VPN.Main"]);
  expect(result.manualSteps.join(" ")).toContain("not performed");
  expect(() => generateCompose({ ...input, gluetunContainerName: "" })).toThrow(/exact existing/);
  expect(() => generateCompose({ ...input, gluetunContainerName: "bad:name" })).toThrow();
});
