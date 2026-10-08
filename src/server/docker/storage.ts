import path from "node:path";

export interface GluetunStorage {
  state: "unverified" | "temporary" | "container_layer" | "partial" | "volume" | "bind";
  writable: boolean | null;
  message: string;
}
const temporaryRoots = ["/tmp", "/var/tmp", "/run", "/var/run", "/dev/shm"];

// Classify Docker's mount metadata only. Never read a host path or expose it.
export function gluetunStorage(inspected: { Mounts?: unknown }): GluetunStorage {
  if (!Array.isArray(inspected.Mounts)) return { state: "unverified", writable: null, message: "Gluetun storage mount information is unavailable. Review /gluetun persistence before recreating the container." };
  const relevant = inspected.Mounts.filter((mount: any) => typeof mount?.Destination === "string" && (mount.Destination === "/" || mount.Destination === "/gluetun" || mount.Destination.startsWith("/gluetun/")));
  const temporary = relevant.some((mount: any) => {
    if (mount.Type === "tmpfs") return true;
    if (mount.Type !== "bind" || typeof mount.Source !== "string") return false;
    const source = path.posix.normalize(mount.Source);
    return temporaryRoots.some(root => source === root || source.startsWith(`${root}/`));
  });
  if (temporary) return { state: "temporary", writable: null, message: "Gluetun data uses a temporary mount. Before moving it, stop writers, back up the data, review a persistent destination and approve the migration. Tuniku has not copied or changed any files." };
  const root = relevant.find((mount: any) => mount.Destination === "/gluetun") ?? relevant.find((mount: any) => mount.Destination === "/");
  if (!root) return relevant.length ? { state: "partial", writable: null, message: "Only part of /gluetun has a mount. Remaining data may be lost on container replacement. Review and back up the complete data directory before an approved migration." } : { state: "container_layer", writable: null, message: "No mount covers /gluetun. Data in the container layer may be lost on replacement. Back it up and review a persistent destination before an approved migration." };
  const writable = typeof root.RW === "boolean" ? root.RW : null;
  if (root.Type === "volume" || root.Type === "bind") return { state: root.Type, writable, message: `${root.Type === "volume" ? "A Docker volume" : "A host bind"} covers /gluetun.${writable === false ? " The mount is read-only." : ""} Host durability, ownership, free space and backup status require an operator review.` };
  return { state: "unverified", writable, message: "The /gluetun mount type is not recognized. Review its persistence before container replacement." };
}

export function readStorageSummary(value: unknown): GluetunStorage {
  const summary = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const RW = typeof summary.writable === "boolean" ? summary.writable : undefined;
  switch (summary.state) {
    case "temporary": return gluetunStorage({ Mounts: [{ Destination: "/gluetun", Type: "tmpfs" }] });
    case "container_layer": return gluetunStorage({ Mounts: [] });
    case "partial": return gluetunStorage({ Mounts: [{ Destination: "/gluetun/servers.json", Type: "volume" }] });
    case "bind": case "volume": return gluetunStorage({ Mounts: [{ Destination: "/gluetun", Type: summary.state, Source: "/persistent", RW }] });
    default: return gluetunStorage({});
  }
}
