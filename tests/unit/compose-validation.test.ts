import { expect, it } from "vitest";
import YAML from "yaml";
import { generateCompose, inspectCompose, validateCompose } from "../../src/server/compose/generator.js";

it("separates YAML, provider, Compose structure, CLI and runtime evidence including invalid review source", () => {
  const valid = generateCompose({ taskType: "new_gluetun_setup", provider: "protonvpn", vpnType: "wireguard", wireguardPrivateKey: Buffer.alloc(32, 1).toString("base64"), authMode: "api_key", apiKey: "synthetic-validation-key" });
  expect(valid.validation.checks.map(check => [check.id, check.status])).toEqual([["yaml", "passed"], ["provider", "passed"], ["compose_structure", "passed"], ["compose_cli", "not_run"], ["runtime", "not_run"]]);
  expect(valid.validation.checks.find(check => check.id === "provider")?.detail).toContain("No account login or VPN handshake");
  const malformed = generateCompose({ taskType: "review_existing_configuration", pastedCompose: "services: [synthetic-secret" });
  expect(malformed.validation.checks.map(check => check.status)).toEqual(["failed", "not_applicable", "not_run", "not_run", "not_run"]);
  expect(JSON.stringify(malformed)).not.toContain("synthetic-secret");
  const invalid = generateCompose({ taskType: "review_existing_configuration", pastedCompose: "services:\n  app:\n    ports: ['70000:80']\n" });
  expect(invalid.validation.checks.map(check => check.status)).toEqual(["passed", "not_applicable", "failed", "not_run", "not_run"]);
  const fragment = generateCompose({ taskType: "publish_app_port", hostPort: 8080, containerPort: 80 });
  expect(fragment.validation.valid).toBe(true);
  expect(fragment.validation.checks.find(check => check.id === "compose_structure")?.detail).toContain("complete merged stack");
});

it("rejects invalid service structures and missing references while accepting optional dependencies and declared mounts", () => {
  for (const service of [{ environment: true }, { environment: { PASSWORD: {} } }, { environment: ["PASSWORD=a", "PASSWORD=b"] }, { env_file: [] }, { env_file: { path: "", required: "yes" } }, { depends_on: "missing" }, { depends_on: ["missing"] }, { depends_on: ["app"] }, { depends_on: { app: { condition: "invalid" } } }, { networks: ["missing"] }, { volumes: ["missing:/data"] }, { volumes: { target: "/data" } }, { volumes: [{ type: "bind" }] }]) {
    expect(validateCompose(YAML.stringify({ services: { app: service } })).valid).toBe(false);
  }
  const valid = { services: { app: { image: "synthetic:local", environment: { VALUE: 1, EMPTY: null }, env_file: [{ path: "optional.env", required: false, format: "raw" }], depends_on: { absent: { condition: "service_started", required: false } }, networks: { private: { aliases: ["example"] } }, volumes: ["data:/data", "./config:/config:ro", "/anonymous"] } }, networks: { private: {} }, volumes: { data: {} } };
  expect(validateCompose(YAML.stringify(valid)).valid).toBe(true);
  expect(validateCompose(YAML.stringify({ services: { app: { environment: { VALUE: true } } } }))).toMatchObject({ valid: true, warnings: [expect.stringContaining("quote these values")] });
});

it("reports unresolved sources and mixed environment precedence without reading files or returning secret values", () => {
  const source = YAML.stringify({ services: { gluetun: { env_file: "./not-read.env", environment: ["OPENVPN_PASSWORD=synthetic-precedence-secret", "VALUE=${DEPLOYMENT_VALUE}"] } } });
  const inspected = inspectCompose(source);
  expect(inspected.warnings.join(" ")).toContain("Environment takes precedence");
  expect(inspected.warnings.join(" ")).toContain("have not been resolved");
  expect(inspected.warnings.join(" ")).toContain("have not been read or checked");
  expect(JSON.stringify(inspected)).not.toContain("synthetic-precedence-secret");
  const review = generateCompose({ taskType: "review_existing_configuration", pastedCompose: source });
  expect(review.validation.warnings.join(" ")).toContain("Environment takes precedence");
  expect(review.validation.checks.filter(check => check.status === "not_run").map(check => check.id)).toEqual(["compose_cli", "runtime"]);
});

it("validates volume and env path syntax without inspecting or reflecting host data", () => {
  for (const volumes of [["./data:relative"], ["./a:/data", "./b:/data/"], [{ type: "bind", target: "/data" }], [{ type: "bind", source: "/synthetic-private", target: "/data", read_only: "yes" }], ["./a:/../escape"]]) {
    const result = inspectCompose(YAML.stringify({ services: { app: { image: "example/app:1", volumes } } }));
    expect(result.valid).toBe(false); expect(result.errors.join(" ")).not.toContain("synthetic-private");
  }
  const good = inspectCompose(YAML.stringify({ services: { app: { image: "example/app:1", env_file: "../private.env", volumes: [{ type: "bind", source: "./config", target: "/config", read_only: true, bind: { create_host_path: false } }, "named:/data"] } }, volumes: { named: {} } }));
  expect(good.valid).toBe(true); expect(good.warnings.join(" ")).toContain("owner permissions");
  expect(good.warnings.join(" ")).toContain("deployment-directory review");
  const bad = inspectCompose(YAML.stringify({ services: { app: { env_file: "private\n.env" } } }));
  expect(bad.valid).toBe(false);
});
