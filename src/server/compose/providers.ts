import type { ServerFilterKey } from "./serverCatalog.js";

export type VpnProtocol = "openvpn" | "wireguard";

export interface ProviderOption {
  env: string;
  label: string;
  kind: "boolean" | "number" | "select";
  protocols?: VpnProtocol[];
  choices?: string[];
  enabledValue?: string;
  description: string;
}

export interface GluetunProviderProfile {
  id: string;
  label: string;
  protocols: VpnProtocol[];
  guidance: string;
  docsUrl: string;
  openvpnCredentials: "required" | "optional" | "none";
  openvpnCertificate: "none" | "client_key" | "encrypted_key";
  wireguardAddresses: boolean;
  wireguardPresharedKey: boolean;
  customConfiguration: boolean;
  serverFilters: ServerFilterKey[];
  options: ProviderOption[];
}

const providerDocs = (name: string): string =>
  `https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/${name}.md`;

const openvpnProtocol: ProviderOption = {
  env: "OPENVPN_PROTOCOL", label: "OpenVPN transport", kind: "select", protocols: ["openvpn"], choices: ["udp", "tcp"],
  description: "Optional OpenVPN transport; Gluetun defaults to UDP."
};
const openvpnPort: ProviderOption = {
  env: "OPENVPN_ENDPOINT_PORT", label: "OpenVPN endpoint port", kind: "number", protocols: ["openvpn"],
  description: "Optional provider endpoint port from the official walkthrough."
};
const wireguardPort: ProviderOption = {
  env: "WIREGUARD_ENDPOINT_PORT", label: "WireGuard endpoint port", kind: "number", protocols: ["wireguard"],
  description: "Optional provider endpoint port from the official walkthrough."
};
const enabled = (env: string, label: string, enabledValue = "on"): ProviderOption => ({
  env, label, kind: "boolean", enabledValue,
  description: `Set ${env}=${enabledValue}; leave disabled to use Gluetun's default.`
});

