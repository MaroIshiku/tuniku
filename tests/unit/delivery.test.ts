import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("standalone delivery", () => {
  it("uses a ZimaOS-native primary Compose with one visible setup secret", () => {
    const source = fs.readFileSync(path.join(repositoryRoot, "docker-compose.yml"), "utf8");
    const compose = parse(source);

    expect(source).not.toContain("${");
    expect(compose.services.tuniku.image).toBe("ghcr.io/maroishiku/tuniku:0.3.2@sha256:f4b0aba8e31fb44ddd0f18ece2d8d5f198149073ea10ce13d64c9958730cba7c");
    expect(compose.services.tuniku.ports).toEqual([{ target: 8080, published: "65001", protocol: "tcp" }]);
    expect(compose.services.tuniku.environment.ISHIKU_SETUP_SECRET).toBe("");
    expect(compose.services.tuniku.environment.TUNIKU_SESSION_SECRET).toBeUndefined();
    expect(compose.services.tuniku.environment.TUNIKU_ENCRYPTION_KEY).toBeUndefined();
    expect(compose.services.tuniku.secrets).toBeUndefined();
    expect(compose.services.tuniku.depends_on).toBeUndefined();
    expect(JSON.stringify(compose.services.tuniku.volumes)).not.toContain("docker.sock");
    expect(Object.keys(compose.services)).toEqual(["tuniku"]);
    expect(compose.services.tuniku.volumes).toContainEqual({
      type: "bind",
      source: "/DATA/AppData/i_tuniku/Data",
      target: "/data"
    });
    expect(compose["x-casaos"].port_map).toBe("65001");
  });

  it("keeps one file-backed setup secret in the hardened alternative", () => {
    const compose = parse(fs.readFileSync(path.join(repositoryRoot, "docker-compose.example.yml"), "utf8"));

    expect(compose.services.tuniku.ports).toEqual(["65001:8080/tcp"]);
    expect(compose.services.tuniku.secrets).toEqual(["ishiku_setup_secret"]);
    expect(compose.services.tuniku.depends_on).toBeUndefined();
    expect(JSON.stringify(compose.services.tuniku.volumes)).not.toContain("docker.sock");
    expect(Object.keys(compose.secrets)).toEqual(["ishiku_setup_secret"]);
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
