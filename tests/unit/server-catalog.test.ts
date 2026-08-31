import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ServerCatalog } from "../../src/server/compose/serverCatalog.js";

describe("official Gluetun server catalog", () => {
  it("offers protocol-aware PIA regions and validates exact current values", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-server-catalog-"));
    const catalog = new ServerCatalog(dataPath);
    const result = catalog.query("private internet access", "openvpn", "regions", "Stockholm");

    expect(result?.values).toContain("SE Stockholm");
    expect(result?.source).toBe("bundled");
    expect(catalog.validate("private internet access", "openvpn", "regions", "SE Stockholm")).toEqual([]);
    expect(catalog.validate("private internet access", "openvpn", "regions", "Stockholm")[0]).toMatch(/not a current regions value/);
    expect(catalog.query("private internet access", "wireguard", "regions", "")?.values).toEqual([]);
  });

  it("keeps large hostname catalogs searchable and response-bounded", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-server-catalog-"));
    const catalog = new ServerCatalog(dataPath);
    const result = catalog.query("nordvpn", "openvpn", "hostnames", "us", 25);

    expect(result?.values.length).toBeLessThanOrEqual(25);
    expect(result?.values.every((value) => value.toLowerCase().includes("us"))).toBe(true);
  });
});
