export type WireguardImport = {
  provider: "custom";
  vpnType: "wireguard";
  wireguardPrivateKey: string;
  wireguardAddresses: string;
  wireguardPublicKey: string;
  wireguardPresharedKey: string;
  wireguardEndpointIp: string;
  wireguardEndpointPort: string;
  warnings: string[];
};

function ipFamily(value: string): number {
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255)) return 4;
  if (!value.includes(":") || !/^[0-9a-fA-F:.]+$/.test(value)) return 0;
  try { new URL(`http://[${value}]/`); return 6; } catch { return 0; }
}
function key(value: string | undefined, label: string): string {
  try {
    if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
    const decoded = atob(value);
    if (decoded.length !== 32 || btoa(decoded) !== value || [...decoded].every((character) => character.charCodeAt(0) === 0)) throw new Error();
    return value;
  } catch { throw new Error(`${label} must be a nonzero canonical Base64 WireGuard key.`); }
}

/** Parse only the supported data fields. Never execute hooks, resolve endpoints or retain the source. */
export function importWireguard(source: string): WireguardImport {
  if (source.length > 32_768 || !source.trim() || new TextEncoder().encode(source).byteLength > 32_768 || /[\0]/.test(source)) throw new Error("Paste a WireGuard configuration no larger than 32 KiB.");
  const sections = new Map<string, Map<string, string>>();
  let section: Map<string, string> | undefined;
  for (const original of source.split(/\r?\n/)) {
    const line = original.trim().split(/\s+[;#]/, 1)[0]!;
    if (!line || /^[#;]/.test(line)) continue;
    const heading = line.match(/^\[(Interface|Peer)\]$/i);
    if (heading) {
      const name = heading[1]!.toLowerCase();
      if (sections.has(name)) throw new Error("Import supports exactly one Interface and one Peer.");
      section = new Map(); sections.set(name, section); continue;
    }
    const entry = line.match(/^([A-Za-z]+)\s*=\s*(.+)$/);
    if (!entry || !section) throw new Error("The WireGuard configuration contains an unsupported line or section.");
    const name = entry[1]!.toLowerCase();
    const allowed = section === sections.get("interface") ? ["privatekey", "address", "dns"] : ["publickey", "presharedkey", "endpoint", "allowedips"];
    if (!allowed.includes(name)) throw new Error("This importer does not support hooks, MTU, keepalive or additional directives. Review those settings manually.");
    if (section.has(name)) throw new Error("The WireGuard configuration contains duplicate fields.");
    section.set(name, entry[2]!.trim());
  }
  const local = sections.get("interface"), peer = sections.get("peer");
  if (!local || !peer) throw new Error("Import requires one Interface and one Peer.");
  const addresses = (local.get("address") ?? "").split(",").map((value) => value.trim());
  if (addresses.some((address) => {
    const [ip, prefix, extra] = address.split("/"); const family = ipFamily(ip ?? "");
    return !family || extra !== undefined || !/^\d+$/.test(prefix ?? "") || Number(prefix) > (family === 4 ? 32 : 128);
  })) throw new Error("Interface addresses must be valid IPv4 or IPv6 CIDRs.");
  const routes = new Set((peer.get("allowedips") ?? "").split(",").map((value) => value.trim()));
  if (routes.size !== 2 || !routes.has("0.0.0.0/0") || !routes.has("::/0")) throw new Error("Import supports dual-stack full-tunnel routes only: AllowedIPs = 0.0.0.0/0, ::/0. Split routing needs a manual review.");
  const endpoint = peer.get("endpoint")?.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/);
  const ip = endpoint?.[1] ?? endpoint?.[2] ?? "";
  const port = Number(endpoint?.[3]);
  if (!ipFamily(ip) || !Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Endpoint must contain a literal IPv4 or bracketed IPv6 address and a valid port. Hostname endpoints need manual review.");
  const dns = local.get("dns");
  if (dns && dns.split(",").some((value) => !ipFamily(value.trim()))) throw new Error("Imported DNS values must be literal IP addresses.");
  return {
    provider: "custom", vpnType: "wireguard",
    wireguardPrivateKey: key(local.get("privatekey"), "PrivateKey"),
    wireguardAddresses: addresses.join(","), wireguardPublicKey: key(peer.get("publickey"), "PublicKey"),
    wireguardPresharedKey: peer.has("presharedkey") ? key(peer.get("presharedkey"), "PresharedKey") : "",
    wireguardEndpointIp: ip, wireguardEndpointPort: String(port),
    warnings: dns ? ["Imported DNS addresses are not applied. Gluetun keeps its own DNS configuration. Confirm this difference before importing."] : []
  };
}
