import { createHash } from "node:crypto";

export interface ReviewSource { sourceUrl: string; sourceSha256: string; sourceRevision: string }
export interface DiscoveryInput { reviews: Record<string, ReviewSource>; bundledCommit: string; exceptionReviewDate: string }
export interface SourceResult { source: string; state: "unchanged" | "changed" | "observed" | "unavailable"; detail: Record<string, unknown> }

const sha = /^[a-f0-9]{40}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
function revision(value: unknown): string {
  if (typeof value !== "string" || !sha.test(value)) throw new Error("Invalid official source revision.");
  return value;
}
export function exceptionWindow(reviewDate: string, now: Date): { reviewDate: string; daysRemaining: number; state: "current" | "due_soon" | "overdue" } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) throw new Error("Invalid exception review date.");
  const end = Date.parse(`${reviewDate}T00:00:00Z`);
  if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== reviewDate) throw new Error("Invalid exception review date.");
  const daysRemaining = Math.ceil((end - now.getTime()) / 86_400_000);
  return { reviewDate, daysRemaining, state: daysRemaining < 0 ? "overdue" : daysRemaining <= 14 ? "due_soon" : "current" };
}
export function gluetunTag(value: unknown): { indexDigest: string; architectures: Record<string, string>; runtimeValidated: false } {
  if (!value || typeof value !== "object") throw new Error("Invalid image metadata.");
  const tag = value as { digest?: unknown; images?: Array<{ os?: unknown; architecture?: unknown; digest?: unknown }> };
  if (typeof tag.digest !== "string" || !digest.test(tag.digest) || !Array.isArray(tag.images) || tag.images.length > 32) throw new Error("Invalid image metadata.");
  const architectures: Record<string, string> = {};
  for (const architecture of ["amd64", "arm64"]) {
    const matches = tag.images.filter(image => image.os === "linux" && image.architecture === architecture);
    if (matches.length !== 1 || typeof matches[0]?.digest !== "string" || !digest.test(matches[0].digest)) throw new Error("Missing or ambiguous supported image architecture.");
    architectures[architecture] = matches[0].digest;
  }
  if (architectures.amd64 === architectures.arm64) throw new Error("Architecture image identities must differ.");
  return { indexDigest: tag.digest, architectures, runtimeValidated: false };
}
async function boundedGet(url: string, request: typeof fetch): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await request(url, { redirect: "error", signal: controller.signal, headers: { accept: "application/json, text/plain", "user-agent": "Tuniku-upstream-discovery" } });
    if (!response.ok || !response.body) throw new Error("Official source unavailable.");
    reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2_097_152) throw new Error("Official source exceeds discovery size limit."); chunks.push(part.value); }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout); controller.abort();
    // A tee'd response's cancellation can await its other reader indefinitely.
    // Abort the transport and request cancellation without delaying the bound.
    if (reader) void reader.cancel().catch(() => undefined);
  }
}

export async function discoverUpstreams(input: DiscoveryInput, request: typeof fetch = fetch, now = new Date()) {
  const sources: SourceResult[] = [];
  const query = async (source: string, run: () => Promise<Omit<SourceResult, "source">>) => {
    try { sources.push({ source, ...await run() }); }
    catch { sources.push({ source, state: "unavailable", detail: { reason: "Official source unavailable or metadata invalid; no freshness or compatibility claim." } }); }
  };
  const readJson = async (url: string) => JSON.parse((await boundedGet(url, request)).toString("utf8"));
  let wikiRevision: string | null = null;
  await query("provider-wiki", async () => {
    wikiRevision = revision((await readJson("https://api.github.com/repos/qdm12/gluetun-wiki/commits/main")).sha);
    const previous = [...new Set(Object.values(input.reviews).map(review => review.sourceRevision))];
    return { state: previous.length === 1 && previous[0] === wikiRevision ? "unchanged" : "changed", detail: { currentRevision: wikiRevision, reviewedRevisions: previous, scope: "Repository revision only; per-document comparisons follow." } };
  });
  const providers = Object.entries(input.reviews);
  if (!providers.length || providers.length > 64) throw new Error("Invalid provider review inventory.");
  for (let index = 0; index < providers.length; index += 4) {
    await Promise.all(providers.slice(index, index + 4).map(([id, review]) => query(`provider:${id}`, async () => {
      if (!wikiRevision) throw new Error("Wiki revision unavailable.");
      const source = new URL(review.sourceUrl);
      const file = source.pathname.match(/^\/qdm12\/gluetun-wiki\/[a-f0-9]{40}\/setup\/providers\/([a-z0-9-]+\.md)$/)?.[1];
      if (source.origin !== "https://raw.githubusercontent.com" || source.search || source.hash || source.username || source.password || !file || !/^[a-f0-9]{64}$/.test(review.sourceSha256)) throw new Error("Invalid pinned documentation source.");
      const url = `https://raw.githubusercontent.com/qdm12/gluetun-wiki/${wikiRevision}/setup/providers/${file}`;
      const currentSha256 = createHash("sha256").update(await boundedGet(url, request)).digest("hex");
      return { state: currentSha256 === review.sourceSha256 ? "unchanged" : "changed", detail: { url, currentSha256, reviewedSha256: review.sourceSha256, reviewRequired: currentSha256 !== review.sourceSha256 } };
    })));
  }
  await query("server-catalog", async () => {
    const currentRevision = revision((await readJson("https://api.github.com/repos/qdm12/gluetun-servers/commits/main")).sha);
    revision(input.bundledCommit);
    return { state: currentRevision === input.bundledCommit ? "unchanged" : "changed", detail: { currentRevision, bundledRevision: input.bundledCommit, regenerated: false } };
  });
  await query("gluetun-release", async () => {
    const release = await readJson("https://api.github.com/repos/passteque/gluetun/releases/latest");
    if (typeof release.tag_name !== "string" || !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.tag_name) || typeof release.published_at !== "string" || !Number.isFinite(Date.parse(release.published_at))) throw new Error("Invalid official release metadata.");
    return { state: "observed", detail: { version: release.tag_name, publishedAt: release.published_at, source: "https://github.com/passteque/gluetun/releases", compatibilityValidated: false } };
  });
  await query("gluetun-latest", async () => ({ state: "observed", detail: gluetunTag(await readJson("https://hub.docker.com/v2/repositories/qmcgaw/gluetun/tags/latest")) }));
  const exception = exceptionWindow(input.exceptionReviewDate, now);
  const unavailable = sources.filter(source => source.state === "unavailable").length;
  return { schemaVersion: 1, checkedAt: now.toISOString(), status: unavailable ? "INCOMPLETE" : "DISCOVERY_COMPLETE", sources: sources.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0), exception, unavailable, reviewRequired: sources.some(source => source.state === "changed") || exception.state !== "current", runtimeCompatibility: "NOT_TESTED", runtimeValidationRequired: true, writesToUpstreams: false };
}
