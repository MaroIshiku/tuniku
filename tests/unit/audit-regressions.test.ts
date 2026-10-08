import { afterEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns/promises";
import { generateKeyPairSync } from "node:crypto";
import material from "../fixtures/synthetic-openvpn.json";
import YAML from "yaml";
import { Response } from "undici";
import { generateCompose, inspectCompose, redactedDraftInput, validateCompose } from "../../src/server/compose/generator.js";
import { redactText, safeLookup, validateUpstreamUrl } from "../../src/server/security.js";
import { readBoundedBody } from "../../src/server/http.js";

afterEach(() => vi.restoreAllMocks());

describe("Compose safety regressions", () => {
  it("enforces documented provider endpoint ports and IVPN credential requirements", () => {
    for (const [provider, ports] of [["ivpn", [53, 2049, 2050, 30587, 41893, 48574, 58237]], ["windscribe", [53, 80, 123, 443, 1194, 65142]]] as const) {
      const input = { taskType: "configure_wireguard" as const, provider, vpnType: "wireguard" as const, wireguardPrivateKey: Buffer.alloc(32, 1).toString("base64"), wireguardAddresses: "10.0.0.2/32", wireguardPresharedKey: provider === "windscribe" ? Buffer.alloc(32, 2).toString("base64") : "" };
      for (const port of ports) expect(generateCompose({ ...input, providerOptions: { WIREGUARD_ENDPOINT_PORT: String(port) } }).validation.valid).toBe(true);
      expect(() => generateCompose({ ...input, providerOptions: { WIREGUARD_ENDPOINT_PORT: "51820" } })).toThrow(/unsupported value/);
    }
    const input = { taskType: "configure_openvpn" as const, provider: "ivpn", vpnType: "openvpn" as const };
    expect(generateCompose({ ...input, openvpnUser: "ivpn-ab12-cd34-ef56" }).validation.valid).toBe(true);
    expect(() => generateCompose({ ...input, openvpnUser: "synthetic@example.test" })).toThrow(/password/);
    expect(generateCompose({ ...input, openvpnUser: "synthetic@example.test", openvpnPassword: "synthetic-password" }).validation.valid).toBe(true);
  });
  it("checks OpenVPN certificate syntax and matching private keys before secret redaction", () => {
    const input = { taskType: "configure_openvpn" as const, provider: "vpn unlimited", vpnType: "openvpn" as const, openvpnUser: "synthetic-user", openvpnPassword: "synthetic-password", openvpnCertificate: material.certificate, openvpnKey: material.privateKey };
    const result = generateCompose(input);
    expect(result.validation.valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain(material.privateKey);
    expect(generateCompose({ ...input, openvpnCertificate: `-----BEGIN CERTIFICATE-----\n${material.certificate}\n-----END CERTIFICATE-----` }).validation.valid).toBe(true);
    for (const certificate of ["synthetic-invalid-certificate", Buffer.from("synthetic-invalid-der").toString("base64"), "-----BEGIN CERTIFICATE-----\nabc\n-----END PRIVATE KEY-----"]) {
      expect(() => generateCompose({ ...input, openvpnCertificate: certificate })).toThrow(/valid X.509/);
    }
    expect(() => generateCompose({ ...input, openvpnKey: "synthetic-invalid-key" })).toThrow(/unencrypted private key/);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(() => generateCompose({ ...input, openvpnKey: other })).toThrow(/do not match/);
  });
  it("exports an opt-in env package with one configuration source and matching credentials", () => {
    const input = { taskType: "new_gluetun_setup" as const, provider: "private internet access", vpnType: "openvpn" as const, openvpnUser: "user", openvpnPassword: "x$VALUE${OTHER}$$ end", authMode: "api_key" as const, apiKey: "synthetic-control-key", includeSecrets: true };
    const direct = generateCompose(input);
    const packaged = generateCompose({ ...input, useEnvFile: true });
    const service = YAML.parse(packaged.snippets.compose).services.gluetun;
    expect(service.environment).toBeUndefined();
    expect(service.env_file).toEqual(["./gluetun.optional.env"]);
    expect(packaged.snippets.env).toBe(direct.snippets.env);
    expect(packaged.artifacts.find((artifact) => artifact.filename === "gluetun.optional.env")?.content).toBe(packaged.snippets.env);
    expect(packaged.snippets.steps).toContain("0600");
    expect(packaged.snippets.steps).toContain("restart alone does not reload");
    expect(YAML.parse(direct.snippets.compose).services.gluetun.env_file).toBeUndefined();
    const redacted = generateCompose({ ...input, useEnvFile: true, includeSecrets: false });
    expect(JSON.stringify(redacted)).not.toContain("synthetic-control-key");
  });
  it("rejects invalid WireGuard keys, CIDRs and endpoints before redaction", () => {
    const validKey = Buffer.alloc(32, 1).toString("base64");
    const input = { taskType: "configure_wireguard" as const, provider: "mullvad", vpnType: "wireguard" as const, wireguardPrivateKey: validKey, wireguardAddresses: "10.0.0.2/32,fd00::2/128" };
    expect(generateCompose(input).validation.valid).toBe(true);
    for (const key of ["synthetic-invalid-key", "[REDACTED]", Buffer.alloc(32).toString("base64"), validKey.slice(0, -1), validKey.slice(0, -2) + "F="]) {
      expect(() => generateCompose({ ...input, wireguardPrivateKey: key })).toThrow(/32-byte key/);
    }
    for (const address of ["10.0.0.2", "10.0.0.2/33", "fd00::2/129", "999.0.0.2/32", "10.0.0.2/-1", "10.0.0.2/32,"]) {
      expect(() => generateCompose({ ...input, wireguardAddresses: address })).toThrow(/CIDRs/);
    }
    expect(() => generateCompose({ ...input, provider: "custom", wireguardPublicKey: validKey, wireguardEndpointIp: "invalid", wireguardEndpointPort: 51820 })).toThrow(/endpoint/);
  });

  it("checks pasted Compose port syntax, bounds, ranges and namespace references", () => {
    for (const port of ["70000:5800", "5800:0", "9000-8000:80", "8000-8002:80-81", "bad:8000:80", "8000:80/sctp", { target: 70000 }, { target: 80, published: "70000" }]) {
      expect(validateCompose(YAML.stringify({ services: { app: { ports: [port] } } })).valid).toBe(false);
    }
    for (const port of ["5800:5800", "[::1]:5800:5800/udp", "127.0.0.1:8000-8002:80-82", "80", { target: 80, published: "8000-8002", protocol: "tcp", host_ip: "::1" }]) {
      expect(validateCompose(YAML.stringify({ services: { app: { ports: [port] } } })).valid).toBe(true);
    }
    expect(validateCompose("services:\n  app:\n    network_mode: service:missing\n").valid).toBe(false);
  });

  it("redacts URL userinfo in mappings, lists, drafts and diagnostic logs", () => {
    const url = "postgres://synthetic-url-user:synthetic-url-password@example.test/db";
    const source = YAML.stringify({ services: { app: { environment: { CONNECTION_URL: url }, labels: [url] } } });
    expect(JSON.stringify(inspectCompose(source))).not.toContain("synthetic-url-");
    expect(JSON.stringify(redactedDraftInput({ taskType: "review_existing_configuration", pastedCompose: source }))).not.toContain("synthetic-url-");
    expect(redactText(`Connection failed: ${url}`)).toContain("postgres://[REDACTED]@example.test/db");
  });

  it("redacts list-form credentials, PEM values and malformed source without leaking them in errors", () => {
    const pastedCompose = "services:\n  gluetun:\n    environment:\n      - OPENVPN_PASSWORD=synthetic-list-secret\n      - OPENVPN_USER=synthetic-user\n      - VPN_TYPE=openvpn\n";
    const inspected = inspectCompose(pastedCompose);
    expect(JSON.stringify(inspected)).not.toContain("synthetic-list-secret");
    expect(JSON.stringify(inspected)).not.toContain("synthetic-user");
    expect(inspected.redacted).toContain("VPN_TYPE=openvpn");
    const malformed = inspectCompose("services: [synthetic-malformed-secret");
    expect(malformed.valid).toBe(false);
    expect(JSON.stringify(malformed)).not.toContain("synthetic-malformed-secret");
    const draft = redactedDraftInput({ taskType: "configure_openvpn", openvpnKey: "synthetic-private-key", openvpnCertificate: "synthetic-cert", basicUsername: "synthetic-basic-user", pastedCompose });
    expect(JSON.stringify(draft)).not.toContain("synthetic-");
    const syntheticPem = ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\nsynthetic-pem\n-----END PRIVATE KEY-----";
    expect(redactText(`2026-09-17 INFO OPENVPN_PASSWORD=synthetic-log-secret\n${syntheticPem}`)).not.toContain("synthetic-");
  });

  it("preserves literal dollars in credentials and emits only the selected task's fields", () => {
    const result = generateCompose({ taskType: "new_gluetun_setup", provider: "private internet access", vpnType: "openvpn", openvpnUser: "user", openvpnPassword: "x$VALUE${OTHER}$$ end", authMode: "api_key", apiKey: "key$VALUE", includeSecrets: true });
    const env = YAML.parse(result.snippets.compose).services.gluetun.environment;
    expect(env.OPENVPN_PASSWORD).toBe("x$$VALUE$${OTHER}$$$$ end");
    expect(JSON.parse(env.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE).apikey).toBe("key$$VALUE");
    expect(result.snippets.env).toContain('OPENVPN_PASSWORD="x$$VALUE$${OTHER}$$$$ end"');
    const port = generateCompose({ taskType: "publish_app_port", hostPort: 5800, containerPort: 5800, provider: "protonvpn", vpnType: "wireguard", wireguardPrivateKey: "stale-secret", authMode: "none" });
    const doc = YAML.parse(port.snippets.compose);
    expect(doc.services.gluetun).toEqual({ environment: {}, ports: ["5800:5800/tcp"] });
    expect(port.snippets.compose).not.toContain("stale-secret");
    expect(port.snippets.compose).not.toContain("volumes");
  });

  it("keeps review output tied to the pasted stack and resolves ordinary Compose anchors safely", () => {
    const source = "x-env: &env\n  OPENVPN_PASSWORD: synthetic-review-secret\nservices:\n  gluetun:\n    image: qmcgaw/gluetun:latest\n    environment: *env\n  downloader:\n    image: example/downloader:latest\n";
    const result = generateCompose({ taskType: "review_existing_configuration", pastedCompose: source });
    expect(result.validation.valid).toBe(true);
    expect(result.snippets.compose).toContain("downloader:");
    expect(JSON.stringify(result)).not.toContain("synthetic-review-secret");
    expect(validateCompose("services:\n  a:\n    image: example/app\n    network_mode: service:gluetun\n    networks: [default]\n").valid).toBe(false);
  });

  it("rejects reserved routing targets, missing ports and invalid bind addresses", () => {
    expect(() => generateCompose({ taskType: "route_app_manually", appName: "gluetun", hostPort: 5800, containerPort: 5800 })).toThrow(/application name/);
    expect(() => generateCompose({ taskType: "publish_app_port" })).toThrow(/required/);
    expect(() => generateCompose({ taskType: "publish_app_port", hostPort: 5800, containerPort: 5800, hostAddress: "bad:address" })).toThrow(/IPv4 or IPv6/);
    const ipv6 = generateCompose({ taskType: "publish_app_port", hostPort: 5800, containerPort: 5800, hostAddress: "::1" });
    expect(YAML.parse(ipv6.snippets.compose).services.gluetun.ports).toEqual(["[::1]:5800:5800/tcp"]);
    const collision = generateCompose({ taskType: "publish_app_port", hostPort: 5800, containerPort: 5800, pastedCompose: "services:\n  other:\n    ports:\n      - target: 5800\n        published: '5800'\n" });
    expect(collision.validation.valid).toBe(false);
    expect(collision.validation.errors.join()).toContain("collision");
  });
});

describe("outbound request safety", () => {
  it("blocks literal and IPv4-mapped metadata and loopback destinations", async () => {
    for (const url of ["http://127.0.0.1", "http://169.254.169.254", "http://[::ffff:127.0.0.1]", "http://[::ffff:169.254.169.254]", "http://[ff02::1]", "http://[::1]"]) {
      await expect(validateUpstreamUrl(url, false)).rejects.toThrow(/blocked/);
    }
    await expect(validateUpstreamUrl("http://[::1]", true)).resolves.toBe("http://[::1]");
    await expect(validateUpstreamUrl("http://192.168.1.5:8000", false)).resolves.toBe("http://192.168.1.5:8000");
  });

  it("revalidates the socket DNS result after a successful preflight", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValueOnce([{ address: "192.168.1.5", family: 4 }] as any)
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as any);
    await expect(validateUpstreamUrl("http://gluetun.test", false)).resolves.toBe("http://gluetun.test");
    const error = await new Promise<Error | null>((resolve) => safeLookup(false)("gluetun.test", { all: true }, (error) => resolve(error)));
    expect(error?.message).toMatch(/blocked/);
  });

  it("bounds both declared and streamed response bodies", async () => {
    await expect(readBoundedBody(new Response("small"), 10)).resolves.toEqual(Buffer.from("small"));
    await expect(readBoundedBody(new Response("too large", { headers: { "content-length": "100" } }), 5)).rejects.toThrow(/limit/);
    await expect(readBoundedBody(new Response("too large"), 5)).rejects.toThrow(/limit/);
  });
});
