import { expect, it } from "vitest";
import { initialComposeForm, restoreComposeDraft, updateServerFilter } from "../../src/client/lib/composeDraft.js";
import type { GluetunProviderProfile } from "../../src/client/lib/models.js";
const providers = [{ id: "synthetic", options: [{ env: "OPENVPN_PROTOCOL" }] }] as GluetunProviderProfile[];
it("clears narrower geographical and hostname selections while preserving orthogonal preferences, credentials and unchanged values", () => {
  const form = { ...initialComposeForm, countries: "UK", regions: "old-region", cities: "London", serverNames: "old-server", hostnames: "old-host", categories: "P2P", isps: "retained-isp", apiKey: "synthetic-control", wireguardPrivateKey: "synthetic-vpn" };
  expect(updateServerFilter(form, "countries", "UK")).toEqual({ form, cleared: [] });
  const changed = updateServerFilter(form, "countries", "Sweden");
  expect(changed.cleared).toEqual(["regions", "cities", "serverNames", "hostnames"]);
  expect(changed.form).toMatchObject({ countries: "Sweden", regions: "", cities: "", serverNames: "", hostnames: "", categories: "P2P", isps: "retained-isp", apiKey: "synthetic-control", wireguardPrivateKey: "synthetic-vpn" });
  expect(form.cities).toBe("London");
  expect(updateServerFilter(form, "cities", "Stockholm").form).toMatchObject({ countries: "UK", regions: "old-region", cities: "Stockholm", serverNames: "", hostnames: "" });
  expect(updateServerFilter(form, "isps", "changed").cleared).toEqual([]);
});
it("restores safe scalar settings and numeric legacy ports while clearing credentials, source and opt-in", () => {
  const restored = restoreComposeDraft({ taskType: "new_gluetun_setup", provider: "synthetic", vpnType: "openvpn", countries: "Germany", useEnvFile: true, hostPort: 5800, containerPort: "5800", wireguardEndpointPort: 443, apiKey: "synthetic-secret", basicUsername: "synthetic-user", wireguardPrivateKey: "synthetic-private", openvpnCertificate: "synthetic-certificate", pastedCompose: "private source", includeSecrets: true, providerOptions: { OPENVPN_PROTOCOL: "udp", PASSWORD: "synthetic-password", UNKNOWN_OPTION: "unapproved" } }, providers);
  expect(restored).toMatchObject({ countries: "Germany", hostPort: "5800", containerPort: "5800", wireguardEndpointPort: "443", useEnvFile: true, includeSecrets: false, apiKey: "", basicUsername: "", wireguardPrivateKey: "", openvpnCertificate: "", pastedCompose: "", providerOptions: { OPENVPN_PROTOCOL: "udp" } });
  expect(JSON.stringify(restored)).not.toContain("synthetic-secret");
});
it("rejects unreadable tasks and enums, removes placeholders and ignores unknown/prototype fields", () => {
  for (const input of [null, [], {}, { taskType: "unknown" }, { taskType: "new_gluetun_setup", vpnType: "unknown" }, { taskType: "publish_app_port", protocol: "sctp" }, { taskType: "publish_app_port", hostPort: "not-a-port" }]) expect(() => restoreComposeDraft(input, [])).toThrow();
  const input = JSON.parse('{"taskType":"configure_provider","countries":"[REDACTED]","__proto__":{"polluted":true},"providerOptions":{"OPENVPN_PROTOCOL":"[REDACTED]"},"provider":"synthetic"}');
  const restored = restoreComposeDraft(input, providers);
  expect(restored.countries).toBe(""); expect(restored.providerOptions).toEqual({}); expect(Object.hasOwn(restored, "__proto__")).toBe(false);
  expect(initialComposeForm.providerOptions).toEqual({});
});

it("clears every sensitive field and raw source without mutating non-secret settings or the original form", async () => {
  const { clearComposeSensitive } = await import("../../src/client/lib/composeDraft.js");
  const form = { ...initialComposeForm, provider: "custom", wireguardPublicKey: "public-key", providerOptions: { VPN_PORT: "51820" }, pastedCompose: "synthetic-source-secret", includeSecrets: true };
  for (const key of ["apiKey", "basicUsername", "basicPassword", "wireguardPrivateKey", "wireguardPresharedKey", "openvpnUser", "openvpnPassword", "openvpnCertificate", "openvpnKey", "openvpnEncryptedKey", "openvpnKeyPassphrase"]) Object.assign(form, { [key]: "synthetic-sensitive-value" });
  const cleared = clearComposeSensitive(form);
  expect(JSON.stringify(cleared)).not.toContain("synthetic-sensitive-value"); expect(cleared.pastedCompose).toBe(""); expect(cleared.includeSecrets).toBe(false);
  expect(cleared.provider).toBe("custom"); expect(cleared.wireguardPublicKey).toBe("public-key"); expect(cleared.providerOptions).toEqual({ VPN_PORT: "51820" });
  expect(form.apiKey).toBe("synthetic-sensitive-value"); expect(form.includeSecrets).toBe(true);
});
