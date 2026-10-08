import { expect, it } from "vitest";
import YAML from "yaml";
import { initialComposeForm, chooseAnyLocation, restoreComposeDraft, updateServerFilter } from "../../src/client/lib/composeDraft.js";
import { generateCompose, redactedDraftInput } from "../../src/server/compose/generator.js";
import { gluetunProviderProfiles } from "../../src/server/compose/providers.js";

it("explicitly clears only location filters and persists the choice in redacted drafts without losing orthogonal preferences", () => {
  const original = { ...initialComposeForm, taskType: "set_server_selection", provider: "nordvpn", countries: "Netherlands", regions: "old-region", cities: "old-city", serverNames: "old-name", hostnames: "old-host", categories: "P2P", isps: "retained-isp", apiKey: "synthetic-control", wireguardPrivateKey: "synthetic-vpn", providerOptions: { OPENVPN_PROTOCOL: "udp" } };
  const next = chooseAnyLocation(original);
  expect(next).toMatchObject({ anyLocation: true, countries: "", regions: "", cities: "", serverNames: "", hostnames: "", categories: "P2P", isps: "retained-isp", apiKey: "synthetic-control", wireguardPrivateKey: "synthetic-vpn", providerOptions: { OPENVPN_PROTOCOL: "udp" } });
  expect(original.countries).toBe("Netherlands");
  const safe = redactedDraftInput({ taskType: "set_server_selection", provider: "nordvpn", vpnType: "openvpn", anyLocation: next.anyLocation, countries: next.countries, categories: next.categories, apiKey: next.apiKey, providerOptions: next.providerOptions });
  expect(safe.anyLocation).toBe(true); expect(JSON.stringify(safe)).not.toContain("synthetic-control");
  expect(restoreComposeDraft(safe, gluetunProviderProfiles).anyLocation).toBe(true);
  expect(restoreComposeDraft({ taskType: "set_server_selection", provider: "nordvpn" }, gluetunProviderProfiles).anyLocation).toBe(false);
  expect(() => restoreComposeDraft({ taskType: "set_server_selection", anyLocation: true, countries: "Netherlands" }, [])).toThrow(/combines any location/);
  expect(updateServerFilter(next, "categories", "Standard").form.anyLocation).toBe(true);
  expect(updateServerFilter(next, "countries", "Sweden").form.anyLocation).toBe(false);
});

it("emits explicit supported empty overrides, preserves category/ISP constraints and requires merged/legacy configuration review", () => {
  const nord = generateCompose({ taskType: "set_server_selection", provider: "nordvpn", vpnType: "openvpn", anyLocation: true, categories: "P2P", providerOptions: { OPENVPN_PROTOCOL: "tcp" } });
  const env = YAML.parse(nord.snippets.compose).services.gluetun.environment;
  expect(env).toMatchObject({ SERVER_COUNTRIES: "", SERVER_REGIONS: "", SERVER_CITIES: "", SERVER_HOSTNAMES: "", SERVER_CATEGORIES: "P2P", OPENVPN_PROTOCOL: "tcp" });
  expect(env).not.toHaveProperty("SERVER_NAMES");
  expect(nord.snippets.env).toContain('SERVER_COUNTRIES=');
  expect(nord.manualSteps.join("\n")).toContain("A fragment alone does not delete them");
  expect(nord.manualSteps.join("\n")).toContain("SERVER_NUMBER");
  const mullvad = generateCompose({ taskType: "set_server_selection", provider: "mullvad", vpnType: "wireguard", anyLocation: true, isps: "retained-isp" });
  expect(YAML.parse(mullvad.snippets.compose).services.gluetun.environment).toMatchObject({ SERVER_COUNTRIES: "", SERVER_CITIES: "", SERVER_HOSTNAMES: "", ISP: "retained-isp" });
  expect(() => generateCompose({ taskType: "set_server_selection", provider: "nordvpn", vpnType: "openvpn", anyLocation: true, hostnames: "specific-host" })).toThrow(/cannot be combined/);
  expect(() => generateCompose({ taskType: "set_server_selection", provider: "custom", vpnType: "wireguard", anyLocation: true })).toThrow(/custom VPN endpoint/);
});
