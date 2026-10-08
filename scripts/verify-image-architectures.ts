import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { architectureDigests } from "./image-architectures.ts";

const image = process.env.IMAGE, digest = process.env.DIGEST, revision = process.env.GITHUB_SHA;
if (!image || !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image) || !digest || !/^sha256:[a-f0-9]{64}$/.test(digest) || !revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid candidate identity.");
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const index = JSON.parse(docker("buildx", "imagetools", "inspect", `${image}@${digest}`, "--raw"));
const architectures = architectureDigests(index);
const results: unknown[] = [];
for (const architecture of ["amd64", "arm64"] as const) {
  const reference = `${image}@${architectures[architecture]}`;
  docker("pull", "--platform", `linux/${architecture}`, reference);
  const metadata = JSON.parse(docker("image", "inspect", reference))[0];
  assert.equal(metadata.Architecture, architecture);
  assert.equal(metadata.Config.Labels["org.opencontainers.image.revision"], revision);
  // Use the immutable local image ID after checking its digest/revision/architecture.
  const output = execFileSync(process.execPath, ["scripts/verify-container-lifecycle.ts"], { encoding: "utf8", timeout: 600_000, env: { ...process.env, TUNIKU_TEST_IMAGE: metadata.Id } });
  const runtime = JSON.parse(output.trim());
  assert.equal(runtime.result, "PASS"); assert.equal(runtime.architecture, architecture); assert.equal(runtime.imageId, metadata.Id);
  results.push({ architecture, manifestDigest: architectures[architecture], sourceRevision: revision, runtime });
}
fs.writeFileSync("architecture-runtime-report.json", JSON.stringify({ candidateDigest: digest, image, results }, null, 2) + "\n");
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `amd64_digest=${architectures.amd64}\narm64_digest=${architectures.arm64}\n`);
console.log(JSON.stringify({ candidateDigest: digest, architectures }));
