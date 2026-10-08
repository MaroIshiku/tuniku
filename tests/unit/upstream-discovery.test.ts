import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { discoverUpstreams, exceptionWindow, gluetunTag } from "../../src/server/maintenance/upstreamDiscovery.js";
const revision = "1".repeat(40);
const image = { digest: `sha256:${"a".repeat(64)}`, images: [{ os: "linux", architecture: "amd64", digest: `sha256:${"b".repeat(64)}` }, { os: "linux", architecture: "arm64", digest: `sha256:${"c".repeat(64)}` }] };
const release = { tag_name: "v3.41.0", published_at: "2026-10-07T00:00:00Z" };
const sourceUrl = `https://raw.githubusercontent.com/qdm12/gluetun-wiki/${revision}/setup/providers/mullvad.md`;
const sourceSha256 = createHash("sha256").update("reviewed document").digest("hex");
const input = { bundledCommit: revision, exceptionReviewDate: "2026-11-30", reviews: { mullvad: { sourceUrl, sourceSha256, sourceRevision: revision } } };

it("distinguishes immutable documentation comparison, server updates and observed untested latest without modifying review inputs", async () => {
  const seen: string[] = [];
  const request = (async (url: string | URL | Request) => { const target = String(url); seen.push(target); return target.includes("raw.githubusercontent.com") ? new Response("reviewed document") : new Response(JSON.stringify(target.includes("hub.docker.com") ? image : target.includes("releases/latest") ? release : { sha: revision })); }) as typeof fetch;
  const before = JSON.stringify(input);
  const report = await discoverUpstreams(input, request, new Date("2026-10-07T10:00:00Z"));
  expect(report.status).toBe("DISCOVERY_COMPLETE"); expect(report.unavailable).toBe(0); expect(report.runtimeCompatibility).toBe("NOT_TESTED"); expect(report.runtimeValidationRequired).toBe(true); expect(report.writesToUpstreams).toBe(false);
  expect(report.sources.filter(source => source.state === "unchanged").map(source => source.source)).toEqual(["provider-wiki", "provider:mullvad", "server-catalog"]);
  expect(seen.some(url => url.includes(`/gluetun-wiki/${revision}/setup/providers/mullvad.md`))).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
  const changed = await discoverUpstreams(input, (async url => new Response(String(url).includes("raw.githubusercontent.com") ? "changed document" : JSON.stringify(String(url).includes("hub.docker.com") ? image : String(url).includes("releases/latest") ? release : { sha: "2".repeat(40) }))) as typeof fetch, new Date("2026-10-07T10:00:00Z"));
  expect(changed.reviewRequired).toBe(true); expect(changed.sources.find(source => source.source === "provider:mullvad")?.detail.reviewRequired).toBe(true);
});

it("reports failed, malformed, oversized and redirected sources as unavailable and never requests arbitrary review origins", async () => {
  for (const response of [new Response("unavailable", { status: 503 }), new Response("not JSON"), new Response("x".repeat(2_097_153))]) {
    const result = await discoverUpstreams(input, (async () => response.clone()) as typeof fetch, new Date("2026-10-07T10:00:00Z")); expect(result.status).toBe("INCOMPLETE"); expect(result.unavailable).toBeGreaterThan(0);
  }
  const seen: string[] = [];
  const result = await discoverUpstreams({ ...input, reviews: { malicious: { ...input.reviews.mullvad, sourceUrl: "http://127.0.0.1/private" } } }, (async (url, options) => { seen.push(String(url)); expect(options?.redirect).toBe("error"); return new Response(JSON.stringify(String(url).includes("hub.docker.com") ? image : String(url).includes("releases/latest") ? release : { sha: revision })); }) as typeof fetch, new Date("2026-10-07T10:00:00Z"));
  expect(result.sources.find(source => source.source === "provider:malicious")?.state).toBe("unavailable"); expect(seen.some(url => url.includes("127.0.0.1"))).toBe(false);
});

it("rejects ambiguous image identities and reports exception review deadlines without extending them", () => {
  expect(gluetunTag(image).runtimeValidated).toBe(false);
  for (const value of [{}, { ...image, digest: "latest" }, { ...image, images: image.images.slice(0, 1) }, { ...image, images: [...image.images, image.images[0]] }, { ...image, images: image.images.map(item => ({ ...item, digest: image.images[0]!.digest })) }]) expect(() => gluetunTag(value)).toThrow();
  expect(exceptionWindow("2026-11-30", new Date("2026-11-20T00:00:00Z")).state).toBe("due_soon"); expect(exceptionWindow("2026-11-30", new Date("2026-12-01T00:00:00Z")).state).toBe("overdue"); expect(() => exceptionWindow("2026-02-30", new Date())).toThrow();
});
