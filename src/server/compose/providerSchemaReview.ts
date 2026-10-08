import { createHash } from "node:crypto";
import reviews from "./providerSchemaReview.json" with { type: "json" };

export interface ProviderSchemaReview {
  status: "matched" | "changed" | "unavailable";
  reviewedAt: string | null;
  sourceRevision: string | null;
  sourceUrl: string | null;
  sourceSha256: string | null;
  scope: string[];
  runtimeValidated: false;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function providerRulesFingerprint(profile: Record<string, unknown>): string {
  const { schemaReview: _review, ...rules } = profile;
  return createHash("sha256").update(JSON.stringify(canonical(rules))).digest("hex");
}
export function providerSchemaReview(profile: Record<string, unknown> & { id: string }): ProviderSchemaReview {
  const review = (reviews.providers as Record<string, typeof reviews.providers.airvpn>)[profile.id];
  const matched = review?.rulesSha256 === providerRulesFingerprint(profile);
  return { status: !review ? "unavailable" : matched ? "matched" : "changed", reviewedAt: matched ? review.reviewedAt : null, sourceRevision: review?.sourceRevision ?? null, sourceUrl: review?.sourceUrl ?? null, sourceSha256: review?.sourceSha256 ?? null, scope: matched ? review.scope : [], runtimeValidated: false };
}
