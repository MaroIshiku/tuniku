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
    const releaseImage = "ghcr.io/maroishiku/tuniku:0.3.3@sha256:40a83603f67d73ec9cfeb22bde5f11f57fee1278c45a7272e52184a42e7fa606";
    expect(compose.services.tuniku.image).toBe(releaseImage);
    expect(compose.services["tuniku-docker-observer"].image).toBe(releaseImage);
    expect(compose.services.tuniku.ports).toEqual([{ target: 8080, published: "65001", protocol: "tcp" }]);
    expect(compose.services.tuniku.environment.ISHIKU_SETUP_SECRET).toBe("");
    expect(compose.services.tuniku.environment.HTTPS_ONLY).toBe("false");
    expect(compose.services.tuniku.environment.TUNIKU_SESSION_SECRET).toBeUndefined();
    expect(compose.services.tuniku.environment.TUNIKU_ENCRYPTION_KEY).toBeUndefined();
    expect(compose.services.tuniku.secrets).toBeUndefined();
    expect(compose.services.tuniku.depends_on).toBeUndefined();
    expect(JSON.stringify(compose.services.tuniku.volumes)).not.toContain("docker.sock");
    expect(Object.keys(compose.services)).toEqual(["tuniku", "tuniku-docker-observer"]);
    expect(compose.services["tuniku-docker-observer"].volumes).toContainEqual({
      type: "bind",
      source: "/var/run/docker.sock",
      target: "/var/run/docker.sock",
      read_only: true
    });
    expect(compose.services["tuniku-docker-observer"].networks).toEqual(["tuniku_observer"]);
    expect(compose.services["tuniku-docker-observer"].ports).toBeUndefined();
    expect(compose.services["tuniku-docker-observer"].command).toEqual(["dist/server/docker/observerProxy.js"]);
    expect(compose.services["tuniku-docker-observer"].cap_drop).toEqual(["ALL"]);
    expect(compose.services["tuniku-docker-observer"].security_opt).toContain("no-new-privileges:true");
    expect(compose.networks.tuniku_observer.internal).toBe(true);
    expect(compose.services.tuniku.environment.TUNIKU_DOCKER_PROXY_URL).toBe("http://tuniku-docker-observer:2375");
    expect(compose.services.tuniku.environment.TUNIKU_ALLOW_LOOPBACK_UPSTREAM).toBe("false");
    expect(compose.services.tuniku.volumes).toContainEqual({
      type: "bind",
      source: "/DATA/AppData/i_tuniku/Data",
      target: "/data"
    });
    expect(compose["x-casaos"].port_map).toBe("65001");
  });

  it("keeps the Docker observer surface fixed and read-only", () => {
    const source = fs.readFileSync(path.join(repositoryRoot, "src/server/docker/observerProxy.ts"), "utf8");

    expect(source).toContain('request.method !== "GET"');
    expect(source).toContain('url.pathname === "/containers/json"');
    expect(source).toContain("/json$/i");
    expect(source).toContain("/logs$/i");
    expect(source).toContain('url.pathname === "/gluetun/traffic"');
    expect(source).toContain("/stats?stream=false&one-shot=true");
    expect(source).toContain("return value ? [`${name}=`] : []");
    expect(source).not.toContain('method: "POST"');
    expect(source).not.toContain("/exec");
  });

  it("keeps one file-backed setup secret in the hardened alternative", () => {
    const compose = parse(fs.readFileSync(path.join(repositoryRoot, "docker-compose.example.yml"), "utf8"));

    expect(compose.services.tuniku.ports).toEqual(["65001:8080/tcp"]);
    expect(compose.services.tuniku.secrets).toEqual(["ishiku_setup_secret"]);
    expect(compose.services.tuniku.depends_on).toBeUndefined();
    expect(JSON.stringify(compose.services.tuniku.volumes)).not.toContain("docker.sock");
    expect(Object.keys(compose.secrets)).toEqual(["ishiku_setup_secret"]);
    expect(compose.services.gluetun.image).toBe("qmcgaw/gluetun:latest");
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
