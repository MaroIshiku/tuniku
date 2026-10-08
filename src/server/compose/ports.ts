export type HostBinding = { address: string; first: number; last: number; protocol: "tcp" | "udp"; service?: string; target?: number };

function range(value: unknown): [number, number] | null {
  const match = String(value).match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const first = Number(match[1]), last = Number(match[2] ?? match[1]);
  return first >= 1 && last >= first && last <= 65535 ? [first, last] : null;
}
function address(value: string): string {
  const plain = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (!plain.includes(":")) return plain;
  try {
    const normalized = new URL(`http://[${plain}]/`).hostname.slice(1, -1);
    const mapped = normalized.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
    if (mapped) { const a = parseInt(mapped[1]!, 16), b = parseInt(mapped[2]!, 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
    return normalized;
  } catch { return plain; }
}
export function bindingsOverlap(left: HostBinding, right: HostBinding): boolean {
  if (left.protocol !== right.protocol || left.last < right.first || right.last < left.first) return false;
  const a = address(left.address), b = address(right.address);
  // Conservatively include dual-stack wildcard listeners.
  return a === b || ["", "0.0.0.0", "::"].includes(a) || ["", "0.0.0.0", "::"].includes(b);
}
export function composeBindings(document: unknown): { bindings: HostBinding[]; unresolved: boolean } {
  const bindings: HostBinding[] = []; let unresolved = false;
  for (const [service, configuration] of Object.entries((document as any)?.services ?? {})) {
    for (const port of (configuration as any)?.ports ?? []) {
      let host: string, published: unknown, target: unknown, protocol: "tcp" | "udp";
      if (port && typeof port === "object") {
        host = String(port.host_ip ?? ""); published = port.published; target = port.target; protocol = port.protocol ?? "tcp";
      } else {
        const text = String(port);
        if (text.includes("$")) { unresolved = true; continue; }
        const match = text.match(/^(?:(\[[^\]]+\]|[^:]+):)?(?:(\d+(?:-\d+)?):)?(\d+(?:-\d+)?)(?:\/(tcp|udp))?$/);
        if (!match) continue;
        host = match[1] ?? ""; published = match[2]; target = match[3]; protocol = (match[4] as "tcp" | "udp" | undefined) ?? "tcp";
        if (host && published === undefined && /^\d+(?:-\d+)?$/.test(host)) { published = host; host = ""; }
      }
      if ([host, published, target].some((value) => typeof value === "string" && value.includes("$"))) { unresolved = true; continue; }
      const bound = range(published), destination = range(target);
      if (bound && ["tcp", "udp"].includes(protocol)) bindings.push({ address: host.replace(/^\[|\]$/g, ""), first: bound[0], last: bound[1], protocol, service, ...(destination && destination[0] === destination[1] ? { target: destination[0] } : {}) });
    }
  }
  return { bindings, unresolved };
}
export function dockerBindings(bindings: Record<string, any>): HostBinding[] {
  return Object.entries(bindings).flatMap(([target, mappings]) => {
    const [number, protocol] = target.split("/");
    if (!["tcp", "udp"].includes(protocol ?? "") || !Array.isArray(mappings)) return [];
    return mappings.flatMap((mapping) => {
      const bound = range(mapping.HostPort);
      return bound ? [{ address: String(mapping.HostIp ?? ""), first: bound[0], last: bound[1], protocol: protocol as "tcp" | "udp", target: Number(number) }] : [];
    });
  });
}
