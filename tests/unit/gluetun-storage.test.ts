import { expect, it } from "vitest";
import { gluetunStorage, readStorageSummary } from "../../src/server/docker/storage.js";

it("classifies temporary bind roots and tmpfs without exposing source paths", () => {
  for (const source of ["/tmp/private", "/tmp", "/var/tmp/private", "/run/private", "/var/run/private", "/dev/shm/private", "/persistent/../tmp/private"]) {
    const result = gluetunStorage({ Mounts: [{ Type: "bind", Source: source, Destination: "/gluetun", RW: true }] });
    expect(result.state).toBe("temporary"); expect(JSON.stringify(result)).not.toContain(source);
  }
  expect(gluetunStorage({ Mounts: [{ Type: "tmpfs", Destination: "/gluetun" }] }).state).toBe("temporary");
  expect(gluetunStorage({ Mounts: [{ Type: "bind", Source: "/tmp-other/private", Destination: "/gluetun" }] }).state).toBe("bind");
});

it("distinguishes missing metadata, container layer, partial and readonly mounts without claiming host durability", () => {
  expect(gluetunStorage({}).state).toBe("unverified");
  expect(gluetunStorage({ Mounts: [] }).state).toBe("container_layer");
  expect(gluetunStorage({ Mounts: [{ Type: "volume", Destination: "/gluetun/servers.json" }] }).state).toBe("partial");
  const result = gluetunStorage({ Mounts: [{ Type: "volume", Destination: "/gluetun", RW: false }] });
  expect(result).toMatchObject({ state: "volume", writable: false }); expect(result.message).toContain("read-only");
  expect(gluetunStorage({ Mounts: [{ Type: "volume", Destination: "/gluetun" }, { Type: "bind", Source: "/tmp/private", Destination: "/gluetun/servers.json" }] }).state).toBe("temporary");
  expect(gluetunStorage({ Mounts: [{ Type: "bind", Source: "/tmp/private", Destination: "/unrelated" }] }).state).toBe("container_layer");
  expect(gluetunStorage({ Mounts: [null, { Destination: "/gluetun", Type: "unknown" }] }).state).toBe("unverified");
});

it("reconstructs fixed safe descriptions from a proxy summary and ignores arbitrary upstream messages", () => {
  const result = readStorageSummary({ state: "bind", writable: false, message: "synthetic-private-host-path", Source: "/tmp/private" });
  expect(result).toMatchObject({ state: "bind", writable: false }); expect(JSON.stringify(result)).not.toContain("synthetic-private-host-path");
  expect(readStorageSummary({ state: "invalid", message: "synthetic-secret" }).state).toBe("unverified");
});
