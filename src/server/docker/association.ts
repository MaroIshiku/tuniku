export type DockerAssociation = { state: "matched" | "unverified"; message: string };

function normalize(address: string): string {
  const plain = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (!plain.includes(":")) return plain;
  try { return new URL(`http://[${plain}]/`).hostname.slice(1, -1); } catch { return plain; }
}

/** Match every resolved API address against the selected container, never names alone. */
export function matchDockerEndpoint(endpoint: URL, addresses: string[], inspected: any): DockerAssociation {
  const unverified: DockerAssociation = { state: "unverified", message: "The saved Control API endpoint could not be associated with this Docker container. Use its direct address and Control Server port; Docker diagnostics remain separate and its ports and traffic are not attributed to the API instance." };
  if (endpoint.protocol !== "http:" || !["", "/"].includes(endpoint.pathname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return unverified;
  const controlPort = inspected?.ControlServer?.port;
  if (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535 || addresses.length === 0) return unverified;
  const port = Number(endpoint.port || 80);
  const direct = Object.values(inspected?.NetworkSettings?.Networks ?? {}).flatMap((network: any) => [network?.IPAddress, network?.GlobalIPv6Address]).filter((value): value is string => typeof value === "string" && value.length > 0).map(normalize);
  const mappings: any[] = inspected?.HostConfig?.PortBindings?.[`${controlPort}/tcp`] ?? [];
  const matches = addresses.every((ip) => {
    const normalized = normalize(ip);
    if (port === controlPort && direct.includes(normalized)) return true;
    return Array.isArray(mappings) && mappings.some((mapping) => Number(mapping?.HostPort) === port && !["", "0.0.0.0", "::"].includes(mapping?.HostIp ?? "") && normalize(String(mapping.HostIp)) === normalized);
  });
  return matches ? { state: "matched", message: "The saved Control API address and port match the selected Docker container." } : unverified;
}
