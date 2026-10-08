export function architectureDigests(index: unknown): Record<"amd64" | "arm64", string> {
  const manifests = index && typeof index === "object" ? (index as { manifests?: unknown }).manifests : null;
  if (!Array.isArray(manifests) || manifests.length > 64) throw new Error("Candidate must have a bounded multi-architecture image index.");
  const result = {} as Record<"amd64" | "arm64", string>;
  for (const architecture of ["amd64", "arm64"] as const) {
    const candidates = manifests.filter(manifest => manifest?.platform?.os === "linux" && manifest.platform.architecture === architecture);
    if (candidates.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(String(candidates[0]?.digest))) throw new Error(`Candidate needs exactly one immutable linux/${architecture} manifest.`);
    result[architecture] = candidates[0].digest;
  }
  if (result.amd64 === result.arm64) throw new Error("Architecture manifests must have distinct identities.");
  return result;
}
