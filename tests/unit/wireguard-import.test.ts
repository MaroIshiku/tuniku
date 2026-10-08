import { describe, expect, it } from "vitest";
import { importWireguard } from "../../src/client/lib/wireguardImport.js";
import { generateCompose } from "../../src/server/compose/generator.js";

const key = Buffer.alloc(32, 1).toString("base64");
const source = `[Interface]\nPrivateKey = ${key}\nAddress = 10.0.0.2/32, fd00::2/128\nDNS = 10.0.0.1\n[Peer]\nPublicKey = ${Buffer.alloc(32, 2).toString("base64")}\nPresharedKey = ${Buffer.alloc(32, 3).toString("base64")}\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = [2001:db8::1]:51820\n`;

describe("bounded WireGuard import", () => {
  it("maps Interface and Peer values, preserves preshared keys and discloses unapplied DNS", () => {
    const result = importWireguard(source);
    expect(result).toMatchObject({ provider: "custom", vpnType: "wireguard", wireguardPrivateKey: key, wireguardPublicKey: Buffer.alloc(32, 2).toString("base64"), wireguardPresharedKey: Buffer.alloc(32, 3).toString("base64"), wireguardAddresses: "10.0.0.2/32,fd00::2/128", wireguardEndpointIp: "2001:db8::1", wireguardEndpointPort: "51820" });
    expect(result.warnings.join(" ")).toContain("DNS addresses are not applied");
    const { warnings: _warnings, ...values } = result;
    const output = generateCompose({ ...values, wireguardEndpointPort: Number(values.wireguardEndpointPort), taskType: "configure_wireguard" });
    expect(output.validation.valid).toBe(true);
    expect(JSON.stringify(output)).not.toContain(key);
    expect(importWireguard(source.replace("[2001:db8::1]", "203.0.113.1")).wireguardEndpointIp).toBe("203.0.113.1");
  });
  it("rejects hooks, unknown directives, split routes, duplicates and extra peers without echoing secret input", () => {
    for (const invalid of [source + "PostUp = echo synthetic-secret\n", source + "MTU = 1280\n", source + "[Peer]\nPublicKey = invalid\n", source.replace("::/0", "fd00::/64"), source.replace("PrivateKey =", "PrivateKey = invalid\nPrivateKey ="), source + "[Unknown]\nSecret = synthetic-secret\n"]) {
      let failure = ""; try { importWireguard(invalid); } catch (error) { failure = (error as Error).message; }
      expect(failure).not.toBe(""); expect(failure).not.toContain("synthetic-secret"); expect(failure).not.toContain(key);
    }
  });
  it("checks key encoding, CIDRs, literal endpoints, port bounds and input size", () => {
    for (const invalid of [source.replace(key, Buffer.alloc(32).toString("base64")), source.replace("10.0.0.2/32", "10.0.0.2/33"), source.replace("[2001:db8::1]", "vpn.example.test"), source.replace("51820", "70000"), source.replace("51820", "0"), source.replace("10.0.0.1", "invalid-dns"), source.repeat(200)]) expect(() => importWireguard(invalid)).toThrow();
  });
});
