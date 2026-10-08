import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { imageRevision, promotionDecision } from "./release-policy.ts";

const image = process.env.IMAGE, digest = process.env.DIGEST, revision = process.env.GITHUB_SHA;
if (!image || !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(image) || !digest || !/^sha256:[a-f0-9]{64}$/.test(digest) || !revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid promotion identity.");
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const config = (ref: string) => JSON.parse(docker("buildx", "imagetools", "inspect", ref, "--format", "{{json .Image}}")) as unknown;
if (imageRevision(config(`${image}@${digest}`)) !== revision) throw new Error("Candidate digest does not identify this source commit.");
// A missing or unreadable latest is deliberately not treated as permission to overwrite.
const previousInfo = docker("buildx", "imagetools", "inspect", `${image}:latest`);
const previousDigest = previousInfo.match(/^Digest:\s*(sha256:[a-f0-9]{64})\s*$/m)?.[1];
if (!previousDigest) throw new Error("Previous latest digest is unavailable.");
const previousRevision = imageRevision(config(`${image}@${previousDigest}`));
const ancestor = (a: string, b: string) => {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", a, b], { encoding: "utf8" });
  if (result.status !== 0 && result.status !== 1) throw new Error("Source ancestry is unavailable; use a full-history checkout.");
  return result.status === 0;
};
const decision = promotionDecision(revision, previousRevision, ancestor);
const version = process.env.VERSION;
if (version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Only stable version tags are supported.");
  for (const tag of [`v${version}`, version]) {
    const existing = spawnSync("docker", ["buildx", "imagetools", "inspect", `${image}:${tag}`], { encoding: "utf8", timeout: 120_000 });
    if (existing.status === 0) throw new Error("Version tags are immutable and already exist.");
    if (!/manifest unknown|manifest_unknown|not found/i.test(existing.stderr || "")) throw new Error("Version tag availability could not be established.");
  }
  docker("buildx", "imagetools", "create", "--tag", `${image}:v${version}`, "--tag", `${image}:${version}`, `${image}@${digest}`);
}
if (decision === "promote") docker("buildx", "imagetools", "create", "--tag", `${image}:latest`, `${image}@${digest}`);
const report = { image, candidateDigest: digest, sourceRevision: revision, previousDigest, previousRevision, decision };
fs.writeFileSync("promotion-report.json", JSON.stringify(report, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nLatest promotion: ${decision}\nCandidate: ${image}@${digest}\nSource: ${revision}\nPrevious: ${image}@${previousDigest}\n`);
console.log(JSON.stringify(report));
