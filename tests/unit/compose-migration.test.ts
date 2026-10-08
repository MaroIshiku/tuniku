import YAML from "yaml";
import { expect, it } from "vitest";
import { reviewComposeMigration } from "../../src/server/compose/migrationReview.js";
const base = { name: "vpn-project", services: { gluetun: { image: "qmcgaw/gluetun:latest", environment: { OPENVPN_PASSWORD: "synthetic-old-secret" }, volumes: ["vpn-data:/gluetun"], labels: { owner: "synthetic-owner" } }, downloader: { image: "example/app:1", network_mode: "service:gluetun", volumes: ["downloads:/downloads"] } }, volumes: { "vpn-data": {}, downloads: {} } };
it("reports protected migration changes and configuration-only changes without outputting values", () => {
  const next = structuredClone(base); next.services.gluetun.environment.OPENVPN_PASSWORD = "synthetic-new-secret";
  const review = reviewComposeMigration(YAML.stringify(base), YAML.stringify(next));
  expect(review.status).toBe("READY_FOR_OWNER_REVIEW"); expect(review.requiresOwnerReview).toBe(true); expect(review.appliesChanges).toBe(false);
  expect(review.changes).toEqual([{ service: "gluetun", field: "environment", protected: false }]);
  expect(JSON.stringify(review)).not.toMatch(/synthetic-old-secret|synthetic-new-secret|synthetic-owner/);
  next.services.downloader.volumes = ["other:/downloads"]; Object.assign(next.volumes, { other: {} });
  expect(reviewComposeMigration(YAML.stringify(base), YAML.stringify(next)).status).toBe("PROTECTED_SETTINGS_CHANGED");
  expect(reviewComposeMigration(YAML.stringify(base), YAML.stringify({ services: { gluetun: { image: "qmcgaw/gluetun:latest" } } })).changes).toContainEqual({ service: "downloader", field: "service_removed", protected: true });
});
it("rejects invalid or unresolved complete inputs without exposing parser data", () => {
  const review = reviewComposeMigration(YAML.stringify(base), "services: [synthetic-secret]");
  expect(review.status).toBe("INVALID_INPUT"); expect(JSON.stringify(review)).not.toContain("synthetic-secret");
});
