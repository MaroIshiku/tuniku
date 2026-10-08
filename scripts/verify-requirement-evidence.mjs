import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const read = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const spec = read("appspec.yaml");
const trace = read(".ishiku/requirements/traceability.yaml");
const evidence = read(".ishiku/evidence/requirements.json");
assert.equal(evidence.schemaVersion, 1);
let verified = 0;
for (const requirement of spec.requirements) {
  const row = trace.requirements.find((entry) => entry.id === requirement.id);
  assert.ok(row, `Missing trace row: ${requirement.id}`);
  if (row.status !== "verified") continue;
  const proof = evidence.requirements.find((entry) => entry.id === row.id);
  assert.equal(proof?.status, "PASS", `Missing executed evidence: ${row.id}`);
  assert.equal(proof.acceptanceSha256, hash(JSON.stringify(requirement.acceptance)), `Acceptance changed: ${row.id}`);
  assert.equal(proof.mappingSha256, hash(JSON.stringify({ implementation: row.implementation, tests: row.tests })), `Test mapping changed: ${row.id}`);
  const mappedFiles = new Set();
  const collect = (name) => {
    const filename = resolve(root, name);
    if (!existsSync(filename)) return; // Executable command strings are recorded separately.
    const info = lstatSync(filename);
    assert.ok(!info.isSymbolicLink(), "Evidence cannot follow symbolic links");
    if (info.isDirectory()) for (const child of readdirSync(filename)) collect(`${name.replace(/\/$/, "")}/${child}`);
    else if (info.isFile()) mappedFiles.add(name);
  };
  for (const name of [...row.implementation, ...Object.values(row.tests).flat()]) collect(name);
  assert.deepEqual(Object.keys(proof.files).sort(), [...mappedFiles].sort(), `Mapped file set changed: ${row.id}`);
  assert.ok(Object.keys(proof.files).length > 0, `Missing source identities: ${row.id}`);
  for (const [name, expected] of Object.entries(proof.files)) {
    const filename = resolve(root, name), inside = relative(root, filename);
    assert.ok(!isAbsolute(name) && inside && !inside.startsWith(".."), "Evidence must use repository-local paths");
    assert.equal(hash(readFileSync(filename)), expected, `Evidence is stale: ${row.id} / ${name}`);
  }
  assert.ok(proof.checks.length > 0, `Missing executed checks: ${row.id}`);
  for (const id of proof.checks) {
    const check = evidence.checks.find((entry) => entry.id === id);
    assert.equal(check?.outcome, "PASS", `Check did not pass: ${row.id} / ${id}`);
    assert.equal(check.exitCode, 0, `Check has no successful exit: ${row.id} / ${id}`);
    assert.ok(check.command && check.scope && check.completedAt && check.artifactSha256, `Incomplete evidence: ${id}`);
  }
  verified++;
}
console.log(`PASS: ${verified} verified requirements have executed checks and matching acceptance, mapping and source hashes; ${trace.requirements.length - verified} remain explicitly unverified.`);
