export type VpnProtocol = "openvpn" | "wireguard";

export interface GluetunProviderProfile {
  id: string;
  label: string;
  protocols: VpnProtocol[];
  guidance: string;
  docsUrl: string;
  openvpnCredentials: "required" | "optional" | "none";
  openvpnCertificate: "none" | "client_key" | "encrypted_key";
  openvpnPasswordDefault?: string;
  wireguardPresharedKey: boolean;
  customConfiguration: boolean;
}

const providerDocs = (name: string): string =>
  `https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/${name}.md`;

// Pinned to Gluetun v3.41.3. Provider identifiers and native protocol support
// mirror the executable provider constants and validation in that release.
export const gluetunProviderProfiles: GluetunProviderProfile[] = [
  { id: "airvpn", label: "AirVPN", protocols: ["wireguard", "openvpn"], guidance: "Export the AirVPN connection material for the selected protocol.", docsUrl: providerDocs("airvpn"), openvpnCredentials: "none", openvpnCertificate: "client_key", wireguardPresharedKey: true, customConfiguration: false },
  { id: "cyberghost", label: "CyberGhost", protocols: ["openvpn"], guidance: "Create a manual OpenVPN connection in CyberGhost and use its credentials and certificate material.", docsUrl: providerDocs("cyberghost"), openvpnCredentials: "required", openvpnCertificate: "client_key", wireguardPresharedKey: false, customConfiguration: false },
  { id: "expressvpn", label: "ExpressVPN", protocols: ["openvpn"], guidance: "Use the manual OpenVPN credentials from your ExpressVPN account.", docsUrl: providerDocs("expressvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "fastestvpn", label: "FastestVPN", protocols: ["wireguard", "openvpn"], guidance: "Use the manual VPN credentials or WireGuard configuration issued by FastestVPN.", docsUrl: providerDocs("fastestvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "giganews", label: "Giganews", protocols: ["openvpn"], guidance: "Use the OpenVPN credentials issued for your Giganews/VyprVPN account.", docsUrl: providerDocs("giganews"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "hidemyass", label: "HideMyAss", protocols: ["openvpn"], guidance: "Use your manual OpenVPN username and password.", docsUrl: providerDocs("hidemyass"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "ipvanish", label: "IPVanish", protocols: ["openvpn"], guidance: "Use the OpenVPN credentials from your IPVanish account.", docsUrl: providerDocs("ipvanish"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "ivpn", label: "IVPN", protocols: ["wireguard", "openvpn"], guidance: "Use your IVPN account ID. OpenVPN account IDs can omit a password; WireGuard needs the generated key and address.", docsUrl: providerDocs("ivpn"), openvpnCredentials: "optional", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "mullvad", label: "Mullvad", protocols: ["wireguard", "openvpn"], guidance: "Use your Mullvad account number. For OpenVPN, Gluetun uses the provider default password when left blank.", docsUrl: providerDocs("mullvad"), openvpnCredentials: "required", openvpnCertificate: "none", openvpnPasswordDefault: "m", wireguardPresharedKey: false, customConfiguration: false },
  { id: "nordvpn", label: "NordVPN", protocols: ["wireguard", "openvpn"], guidance: "Use NordVPN manual service credentials, not your website login. NordLynx private keys are supported as WireGuard keys.", docsUrl: providerDocs("nordvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "perfect privacy", label: "Perfect Privacy", protocols: ["openvpn"], guidance: "Use your Perfect Privacy OpenVPN credentials.", docsUrl: providerDocs("perfectprivacy"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "privado", label: "PrivadoVPN", protocols: ["openvpn"], guidance: "Use the manual OpenVPN credentials from PrivadoVPN.", docsUrl: providerDocs("privado"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "private internet access", label: "Private Internet Access", protocols: ["openvpn"], guidance: "Use your PIA OpenVPN username and password.", docsUrl: providerDocs("private-internet-access"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "privatevpn", label: "PrivateVPN", protocols: ["openvpn"], guidance: "Use your PrivateVPN OpenVPN credentials.", docsUrl: providerDocs("privatevpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "protonvpn", label: "ProtonVPN", protocols: ["wireguard", "openvpn"], guidance: "Use Proton VPN manual OpenVPN credentials or values from a downloaded WireGuard configuration, not your account password.", docsUrl: providerDocs("protonvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "purevpn", label: "PureVPN", protocols: ["openvpn"], guidance: "Use your PureVPN manual OpenVPN credentials.", docsUrl: providerDocs("purevpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "slickvpn", label: "SlickVPN", protocols: ["openvpn"], guidance: "Use your SlickVPN OpenVPN credentials.", docsUrl: providerDocs("slickvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "surfshark", label: "Surfshark", protocols: ["wireguard", "openvpn"], guidance: "Use Surfshark manual credentials or the values from a generated WireGuard configuration.", docsUrl: providerDocs("surfshark"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "torguard", label: "TorGuard", protocols: ["openvpn"], guidance: "Use your TorGuard OpenVPN credentials.", docsUrl: providerDocs("torguard"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "vpnsecure", label: "VPNSecure.me", protocols: ["openvpn"], guidance: "Export the VPNSecure client certificate, encrypted private key, and key passphrase.", docsUrl: providerDocs("vpnsecure"), openvpnCredentials: "none", openvpnCertificate: "encrypted_key", wireguardPresharedKey: false, customConfiguration: false },
  { id: "vpn unlimited", label: "VPN Unlimited", protocols: ["openvpn"], guidance: "Use the generated OpenVPN credentials and client certificate material from VPN Unlimited.", docsUrl: providerDocs("vpn-unlimited"), openvpnCredentials: "required", openvpnCertificate: "client_key", wireguardPresharedKey: false, customConfiguration: false },
  { id: "vyprvpn", label: "VyprVPN", protocols: ["openvpn"], guidance: "Use your VyprVPN OpenVPN credentials.", docsUrl: providerDocs("vyprvpn"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "windscribe", label: "Windscribe", protocols: ["wireguard", "openvpn"], guidance: "Use Windscribe configuration-generator credentials, not your account password.", docsUrl: providerDocs("windscribe"), openvpnCredentials: "required", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: false },
  { id: "custom", label: "Custom provider", protocols: ["wireguard", "openvpn"], guidance: "Provide every connection value from your provider's exported OpenVPN or WireGuard configuration.", docsUrl: "https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/custom.md", openvpnCredentials: "optional", openvpnCertificate: "none", wireguardPresharedKey: false, customConfiguration: true }
];

export function getProviderProfile(id: string | undefined): GluetunProviderProfile | undefined {
  return gluetunProviderProfiles.find((provider) => provider.id === id);
}
