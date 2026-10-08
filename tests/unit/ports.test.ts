import { expect, it } from "vitest";
import { bindingsOverlap, composeBindings } from "../../src/server/compose/ports.js";
import { generateCompose } from "../../src/server/compose/generator.js";

it("compares host address, protocol and ranges without expanding unbounded arrays", () => {
  const base = { address: "127.0.0.1", first: 8080, last: 8082, protocol: "tcp" as const };
  expect(bindingsOverlap(base, { ...base, address: "127.0.0.2" })).toBe(false);
  expect(bindingsOverlap(base, { ...base, protocol: "udp" })).toBe(false);
  expect(bindingsOverlap(base, { ...base, first: 8083, last: 8084 })).toBe(false);
  expect(bindingsOverlap(base, { ...base, address: "::" })).toBe(true);
  expect(bindingsOverlap(base, { ...base, address: "::ffff:127.0.0.1" })).toBe(true);
  expect(bindingsOverlap({ ...base, address: "2001:db8::1" }, { ...base, address: "2001:0db8:0:0:0:0:0:1" })).toBe(true);
  const parsed = composeBindings({ services: { app: { ports: ["[::1]:8000-8002:80-82/udp", { host_ip: "127.0.0.1", published: "9000-9002", target: 90, protocol: "tcp" }, "80", "${HOST_PORT}:80"] } } });
  expect(parsed.unresolved).toBe(true); expect(parsed.bindings).toHaveLength(2);
  expect(parsed.bindings[0]).toMatchObject({ address: "::1", first: 8000, last: 8002, protocol: "udp" });
});

it("rejects overlapping Compose host ranges and allows different addresses, protocols and identical existing Gluetun mappings", () => {
  const input = { taskType: "publish_app_port" as const, hostAddress: "127.0.0.1", hostPort: 8081, containerPort: 80, protocol: "tcp" as const };
  expect(generateCompose({ ...input, pastedCompose: 'services:\n  other:\n    ports: ["0.0.0.0:8080-8082:80-82/tcp"]\n' }).validation.valid).toBe(false);
  expect(generateCompose({ ...input, pastedCompose: 'services:\n  other:\n    ports: ["127.0.0.2:8081:80/tcp"]\n' }).validation.valid).toBe(true);
  expect(generateCompose({ ...input, pastedCompose: 'services:\n  other:\n    ports: ["8081:80/udp"]\n' }).validation.valid).toBe(true);
  expect(generateCompose({ ...input, pastedCompose: 'services:\n  gluetun:\n    ports: ["127.0.0.1:8081:80/tcp"]\n' }).validation.valid).toBe(true);
  expect(generateCompose({ ...input, pastedCompose: 'services:\n  other:\n    ports: ["${HOST_PORT}:80"]\n' }).validation.warnings.join(" ")).toContain("Interpolated host bindings");
});
