import { expect, it } from "vitest";
import { imageRevision, promotionDecision } from "../../scripts/release-policy.js";

it("promotes descendants and repeated source builds, skips older commits and refuses unrelated histories", () => {
  const old = "1".repeat(40), current = "2".repeat(40), unrelated = "3".repeat(40);
  const ancestor = (a: string, b: string) => a === old && b === current;
  expect(promotionDecision(current, old, ancestor)).toBe("promote");
  expect(promotionDecision(old, current, ancestor)).toBe("keep_newer");
  expect(promotionDecision(current, current, ancestor)).toBe("promote");
  expect(() => promotionDecision(unrelated, current, ancestor)).toThrow(/Unrelated/);
  expect(() => promotionDecision("main", old, ancestor)).toThrow(/full commit/);
});

it("requires matching complete revisions from both architecture image configurations", () => {
  const revision = "1".repeat(40), image = { config: { Labels: { "org.opencontainers.image.revision": revision } } };
  expect(imageRevision({ "linux/amd64": image, "linux/arm64": image })).toBe(revision);
  expect(() => imageRevision({ "linux/amd64": image })).toThrow();
  expect(() => imageRevision({ "linux/amd64": image, "linux/arm64": { config: { Labels: { "org.opencontainers.image.revision": "2".repeat(40) } } } })).toThrow();
  expect(() => imageRevision(null)).toThrow();
});
