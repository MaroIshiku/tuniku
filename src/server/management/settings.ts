import type { ComposeGenerationInput } from "../compose/generator.js";
import { getProviderProfile } from "../compose/providers.js";
import type { ManagedContainer } from "./engine.js";

export const settingsFields: Record<string, string> = {
  provider: "VPN_SERVICE_PROVIDER", vpnType: "VPN_TYPE", countries: "SERVER_COUNTRIES", regions: "SERVER_REGIONS", cities: "SERVER_CITIES", hostnames: "SERVER_HOSTNAMES", serverNames: "SERVER_NAMES", categories: "SERVER_CATEGORIES", isps: "ISP",
  wireguardPrivateKey: "WIREGUARD_PRIVATE_KEY", wireguardAddresses: "WIREGUARD_ADDRESSES", wireguardPresharedKey: "WIREGUARD_PRESHARED_KEY", wireguardPublicKey: "WIREGUARD_PUBLIC_KEY", wireguardEndpointIp: "WIREGUARD_ENDPOINT_IP", wireguardEndpointPort: "WIREGUARD_ENDPOINT_PORT", openvpnUser: "OPENVPN_USER", openvpnPassword: "OPENVPN_PASSWORD", openvpnCertificate: "OPENVPN_CERT", openvpnKey: "OPENVPN_KEY", openvpnEncryptedKey: "OPENVPN_ENCRYPTED_KEY", openvpnKeyPassphrase: "OPENVPN_KEY_PASSPHRASE"
};
const publicFields = new Set(["provider", "vpnType", "countries", "regions", "cities", "hostnames", "serverNames", "categories", "isps", "wireguardAddresses", "wireguardEndpointIp", "wireguardEndpointPort"]);
export function containerEnvironment(container: ManagedContainer): Record<string, string> {
  return Object.fromEntries((container.Config.Env ?? []).map((entry: string) => { const index = entry.indexOf("="); return [entry.slice(0, index), entry.slice(index + 1)]; }));
}
export function settingsFromEnvironment(environment: Record<string, string>, publicOnly = false): ComposeGenerationInput {
  const values = Object.fromEntries(Object.entries(settingsFields).filter(([field, env]) => environment[env] !== undefined && (!publicOnly || publicFields.has(field))).map(([field, env]) => [field, field === "wireguardEndpointPort" ? Number(environment[env]) : environment[env]]));
  const profile = getProviderProfile(environment.VPN_SERVICE_PROVIDER);
  const providerOptions = Object.fromEntries((profile?.options ?? []).filter(option => environment[option.env] !== undefined && !(option.kind === "boolean" && ["off", "false", "no", "0"].includes(environment[option.env]!))).map(option => [option.env, environment[option.env]]));
  return { taskType: "configure_provider", ...values, providerOptions } as ComposeGenerationInput;
}
export function wireguardMountSource(container: ManagedContainer): "file" | "unknown" | "environment" {
  const target = "/gluetun/wireguard/wg0.conf";
  const paths = [...(container.Mounts ?? []).map(mount => mount.Destination), ...(container.HostConfig.Mounts ?? []).map((mount: any) => mount.Target), ...(container.HostConfig.Binds ?? []).map((bind: string) => bind.split(":")[1])];
  if (paths.includes(target)) return "file";
  if (paths.some(p => typeof p === "string" && (p === "/" || target.startsWith(`${p.replace(/\/+$/, "")}/`)))) return "unknown";
  return "environment";
}
