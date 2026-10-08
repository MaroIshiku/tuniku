import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { describe, expect, it, vi } from "vitest";
import { ServerCatalog } from "../../src/server/compose/serverCatalog.js";

describe("official Gluetun server catalog", () => {
  it("pins a refresh to the discovered revision and preserves the previous cache on malformed revisions", async () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-catalog-provenance-"));
    const previous = getGlobalDispatcher(); const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
    const revision = "a".repeat(40);
    const body = JSON.stringify({ timestamp: 1785990787, servers: [{ vpn: "wireguard", country: "Synthetic Country" }] });
    try {
      agent.get("https://api.github.com").intercept({ path: "/repos/qdm12/gluetun-servers/commits/main" }).reply(200, { sha: revision });
      agent.get("https://raw.githubusercontent.com").intercept({ path: `/qdm12/gluetun-servers/${revision}/pkg/servers/mullvad.json` }).reply(200, body);
      const catalog = new ServerCatalog(dataPath); await catalog.refresh("mullvad");
      const loaded = catalog.query("mullvad", "wireguard", "countries", "");
      expect(loaded).toMatchObject({ values: ["Synthetic Country"], sourceRevision: revision, sourceSha256: createHash("sha256").update(body).digest("hex"), runtimeComparison: "unavailable", bundledAt: null });
      expect(Number.isFinite(Date.parse(loaded!.retrievedAt!))).toBe(true);
      expect(loaded!.sourceUrl).toContain(`/blob/${revision}/pkg/servers/mullvad.json`);
      const before = fs.readFileSync(path.join(dataPath, "server-catalog/mullvad.json"), "utf8");
      agent.get("https://api.github.com").intercept({ path: "/repos/qdm12/gluetun-servers/commits/main" }).reply(200, { sha: "main" });
      await expect(catalog.refresh("mullvad")).rejects.toThrow(/revision is invalid/);
      expect(fs.readFileSync(path.join(dataPath, "server-catalog/mullvad.json"), "utf8")).toBe(before);
      agent.get("https://api.github.com").intercept({ path: "/repos/qdm12/gluetun-servers/commits/main" }).reply(200, { sha: revision });
      agent.get("https://raw.githubusercontent.com").intercept({ path: `/qdm12/gluetun-servers/${revision}/pkg/servers/mullvad.json` }).reply(302, "", { headers: { location: "http://127.0.0.1/private" } });
      await expect(catalog.refresh("mullvad")).rejects.toThrow();
      expect(fs.readFileSync(path.join(dataPath, "server-catalog/mullvad.json"), "utf8")).toBe(before);
      agent.get("https://api.github.com").intercept({ path: "/repos/qdm12/gluetun-servers/commits/main" }).reply(200, "x".repeat(256 * 1024 + 1));
      await expect(catalog.refresh("mullvad")).rejects.toThrow();
      expect(fs.readFileSync(path.join(dataPath, "server-catalog/mullvad.json"), "utf8")).toBe(before);
      const forged = JSON.parse(before); forged.provenance.revision = "https://untrusted.example/source";
      fs.writeFileSync(path.join(dataPath, "server-catalog/mullvad.json"), JSON.stringify(forged));
      expect(catalog.getProvider("mullvad")?.source).toBe("bundled");
      agent.assertNoPendingInterceptors();
    } finally { setGlobalDispatcher(previous); await agent.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
  });
  it("caches valid refreshed catalogs and reloads replacements while rejecting malformed relationships", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-server-catalog-"));
    const cacheDirectory = path.join(dataPath, "server-catalog");
    fs.mkdirSync(cacheDirectory);
    const choices = { countries: ["Synthetic Country"], regions: [], cities: [], hostnames: [], names: [], categories: [], isps: [] };
    const document = { timestamp: 1785990787, protocols: { openvpn: choices, wireguard: choices }, rows: { openvpn: [{ countries: choices.countries }], wireguard: [{ countries: choices.countries }] } };
    const file = path.join(cacheDirectory, "mullvad.json");
    fs.writeFileSync(file, JSON.stringify(document));
    const catalog = new ServerCatalog(dataPath);
    const read = vi.spyOn(fs, "readFileSync");
    try {
      expect(catalog.choices("mullvad", "wireguard", "countries")).toEqual(choices.countries);
      catalog.choices("mullvad", "wireguard", "countries");
      expect(read).toHaveBeenCalledTimes(1);
      expect(catalog.query("mullvad", "wireguard", "countries", "")).toMatchObject({ sourceRevision: "Unknown revision (legacy cache)", retrievedAt: null, sourceUrl: null, runtimeComparison: "unavailable" });
      fs.writeFileSync(file, JSON.stringify({ ...document, timestamp: null }));
      catalog.choices("mullvad", "wireguard", "countries");
      expect(read).toHaveBeenCalledTimes(2);
      fs.writeFileSync(file, JSON.stringify({ ...document, rows: { openvpn: [], wireguard: [{ countries: [123] }] } }));
      expect(catalog.getProvider("mullvad")?.source).toBe("bundled");
    } finally { read.mockRestore(); fs.rmSync(dataPath, { recursive: true, force: true }); }
  });
  it("rejects incompatible filters and narrows choices using server relationships", () => {
    const catalog = new ServerCatalog(fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-server-catalog-")));
    expect(catalog.validateSelection("mullvad", "wireguard", { countries: "Sweden", cities: "London" })).toHaveLength(1);
    expect(catalog.validateSelection("mullvad", "wireguard", { countries: "Sweden", cities: "Stockholm" })).toEqual([]);
    expect(catalog.validateSelection("mullvad", "wireguard", { countries: "Sweden,UK", cities: "London" })).toEqual([]);
    const cities = catalog.query("mullvad", "wireguard", "cities", "", 100, { countries: "Sweden" });
    expect(cities?.values).toContain("Stockholm");
    expect(cities?.values).not.toContain("London");
  });
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
