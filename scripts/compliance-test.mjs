#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(process.argv[2] ?? ".");
const readJson = (filename) => JSON.parse(readFileSync(filename, "utf8"));
const project = readJson(join(repo, ".ishiku", "project.yaml"));
const spec = readJson(join(repo, "appspec.yaml"));
const override = readJson(join(repo, ".ishiku", "overrides", "gluetun-latest.json"));

assert.equal(project.platform.locale, "en");
assert.equal(spec.application.locale, "en");
const expectedAuth = project.application.id === "dropiku" ? "dropiku-totp-vault" : project.application.id === "meiku" ? "meiku-client-vault" : "standard-account";
assert.equal(project.platform.authentication, expectedAuth);
assert.ok(spec.requirements.length > 0);
assert.equal(new Set(spec.requirements.map((item) => item.id)).size, spec.requirements.length);

assert.equal(override.id, "OVR-001");
assert.equal(override.policy, "dependencies.floating_tags_forbidden");
assert.ok(override.reason.length >= 20);
assert.ok(override.security_assessment.length >= 20);
assert.ok(Array.isArray(override.tests) && override.tests.length > 0);
assert.ok(Date.parse(`${override.review_date}T23:59:59Z`) >= Date.now(), "OVR-001 has expired and qmcgaw/gluetun:latest must be reviewed.");

const workflowRoot = join(repo, ".github", "workflows");
for (const name of readdirSync(workflowRoot).filter((name) => /\.ya?ml$/i.test(name))) {
  const body = readFileSync(join(workflowRoot, name), "utf8");
  for (const match of body.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g)) {
    if (!match[1].startsWith("./") && !match[1].startsWith("docker://")) assert.match(match[2], /^[a-f0-9]{40}$/);
  }
  assert.match(body, /permissions:/);
  assert.doesNotMatch(body, /(?:\.\.\/)+(?:\.ishiku|planning|private)/);
}

for (const name of ["Dockerfile", "docker-compose.yml", "docker-compose.example.yml", "compose.yaml"]) {
  const filename = join(repo, name);
  if (!existsSync(filename)) continue;
  const body = readFileSync(filename, "utf8");
  assert.doesNotMatch(body, /(?:adminadmin|CHANGE-ME-seediku|192\.168\.1\.110)/i);
  assert.doesNotMatch(body, /[A-Za-z]:\\Users\\/i);
  for (const match of body.matchAll(/image:\s*([^\s]+:latest)(?:\s|$)/gi)) {
    assert.equal(match[1], "qmcgaw/gluetun:latest", `Unapproved floating image in ${name}`);
  }
}

process.stdout.write(`ishiku compliance checks passed for ${project.application.id} with active OVR-001.\n`);