// Synchronized with the provider constants in qmcgaw/gluetun:latest and the
// official provider walkthroughs on 2026-08-31. Perfect Privacy is deliberately
// absent because the current Gluetun executable no longer accepts it.
export const gluetunProviderProfiles: GluetunProviderProfile[] = [
  { id: "airvpn", label: "AirVPN", protocols: ["wireguard", "openvpn"], guidance: "Export the AirVPN material for the selected protocol.", docsUrl: providerDocs("airvpn"), openvpnCredentials: "none", openvpnCertificate: "client_key", wireguardAddresses: true, wireguardPresharedKey: true, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "names", "hostnames"], options: [openvpnProtocol] },
  { id: "cyberghost", label: "CyberGhost", protocols: ["openvpn"], guidance: "Create a manual OpenVPN connection and use its credentials and certificate material.", docsUrl: providerDocs("cyberghost"), openvpnCredentials: "required", openvpnCertificate: "client_key", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "hostnames"], options: [openvpnProtocol] },
  { id: "expressvpn", label: "ExpressVPN", protocols: ["openvpn"], guidance: "Use the manual OpenVPN credentials from your ExpressVPN account.", docsUrl: providerDocs("expressvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "fastestvpn", label: "FastestVPN", protocols: ["wireguard", "openvpn"], guidance: "Use the manual credentials or values from a FastestVPN WireGuard configuration.", docsUrl: providerDocs("fastestvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: true, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "giganews", label: "Giganews", protocols: ["openvpn"], guidance: "Use the OpenVPN credentials issued for your Giganews/VyprVPN account.", docsUrl: providerDocs("giganews"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["regions", "hostnames"], options: [] },
  { id: "hidemyass", label: "HideMyAss", protocols: ["openvpn"], guidance: "Use your manual OpenVPN username and password.", docsUrl: providerDocs("hidemyass"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "ipvanish", label: "IPVanish", protocols: ["openvpn"], guidance: "Use the OpenVPN credentials from your IPVanish account.", docsUrl: providerDocs("ipvanish"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "cities", "hostnames"], options: [] },
  { id: "ivpn", label: "IVPN", protocols: ["wireguard", "openvpn"], guidance: "Use your IVPN account ID; a password is required only for non-account-ID OpenVPN usernames.", docsUrl: providerDocs("ivpn"), openvpnCredentials: "optional", openvpnCertificate: "none", wireguardAddresses: true, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "cities", "hostnames", "isps"], options: [openvpnProtocol, wireguardPort] },
  { id: "mullvad", label: "Mullvad", protocols: ["wireguard"], guidance: "Current Gluetun latest accepts Mullvad only with WireGuard; OpenVPN was retired in January 2026.", docsUrl: providerDocs("mullvad"), openvpnCredentials: "none", openvpnCertificate: "none", wireguardAddresses: true, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "cities", "hostnames", "isps"], options: [wireguardPort, enabled("OWNED_ONLY", "Mullvad-owned servers only", "yes")] },
  { id: "nordvpn", label: "NordVPN", protocols: ["wireguard", "openvpn"], guidance: "Use NordVPN manual service credentials or the NordLynx private key, not the website password.", docsUrl: providerDocs("nordvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames", "categories"], options: [openvpnProtocol] },
  { id: "privado", label: "PrivadoVPN", protocols: ["openvpn"], guidance: "Use the manual OpenVPN credentials from PrivadoVPN.", docsUrl: providerDocs("privado"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames"], options: [openvpnProtocol, openvpnPort] },
  { id: "private internet access", label: "Private Internet Access", protocols: ["openvpn"], guidance: "PIA accepts regions, server names, and hostnames—not generic country or city filters.", docsUrl: providerDocs("private-internet-access"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["regions", "names", "hostnames"], options: [openvpnProtocol, openvpnPort, enabled("PORT_FORWARD_ONLY", "Port-forwarding servers only", "true"), enabled("VPN_PORT_FORWARDING", "Enable VPN port forwarding"), { env: "PRIVATE_INTERNET_ACCESS_OPENVPN_ENCRYPTION_PRESET", label: "PIA encryption preset", kind: "select", choices: ["strong", "normal"], protocols: ["openvpn"], description: "Optional PIA OpenVPN encryption preset." }] },
  { id: "privatevpn", label: "PrivateVPN", protocols: ["openvpn"], guidance: "Use your PrivateVPN account credentials, not the proxy login.", docsUrl: providerDocs("privatevpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "cities", "hostnames"], options: [openvpnProtocol, openvpnPort] },
  { id: "protonvpn", label: "ProtonVPN", protocols: ["wireguard", "openvpn"], guidance: "Use Proton VPN manual OpenVPN credentials or the private key from a generated WireGuard configuration.", docsUrl: providerDocs("protonvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames"], options: [openvpnProtocol, openvpnPort, enabled("FREE_ONLY", "Free servers only"), enabled("STREAM_ONLY", "Streaming servers only"), enabled("SECURE_CORE_ONLY", "Secure Core servers only"), enabled("TOR_ONLY", "Tor servers only"), enabled("PORT_FORWARD_ONLY", "Port-forwarding servers only"), enabled("VPN_PORT_FORWARDING", "Enable VPN port forwarding")] },
  { id: "purevpn", label: "PureVPN", protocols: ["openvpn"], guidance: "Use your PureVPN manual OpenVPN credentials.", docsUrl: providerDocs("purevpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "slickvpn", label: "SlickVPN", protocols: ["openvpn"], guidance: "Use your SlickVPN OpenVPN credentials.", docsUrl: providerDocs("slickvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "surfshark", label: "Surfshark", protocols: ["wireguard", "openvpn"], guidance: "Use Surfshark manual credentials or the values from a generated WireGuard configuration.", docsUrl: providerDocs("surfshark"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: true, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "torguard", label: "TorGuard", protocols: ["openvpn"], guidance: "Use your TorGuard OpenVPN credentials.", docsUrl: providerDocs("torguard"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "vpnsecure", label: "VPNSecure.me", protocols: ["openvpn"], guidance: "Export the VPNSecure certificate, encrypted private key, and key passphrase.", docsUrl: providerDocs("vpn-secure"), openvpnCredentials: "none", openvpnCertificate: "encrypted_key", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["regions", "cities", "hostnames"], options: [openvpnProtocol, enabled("PREMIUM_ONLY", "Premium servers only", "yes")] },
  { id: "vpn unlimited", label: "VPN Unlimited", protocols: ["openvpn"], guidance: "Use the generated OpenVPN credentials and client certificate material from VPN Unlimited.", docsUrl: providerDocs("vpn-unlimited"), openvpnCredentials: "required", openvpnCertificate: "client_key", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["countries", "regions", "cities", "hostnames"], options: [openvpnProtocol] },
  { id: "vyprvpn", label: "VyprVPN", protocols: ["openvpn"], guidance: "Use your VyprVPN OpenVPN credentials.", docsUrl: providerDocs("vyprvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: false, wireguardPresharedKey: false, customConfiguration: false, serverFilters: ["regions", "hostnames"], options: [] },
  { id: "windscribe", label: "Windscribe", protocols: ["wireguard", "openvpn"], guidance: "Use Windscribe configuration-generator credentials, not the account password.", docsUrl: providerDocs("windscribe"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardAddresses: true, wireguardPresharedKey: true, customConfiguration: false, serverFilters: ["regions", "cities", "hostnames"], options: [openvpnProtocol, openvpnPort, wireguardPort] },
  { id: "custom", label: "Custom provider", protocols: ["wireguard", "openvpn"], guidance: "Provide every value from your provider's exported OpenVPN or WireGuard configuration.", docsUrl: providerDocs("custom"), openvpnCredentials: "optional", openvpnCertificate: "none", wireguardAddresses: true, wireguardPresharedKey: false, customConfiguration: true, serverFilters: [], options: [] }
];

export function getProviderProfile(id: string | undefined): GluetunProviderProfile | undefined {
  return gluetunProviderProfiles.find((provider) => provider.id === id);
}
