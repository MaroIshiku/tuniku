export function imageRevision(configs: unknown): string {
  if (!configs || typeof configs !== "object") throw new Error("Image configuration is unavailable.");
  const images = configs as Record<string, { config?: { Labels?: Record<string, string> } }>;
  const revisions = ["linux/amd64", "linux/arm64"].map(platform => images[platform]?.config?.Labels?.["org.opencontainers.image.revision"]);
  if (!revisions.every(revision => typeof revision === "string" && /^[a-f0-9]{40}$/.test(revision)) || new Set(revisions).size !== 1) throw new Error("Both architecture images must identify the same source commit.");
  return revisions[0]!;
}

export function promotionDecision(candidate: string, previous: string, isAncestor: (ancestor: string, descendant: string) => boolean): "promote" | "keep_newer" {
  if (![candidate, previous].every(revision => /^[a-f0-9]{40}$/.test(revision))) throw new Error("Source revisions must be full commit hashes.");
  if (candidate === previous || isAncestor(previous, candidate)) return "promote";
  if (isAncestor(candidate, previous)) return "keep_newer";
  throw new Error("Unrelated source histories require an explicit release decision.");
}
