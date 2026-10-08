import fs from "node:fs";
import { expect, it } from "vitest";
import YAML from "yaml";

const workflow = (name: string) => YAML.parse(fs.readFileSync(`.github/workflows/${name}.yml`, "utf8"));

it("requires the Gluetun security gate before either channel can write candidates to the registry", () => {
  for (const name of ["container", "ishiku-release-release"]) {
    const jobs = workflow(name).jobs;
    expect(jobs.gluetun.uses).toBe("./.github/workflows/tuniku-upstream-discovery.yml");
    expect(jobs.publish.needs).toEqual(expect.arrayContaining(["verify", "gluetun"]));
    expect(jobs.publish.if ?? "").not.toMatch(/always\(|failure\(|cancelled\(/);
    expect(jobs.verify.with.require_all_verified).toBe(true);
  }
});

it("scans both discovered immutable architectures independently and fails on high findings without write access", () => {
  const gate = workflow("tuniku-upstream-discovery");
  expect(Object.hasOwn(gate.on, "workflow_call")).toBe(true);
  expect(gate.permissions).toEqual({ contents: "read" });
  const steps = gate.jobs.discover.steps;
  const scans = steps.filter((step: { uses?: string }) => step.uses?.startsWith("aquasecurity/trivy-action@"));
  expect(scans).toHaveLength(2);
  for (const [index, architecture] of ["amd64", "arm64"].entries()) {
    const scan = scans[index];
    expect(scan.uses).toMatch(/^aquasecurity\/trivy-action@[a-f0-9]{40}$/);
    expect(scan.if).toBe("always() && steps.sources.outcome == 'success'");
    expect(scan.env.TRIVY_PLATFORM).toBe(`linux/${architecture}`);
    expect(scan.with["image-ref"]).toBe(`qmcgaw/gluetun@\${{ steps.sources.outputs.gluetun_${architecture}_digest }}`);
    expect(scan.with.severity).toBe("HIGH,CRITICAL");
    expect(scan.with["ignore-unfixed"]).toBe(false);
    expect(scan.with["exit-code"]).toBe(1);
    expect(scan["continue-on-error"]).toBeUndefined();
  }
  expect(gate.jobs.discover["continue-on-error"]).toBeUndefined();
});
