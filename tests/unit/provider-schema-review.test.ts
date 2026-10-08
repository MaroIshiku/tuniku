import { expect, it } from "vitest";
import { gluetunProviderProfiles } from "../../src/server/compose/providers.js";
import { providerSchemaReview, providerRulesFingerprint } from "../../src/server/compose/providerSchemaReview.js";

it("binds every offered provider rule set to immutable documentation evidence without claiming a runtime test", () => {
  expect(gluetunProviderProfiles).toHaveLength(23);
  for (const profile of gluetunProviderProfiles) {
    const review = providerSchemaReview({ ...profile });
    expect(review.status, profile.id).toBe("matched");
    expect(review.reviewedAt).toBe("2026-10-07"); expect(review.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(review.sourceSha256).toMatch(/^[a-f0-9]{64}$/); expect(review.runtimeValidated).toBe(false);
    expect(review.sourceUrl).toBe(`https://raw.githubusercontent.com/qdm12/gluetun-wiki/${review.sourceRevision}/setup/providers/${profile.docsUrl.split("/").at(-1)}`);
    expect(review.scope).toEqual(["documented_variables", "advertised_protocols", "credential_requirements"]);
  }
});

it("invalidates review dates when credentials, protocols, variables or option values change and cannot inherit another provider's review", () => {
  const profile = gluetunProviderProfiles.find(profile => profile.id === "nordvpn")!;
  for (const patch of [{ protocols: ["openvpn"] }, { openvpnCredentials: "optional" }, { serverFilters: ["countries"] }, { options: [] }]) {
    const changed = providerSchemaReview({ ...profile, ...patch });
    expect(changed.status).toBe("changed"); expect(changed.reviewedAt).toBeNull(); expect(changed.scope).toEqual([]);
  }
  expect(providerSchemaReview({ ...profile, id: "unreviewed-provider" }).status).toBe("unavailable");
  expect(providerRulesFingerprint({ ...profile, schemaReview: { reviewedAt: "2099-01-01" } })).toBe(providerRulesFingerprint({ ...profile }));
  expect(providerSchemaReview({ ...profile }).reviewedAt).toBe("2026-10-07");
});
