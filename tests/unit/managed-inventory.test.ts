import { expect, it } from "vitest";
import { managedInventory, managedRecoveryIds } from "../../src/server/management/inventory.js";

const vpn = { Id: "a".repeat(64), Names: ["/vpn-main"], Image: "qmcgaw/gluetun:latest", State: "running", Labels: { "com.docker.compose.project": "allowed" }, HostConfig: { NetworkMode: "bridge" } };
const client = (id: string, mode?: string, project = "allowed") => ({ Id: id.repeat(64), Names: [`/client-${id}`], Image: "example/app:1", State: "running", Labels: { "com.docker.compose.project": project }, HostConfig: mode ? { NetworkMode: mode } : {}, Env: ["PASSWORD=synthetic-inventory-secret"] });

it("reports actual full-ID, short-ID and name dependencies only within the declared project inventory", () => {
  const outsideId = "9".repeat(64);
  const rows = managedInventory([vpn, client("b", `container:${vpn.Id}`), client("c", `container:${vpn.Id.slice(0, 12)}`), client("d", "container:vpn-main"), client("e", "bridge"), client("f"), client("7", `container:${outsideId}`), { ...vpn, Id: outsideId, Names: ["/outside-secret-name"], Labels: { "com.docker.compose.project": "outside" } }], ["allowed"]);
  for (const id of ["b", "c", "d"]) expect(rows.find(row => row.id === id.repeat(64))?.network).toEqual({ kind: "vpn_namespace", vpnId: vpn.Id });
  expect(rows.find(row => row.id === "e".repeat(64))?.network.kind).toBe("other_network");
  expect(rows.find(row => row.id === "f".repeat(64))?.network.kind).toBe("unknown");
  expect(rows.find(row => row.id === "7".repeat(64))?.network).toEqual({ kind: "other_container", vpnId: null });
  expect(JSON.stringify(rows)).not.toContain(outsideId); expect(JSON.stringify(rows)).not.toContain("outside-secret-name"); expect(JSON.stringify(rows)).not.toContain("synthetic-inventory-secret");
});

it("keeps ambiguous references unknown and separates cross-project association from ownership", () => {
  const duplicate = { ...vpn, Id: "8".repeat(64), Names: ["/vpn-main"] };
  const rows = managedInventory([vpn, duplicate, client("b", "container:vpn-main"), client("c", `container:${vpn.Id}`, "second-allowed"), { ...client("d"), Id: "not-a-container-id" }], ["allowed", "second-allowed"]);
  expect(rows.find(row => row.id === "b".repeat(64))?.network.kind).toBe("unknown");
  expect(rows.find(row => row.id === "c".repeat(64))).toMatchObject({ project: "second-allowed", network: { kind: "vpn_namespace", vpnId: vpn.Id } });
  expect(rows).toHaveLength(4);
});

it("reserves successful recovery copies and uncertain operation resources while allowing restored originals", () => {
  const ids = managedRecoveryIds([
    { status: "succeeded", renamedIds: ["a".repeat(64)], createdIds: ["b".repeat(64)] },
    { status: "rolled_back", renamedIds: ["c".repeat(64)], createdIds: ["d".repeat(64)] },
    { status: "interrupted", renamedIds: ["e".repeat(64)], createdIds: ["f".repeat(64)] },
    { status: "rollback_failed", createdIds: ["1".repeat(64), "invalid"] }
  ]);
  expect([...ids].sort()).toEqual(["1", "a", "e", "f"].map(id => id.repeat(64)).sort());
});

it("identifies a custom-name pinned VPN through its stable role label", () => {
  const pinned = { ...vpn, Image: `sha256:${"c".repeat(64)}`, Labels: { ...vpn.Labels, "com.docker.compose.service": "vpn", "com.ishiku.tuniku.role": "gluetun" } };
  expect(managedInventory([pinned, client("b", `container:${pinned.Id}`)], ["allowed"])).toMatchObject([{ role: "vpn" }, { network: { kind: "vpn_namespace", vpnId: pinned.Id } }]);
});
