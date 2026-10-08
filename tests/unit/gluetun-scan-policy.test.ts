import fs from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error Clone-local Node policy module intentionally has no TypeScript declaration.
import { evaluateGluetunScan } from "../../scripts/gluetun-scan-policy.mjs";
const exception = JSON.parse(fs.readFileSync(".ishiku/decisions/gluetun-high-exception.json", "utf8"));
const now = new Date("2026-10-08T12:00:00Z");
const report = (arch = "amd64") => ({ SchemaVersion: 2, ArtifactType: "container_image", ArtifactName: `qmcgaw/gluetun@${exception.architectures[arch]}`, Metadata: { ImageConfig: { architecture: arch }, RepoDigests: [`qmcgaw/gluetun@${exception.architectures[arch]}`] }, Results: [{ Vulnerabilities: structuredClone(exception.findings) }] });
describe("bounded official Gluetun exception", () => {
  it.each(["amd64", "arm64"])("accepts only the approved %s identities", arch => { expect(evaluateGluetunScan(report(arch), arch, exception.architectures[arch], exception, now).status).toBe("PASS_WITH_APPROVED_EXCEPTION"); });
  it("rejects expired and unapproved decisions", () => {
    expect(() => evaluateGluetunScan(report(), "amd64", exception.architectures.amd64, exception, new Date("2026-10-23T00:00:00Z"))).toThrow();
    expect(() => evaluateGluetunScan(report(), "amd64", exception.architectures.amd64, { ...exception, approved: false }, now)).toThrow();
  });
  it("rejects new HIGH, CRITICAL and changed package versions", () => {
    for (const change of [{ VulnerabilityID: "CVE-2026-999999" }, { Severity: "CRITICAL" }, { InstalledVersion: "different" }]) {
      const changed = report(); Object.assign(changed.Results[0]!.Vulnerabilities[0], change);
      expect(() => evaluateGluetunScan(changed, "amd64", exception.architectures.amd64, exception, now)).toThrow();
    }
  });
  it("rejects another image, mismatched architecture and missing results", () => {
    for (const changed of [{ ...report(), ArtifactName: "another-image" }, { ...report(), Metadata: { ImageConfig: { architecture: "arm64" }, RepoDigests: [] } }, { ...report(), Results: [] }]) expect(() => evaluateGluetunScan(changed, "amd64", exception.architectures.amd64, exception, now)).toThrow();
  });
  it("accepts a genuinely clean image without relying on an expired exception", () => {
    const clean = report(); clean.Results[0]!.Vulnerabilities = [];
    expect(evaluateGluetunScan(clean, "amd64", exception.architectures.amd64, exception, new Date("2026-10-23T00:00:00Z")).exceptionUsed).toBe(false);
  });
});
