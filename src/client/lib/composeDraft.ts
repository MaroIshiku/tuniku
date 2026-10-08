import type { GluetunProviderProfile } from "./models.js";

export const initialComposeForm = {
  taskType: "new_gluetun_setup", provider: "", vpnType: "wireguard" as "wireguard" | "openvpn",
  gluetunServiceName: "", gluetunContainerName: "", composeProjectName: "", externalNetworkName: "",
  anyLocation: false, countries: "", regions: "", cities: "", hostnames: "", serverNames: "", categories: "", isps: "",
  providerOptions: {} as Record<string, string>, authMode: "api_key" as "none" | "api_key" | "basic",
  apiKey: "", basicUsername: "", basicPassword: "", wireguardPrivateKey: "", wireguardAddresses: "",
  wireguardPresharedKey: "", wireguardPublicKey: "", wireguardEndpointIp: "", wireguardEndpointPort: "51820",
  openvpnUser: "", openvpnPassword: "", openvpnCertificate: "", openvpnKey: "", openvpnEncryptedKey: "",
  openvpnKeyPassphrase: "", customOpenvpnConfigPath: "/DATA/AppData/i_tuniku/custom.conf",
  routingScope: "same_project", appName: "app", appImage: "example/app:version", hostAddress: "", hostPort: "8080", containerPort: "8080",
  protocol: "tcp", pastedCompose: "", includeSecrets: false, useEnvFile: false
};

const credentials = new Set(["apiKey", "basicUsername", "basicPassword", "wireguardPrivateKey", "wireguardPresharedKey", "openvpnUser", "openvpnPassword", "openvpnCertificate", "openvpnKey", "openvpnEncryptedKey", "openvpnKeyPassphrase"]);
const tasks = new Set(["new_gluetun_setup", "enable_control_server", "configure_control_auth", "configure_provider", "configure_wireguard", "configure_openvpn", "set_server_selection", "publish_app_port", "route_app_manually", "migrate_secrets", "review_existing_configuration"]);

export function restoreComposeDraft(input: unknown, providers: GluetunProviderProfile[]): typeof initialComposeForm {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("This draft has no supported settings. Keep the original record and start a new draft.");
  const values = input as Record<string, unknown>;
  if (typeof values.taskType !== "string" || !tasks.has(values.taskType)) throw new Error("This draft uses an unsupported task. Keep the original record and start a new draft.");
  const restored = { ...initialComposeForm, providerOptions: {} as Record<string, string> };
  for (const [key, fallback] of Object.entries(initialComposeForm)) {
    if (credentials.has(key) || ["pastedCompose", "includeSecrets", "providerOptions"].includes(key)) continue;
    const value = values[key];
    if (["hostPort", "containerPort", "wireguardEndpointPort"].includes(key)) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) Object.assign(restored, { [key]: String(value) });
      else if (typeof value === "string" && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535) Object.assign(restored, { [key]: value });
      else if (value !== undefined) throw new Error("This draft contains an unsupported port value. Keep the original record and start a new draft.");
    } else if (typeof fallback === "string" && typeof value === "string" && value.length <= 65536) Object.assign(restored, { [key]: value.includes("[REDACTED]") ? "" : value });
    else if (typeof fallback === "boolean" && typeof value === "boolean") Object.assign(restored, { [key]: value });
  }
  if (!["wireguard", "openvpn"].includes(restored.vpnType) || !["none", "api_key", "basic"].includes(restored.authMode) || !["tcp", "udp"].includes(restored.protocol)) throw new Error("This draft uses unsupported protocol or authentication settings. Keep the original record and start a new draft.");
  if (!["same_project", "separate_project"].includes(restored.routingScope)) throw new Error("This draft has unsupported project routing. Review its original settings before continuing.");
  const options = values.providerOptions;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    for (const option of providers.find((profile) => profile.id === restored.provider)?.options ?? []) {
      const value = (options as Record<string, unknown>)[option.env];
      if (typeof value === "string" && value.length <= 128 && !value.includes("[REDACTED]")) restored.providerOptions[option.env] = value;
    }
  }
  if (restored.anyLocation && locationFields.some(key => restored[key].trim())) throw new Error("This draft combines any location with specific location filters. Keep the original record and review the conflicting settings.");
  return restored;
}

export function clearComposeSensitive(form: typeof initialComposeForm): typeof initialComposeForm {
  const cleared = { ...form, includeSecrets: false, pastedCompose: "" };
  for (const key of credentials) Object.assign(cleared, { [key]: "" });
  return cleared;
}

export type ServerFilterInput = "countries" | "regions" | "cities" | "serverNames" | "hostnames" | "categories" | "isps";
const dependentServerFilters: Partial<Record<ServerFilterInput, ServerFilterInput[]>> = {
  countries: ["regions", "cities", "serverNames", "hostnames"],
  regions: ["cities", "serverNames", "hostnames"],
  cities: ["serverNames", "hostnames"],
  serverNames: ["hostnames"]
};

export function updateServerFilter(form: typeof initialComposeForm, key: ServerFilterInput, value: string): { form: typeof initialComposeForm; cleared: ServerFilterInput[] } {
  if (form[key] === value) return { form, cleared: [] };
  const next = { ...form, [key]: value, ...(locationFields.includes(key as typeof locationFields[number]) ? { anyLocation: false } : {}) };
  const cleared = (dependentServerFilters[key] ?? []).filter(field => Boolean(next[field]));
  for (const field of cleared) next[field] = "";
  return { form: next, cleared };
}

export const locationFields = ["countries", "regions", "cities", "serverNames", "hostnames"] as const;
export function chooseAnyLocation(form: typeof initialComposeForm): typeof initialComposeForm {
  const next = { ...form, anyLocation: true };
  for (const key of locationFields) next[key] = "";
  return next;
}
