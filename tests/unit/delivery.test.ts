import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("standalone delivery", () => {
  it("publishes the centrally assigned host port and pins Gluetun", () => {
    const compose = parse(fs.readFileSync(path.join(repositoryRoot, "docker-compose.example.yml"), "utf8"));

    expect(compose.services.tuniku.ports).toEqual(["65001:8080/tcp"]);
    expect(compose.services.gluetun.image).toMatch(
      /^ghcr\.io\/qdm12\/gluetun:v3\.41\.3@sha256:[a-f0-9]{64}$/
    );
  });

  it("references separate standard and maskable PWA icons", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "public/manifest.webmanifest"), "utf8")
    ) as { icons: Array<{ src: string; purpose?: string }> };

    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/assets/icons/icon-192.png", purpose: "any" }),
        expect.objectContaining({ src: "/assets/icons/icon-512.png", purpose: "any" }),
        expect.objectContaining({ src: "/assets/icons/icon-maskable-512.png", purpose: "maskable" })
      ])
    );
    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(repositoryRoot, "public", icon.src))).toBe(true);
    }
  });

  it("refreshes the service-worker cache for the replacement assets", () => {
    const worker = fs.readFileSync(path.join(repositoryRoot, "public/sw.js"), "utf8");

    expect(worker).toContain('const CACHE = "tuniku-shell-v2"');
    expect(worker).toContain('"/assets/icons/favicon-32.png"');
    expect(worker).toContain('"/assets/icons/icon-maskable-512.png"');
  });
});
