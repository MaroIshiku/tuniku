import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  detectPortCollisions,
  generateCompose,
  inspectCompose,
  manualRoutingFragment,
  validateCompose
} from "../../src/server/compose/generator.js";

describe("Compose Assistant", () => {
  it("generates parseable Compose YAML with five output sections", () => {
    const result = generateCompose({
      taskType: "new_gluetun_setup",
      provider: "protonvpn",
      vpnType: "wireguard",
      wireguardPrivateKey: "do-not-persist",
      includeSecrets: false
    });
    expect(validateCompose(result.snippets.compose).valid).toBe(true);
    const compose = YAML.parse(result.snippets.compose);
    expect(compose.services.gluetun.image).toMatch(/^ghcr\.io\/qdm12\/gluetun:v3\.41\.3@sha256:/);
    expect(compose.services.tuniku.environment).toEqual({
      TUNIKU_DATA_PATH: "/data",
      ISHIKU_SETUP_SECRET: "replace-with-at-least-32-random-characters"
    });
    expect(compose.services.tuniku.secrets).toBeUndefined();
    expect(compose.secrets).toBeUndefined();
    expect(result.snippets.secrets).toContain("only ISHIKU_SETUP_SECRET");
    expect(result.snippets.env).toContain("WIREGUARD_PRIVATE_KEY=[REDACTED]");
    expect(result.detectedConfiguration).toBeDefined();
    expect(result.recommendedChange).toBeTruthy();
    expect(result.manualSteps).toHaveLength(6);
    expect(result.securityWarnings.length).toBeGreaterThan(0);
  });

  it("generates the manual network namespace and Gluetun port mapping", () => {
    const fragment = manualRoutingFragment("example", "example/app:version", 8080, 8080);
    const parsed = YAML.parse(fragment);
    expect(parsed.services.example.network_mode).toBe("service:gluetun");
    expect(parsed.services.gluetun.ports).toEqual(["8080:8080/tcp"]);
  });

  it("detects duplicate ports and redacts inspected secrets", () => {
    expect(detectPortCollisions([8080, 9000], [8080, 8081])).toEqual([8080]);
    const inspected = inspectCompose("services:\n  gluetun:\n    environment:\n      OPENVPN_PASSWORD: private\n");
    expect(inspected.valid).toBe(true);
    expect(inspected.redacted).not.toContain("private");
  });
});
