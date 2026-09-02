import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  detectPortCollisions,
  generateCompose,
  inspectCompose,
  manualRoutingFragment,
  validateCompose
} from "../../src/server/compose/generator.js";
import { gluetunProviderProfiles } from "../../src/server/compose/providers.js";
import { ServerCatalog } from "../../src/server/compose/serverCatalog.js";

describe("Compose Assistant", () => {
  it("exposes the provider and protocol catalog accepted by Gluetun latest", () => {
    expect(gluetunProviderProfiles).toHaveLength(23);
    expect(gluetunProviderProfiles.filter((provider) => provider.protocols.includes("wireguard")).map((provider) => provider.id)).toEqual([
      "airvpn", "fastestvpn", "ivpn", "mullvad", "nordvpn", "protonvpn", "surfshark", "windscribe", "custom"
    ]);
    expect(gluetunProviderProfiles.find((provider) => provider.id === "perfect privacy")).toBeUndefined();
    expect(gluetunProviderProfiles.find((provider) => provider.id === "mullvad")?.protocols).toEqual(["wireguard"]);
  });

  it("keeps every provider's server filters aligned with its official walkthrough", () => {
    const filters = Object.fromEntries(gluetunProviderProfiles.map((provider) => [provider.id, provider.serverFilters]));
    expect(filters).toEqual({
      airvpn: ["countries", "regions", "cities", "names", "hostnames"],
      cyberghost: ["countries", "hostnames"],
      expressvpn: ["countries", "cities", "hostnames"],
      fastestvpn: ["countries", "cities", "hostnames"],
      giganews: ["regions", "hostnames"],
      hidemyass: ["countries", "regions", "cities", "hostnames"],
      ipvanish: ["countries", "cities", "hostnames"],
      ivpn: ["countries", "cities", "hostnames", "isps"],
      mullvad: ["countries", "cities", "hostnames", "isps"],
      nordvpn: ["countries", "regions", "cities", "hostnames", "categories"],
      privado: ["countries", "regions", "cities", "hostnames"],
      "private internet access": ["regions", "names", "hostnames"],
      privatevpn: ["countries", "cities", "hostnames"],
      protonvpn: ["countries", "regions", "cities", "hostnames"],
      purevpn: ["countries", "regions", "cities", "hostnames"],
      slickvpn: ["countries", "regions", "cities", "hostnames"],
      surfshark: ["countries", "regions", "cities", "hostnames"],
      torguard: ["countries", "cities", "hostnames"],
      vpnsecure: ["regions", "cities", "hostnames"],
      "vpn unlimited": ["countries", "regions", "cities", "hostnames"],
      vyprvpn: ["regions", "hostnames"],
      windscribe: ["regions", "cities", "hostnames"],
      custom: []
    });
  });

  it("generates a deployable Gluetun-only add-on for the running Tuniku stack", () => {
    const result = generateCompose({
      taskType: "new_gluetun_setup",
      provider: "protonvpn",
      vpnType: "wireguard",
      wireguardPrivateKey: "do-not-persist",
      authMode: "api_key",
      apiKey: "control-api-key",
      includeSecrets: false
    });
    expect(validateCompose(result.snippets.compose).valid).toBe(true);
    const compose = YAML.parse(result.snippets.compose);
    expect(compose.services.gluetun.image).toBe("qmcgaw/gluetun:latest");
    expect(compose.services.gluetun.pull_policy).toBe("always");
    expect(compose.name).toBe("tuniku-gluetun");
    expect(Object.keys(compose.services)).toEqual(["gluetun"]);
    expect(compose.services.tuniku).toBeUndefined();
    expect(compose.networks.tuniku).toEqual({ external: true, name: "tuniku" });
    expect(compose.services.gluetun.networks).toEqual(["tuniku"]);
    expect(compose.services.gluetun.labels).toEqual({ "com.ishiku.tuniku.role": "gluetun" });
    expect(compose.services.gluetun.devices).toEqual(["/dev/net/tun:/dev/net/tun"]);
    expect(compose.services.gluetun.volumes).toEqual(["gluetun_data:/gluetun"]);
    expect(compose.services.gluetun.environment).toMatchObject({
      VPN_SERVICE_PROVIDER: "protonvpn",
      VPN_TYPE: "wireguard",
      WIREGUARD_PRIVATE_KEY: "[REDACTED]",
      HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE: "[REDACTED]"
    });
    expect(compose.services.gluetun.environment.OPENVPN_CUSTOM_CONFIG).toBeUndefined();
    expect(compose.services.gluetun.volumes).not.toContain("/DATA/AppData/i_tuniku/custom.conf:/gluetun/custom.conf:ro");
    expect(result.snippets.compose).not.toContain("${");
    expect(compose.volumes).toEqual({ gluetun_data: {} });
    expect(compose.secrets).toBeUndefined();
    expect(result.snippets.secrets).toContain("only ISHIKU_SETUP_SECRET");
    expect(result.snippets.env).toContain("WIREGUARD_PRIVATE_KEY=[REDACTED]");
    expect(result.detectedConfiguration).toBeDefined();
    expect(result.recommendedChange).toBeTruthy();
    expect(result.manualSteps).toHaveLength(7);
    expect(result.manualSteps.join(" ")).toContain("Keep the current Tuniku stack running");
    expect(result.securityWarnings.length).toBeGreaterThan(0);
    expect(result.artifacts.some((artifact) => artifact.filename === "gluetun.optional.env")).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.filename === "docker-compose.gluetun-addon.yml")).toBe(true);
    expect(result.redacted).toBe(true);
  });

  it("includes direct secret values only after explicit opt-in", () => {
    const result = generateCompose({
      taskType: "new_gluetun_setup",
      provider: "protonvpn",
      vpnType: "wireguard",
      wireguardPrivateKey: "private-key",
      authMode: "api_key",
      apiKey: "control-key",
      includeSecrets: true
    });
    const compose = YAML.parse(result.snippets.compose);
    expect(compose.services.gluetun.environment.WIREGUARD_PRIVATE_KEY).toBe("private-key");
    expect(compose.services.gluetun.environment.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE).toContain("control-key");
    expect(result.redacted).toBe(false);
    expect(result.snippets.compose).not.toContain("${");
  });

  it("rejects unsupported protocols and missing provider-specific data", () => {
    expect(() => generateCompose({ taskType: "configure_wireguard", provider: "expressvpn", vpnType: "wireguard" })).toThrow(/does not support/);
    expect(() => generateCompose({ taskType: "configure_wireguard", provider: "airvpn", vpnType: "wireguard", wireguardPrivateKey: "key", wireguardAddresses: "10.0.0.2/32" })).toThrow(/preshared key/);
    expect(() => generateCompose({ taskType: "configure_openvpn", provider: "custom", vpnType: "openvpn", customOpenvpnConfigPath: "relative.conf" })).toThrow(/absolute Linux host path/);
  });

  it("uses only PIA filters and current values documented by Gluetun", () => {
    const catalog = new ServerCatalog("/tmp/tuniku-catalog-test");
    expect(() => generateCompose({
      taskType: "new_gluetun_setup", provider: "private internet access", vpnType: "openvpn",
      openvpnUser: "user", openvpnPassword: "password", countries: "SE", cities: "Stockholm", authMode: "none"
    }, catalog)).toThrow(/does not support the countries/);
    const result = generateCompose({
      taskType: "new_gluetun_setup", provider: "private internet access", vpnType: "openvpn",
      openvpnUser: "user", openvpnPassword: "password", regions: "SE Stockholm", authMode: "none"
    }, catalog);
    const compose = YAML.parse(result.snippets.compose);
    expect(compose.services.gluetun.environment).toMatchObject({ SERVER_REGIONS: "SE Stockholm" });
    expect(compose.services.gluetun.environment.SERVER_COUNTRIES).toBeUndefined();
    expect(compose.services.gluetun.environment.SERVER_CITIES).toBeUndefined();
    expect(compose.services.gluetun.network_mode).toBeUndefined();
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
