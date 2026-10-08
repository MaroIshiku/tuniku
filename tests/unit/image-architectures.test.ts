import { expect, it } from "vitest";
import { architectureDigests } from "../../scripts/image-architectures.js";

it("selects exactly one digest per required architecture while excluding attestation manifests", () => {
  const amd = { platform: { os: "linux", architecture: "amd64" }, digest: `sha256:${"a".repeat(64)}` };
  const arm = { platform: { os: "linux", architecture: "arm64" }, digest: `sha256:${"b".repeat(64)}` };
  const manifests = [amd, arm, { platform: { os: "unknown", architecture: "unknown" }, digest: `sha256:${"c".repeat(64)}` }];
  expect(architectureDigests({ manifests })).toEqual({ amd64: amd.digest, arm64: arm.digest });
  expect(() => architectureDigests({ manifests: [amd] })).toThrow(/arm64/);
  expect(() => architectureDigests({ manifests: [...manifests, arm] })).toThrow(/exactly one/);
  expect(() => architectureDigests({ manifests: [amd, { ...arm, digest: "latest" }] })).toThrow(/immutable/);
  expect(() => architectureDigests({ manifests: [amd, { ...arm, digest: amd.digest }] })).toThrow(/distinct/);
  expect(() => architectureDigests(null)).toThrow(/index/);
});
