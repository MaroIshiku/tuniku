export interface ManagedCandidate {
  id: string;
  name: string;
  image: string;
  state: string;
  project: string;
  role: "vpn" | "application";
  network: { kind: "vpn" | "vpn_namespace" | "other_container" | "other_network" | "unknown"; vpnId: string | null };
  recovery?: boolean;
}

export function managedInventory(containers: Array<Record<string, any>>, projects: string[]): ManagedCandidate[] {
  const scoped = containers.filter(container => container && typeof container === "object" && !Array.isArray(container) && projects.includes(container.Labels?.["com.docker.compose.project"]) && typeof container.Id === "string" && /^[a-f0-9]{64}$/.test(container.Id));
  const candidates: ManagedCandidate[] = scoped.map(container => ({
    id: container.Id,
    name: typeof container.Names?.[0] === "string" ? container.Names[0].replace(/^\//, "") : "Unnamed container",
    image: String(container.Image ?? "Unknown image"),
    state: String(container.State ?? "unknown"),
    project: container.Labels["com.docker.compose.project"],
    role: container.Labels?.["com.ishiku.tuniku.role"] === "gluetun" || /^(?:docker\.io\/)?qmcgaw\/gluetun(?::|@)/.test(String(container.Image)) || container.Labels?.["com.docker.compose.service"] === "gluetun" ? "vpn" : "application",
    network: { kind: "unknown", vpnId: null }
  }));
  const vpns = candidates.filter(candidate => candidate.role === "vpn");
  return candidates.map((candidate, index) => {
    if (candidate.role === "vpn") return { ...candidate, network: { kind: "vpn", vpnId: candidate.id } };
    const mode = scoped[index]?.HostConfig?.NetworkMode;
    if (typeof mode !== "string" || !mode) return candidate;
    if (!mode.startsWith("container:")) return { ...candidate, network: { kind: "other_network", vpnId: null } };
    const target = mode.slice(10);
    const matches = vpns.filter(vpn => vpn.id === target || vpn.id.slice(0, 12) === target || vpn.name === target);
    if (matches.length > 1) return candidate;
    if (!matches.length) return { ...candidate, network: { kind: "other_container", vpnId: null } };
    return { ...candidate, network: { kind: "vpn_namespace", vpnId: matches[0]!.id } };
  });
}

export function managedRecoveryIds(operations: Array<{ status: string; renamedIds?: string[]; createdIds?: string[]; cleanedIds?: string[] }>): Set<string> {
  return new Set(operations.flatMap(operation => {
    const active = ["applying", "interrupted", "rollback_failed"].includes(operation.status);
    return operation.status === "succeeded" || active ? [...(operation.renamedIds ?? []), ...(active ? operation.createdIds ?? [] : [])].filter(id => !operation.cleanedIds?.includes(id)) : [];
  }).filter(id => /^[a-f0-9]{64}$/.test(id)));
}
