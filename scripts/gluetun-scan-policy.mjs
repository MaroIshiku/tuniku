import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function evaluateGluetunScan(report, architecture, digest, exception, now = new Date()) {
  assert.ok(["amd64", "arm64"].includes(architecture), "Unsupported architecture");
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  const reference = `qmcgaw/gluetun@${digest}`;
  assert.equal(report.SchemaVersion, 2, "Invalid scan schema");
  assert.equal(report.ArtifactType, "container_image", "Invalid artifact type");
  assert.equal(report.ArtifactName, reference, "Scan identity mismatch");
  assert.equal(report.Metadata?.ImageConfig?.architecture, architecture, "Scan architecture mismatch");
  assert.ok(report.Metadata?.RepoDigests?.includes(reference), "Missing scan digest binding");
  assert.ok(Array.isArray(report.Results) && report.Results.length > 0, "Missing scan results");
  const findings = [];
  for (const result of report.Results) {
    assert.ok(result.Vulnerabilities === undefined || Array.isArray(result.Vulnerabilities), "Malformed findings");
    for (const entry of result.Vulnerabilities ?? []) {
      assert.ok(["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(entry.Severity), "Malformed severity");
      if (["HIGH", "CRITICAL"].includes(entry.Severity)) findings.push(entry);
    }
  }
  if (!findings.length) return { status: "PASS", architecture, digest, acceptedFindings: [], exceptionUsed: false };
  assert.equal(exception?.approved, true, "Security exception is not approved");
  assert.ok(now >= new Date(exception.validFrom) && now <= new Date(exception.validUntil), "Security exception is expired or not yet valid");
  assert.equal(exception.architectures[architecture], digest, "Exception does not cover this image");
  const key = (entry) => [entry.VulnerabilityID, entry.PkgName, entry.InstalledVersion, entry.Severity].join("|");
  const accepted = new Set(exception.findings.map(key));
  const seen = new Set();
  for (const finding of findings) {
    assert.equal(finding.Severity, "HIGH", "CRITICAL findings cannot be excepted");
    assert.ok(accepted.has(key(finding)), "New or changed HIGH finding");
    assert.ok(!seen.has(key(finding)), "Unexpected duplicate finding");
    seen.add(key(finding));
  }
  return { status: "PASS_WITH_APPROVED_EXCEPTION", architecture, digest, exceptionUsed: true, validUntil: exception.validUntil, acceptedFindings: findings.map(entry => ({ id: entry.VulnerabilityID, package: entry.PkgName, installed: entry.InstalledVersion })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filename, architecture, digest] = process.argv.slice(2);
  const report = JSON.parse(fs.readFileSync(filename, "utf8"));
  const exception = JSON.parse(fs.readFileSync(".ishiku/decisions/gluetun-high-exception.json", "utf8"));
  const result = evaluateGluetunScan(report, architecture, digest, exception);
  const output = JSON.stringify(result, null, 2) + "\n";
  fs.writeFileSync(`.ishiku/reports/gluetun-release-policy-${architecture}.json`, output);
  process.stdout.write(output);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nGluetun ${architecture}: ${result.status}; ${result.acceptedFindings.length} explicitly accepted HIGH findings. Exception expiry: ${result.validUntil ?? "not used"}.\n`);
}
