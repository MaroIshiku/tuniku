import { expect, it } from "vitest";
import { exportManagedCompose } from "../../src/server/management/export.js";
import type { ManagedContainer } from "../../src/server/management/engine.js";
const vpn: ManagedContainer = { Id: "a".repeat(64), Name: "/my-vpn", Image: `sha256:${"c".repeat(64)}`, Config: { Labels: { "com.docker.compose.service": "vpn" }, Env: ["VPN_SERVICE_PROVIDER=private internet access", "VPN_TYPE=openvpn", "OPENVPN_PASSWORD=synthetic-keep-private", "SERVER_REGIONS=Sweden", "UNRECOGNIZED_CREDENTIAL=synthetic-other-private"] }, HostConfig: { PortBindings: { "5800/tcp": [{ HostIp: "127.0.0.1", HostPort: "5800" }, { HostIp: "192.0.2.1", HostPort: "5801" }] } }, State: { Running: true } };
it("preserves complete Compose storage/network/identity fields while exporting runtime changes without credentials", () => {
  const source = 'name: synthetic\nx-private: retained\nservices:\n  vpn:\n    image: qmcgaw/gluetun:latest\n    container_name: my-vpn\n    volumes: ["state:/gluetun"]\n    networks: [private]\n    labels: { owner: example }\n    command: [one]\n    environment: { SERVER_REGIONS: old }\nvolumes:\n  state: { external: true }\nnetworks:\n  private: { external: true }\n';
  const result = exportManagedCompose(source, [vpn]); const document = result.document as any;
  expect(document).toMatchObject({ name: "synthetic", "x-private": "retained", volumes: { state: { external: true } }, networks: { private: { external: true } }, services: { vpn: { container_name: "my-vpn", image: "qmcgaw/gluetun:latest", volumes: ["state:/gluetun"], networks: ["private"], labels: { owner: "example" }, command: ["one"], environment: { SERVER_REGIONS: "Sweden" } } } });
  expect(document.services.vpn.ports).toHaveLength(2); expect(JSON.stringify(result)).not.toMatch(/synthetic-keep-private|synthetic-other-private/); expect(result.requiredLocalVariables).toContain("TUNIKU_RUNTIME_0_OPENVPN_PASSWORD"); expect(result.deploymentReady).toBe(false);
  expect(result.changes.filter(change => ["volumes", "networks", "container_name"].includes(change.field))).toEqual([]);
});
it("refuses ambiguous or absent service mappings without inventing a new service", () => {
  expect(() => exportManagedCompose('services:\n  unknown:\n    image: qmcgaw/gluetun:latest\n', [vpn])).toThrow(/match one original service/);
});
