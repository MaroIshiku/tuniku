import { describe, expect, it } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  redactText,
  redactValue,
  validateAdminInput
} from "../../src/server/security.js";

describe("secret handling", () => {
  it("redacts sensitive object keys and environment text", () => {
    expect(redactValue({ username: "safe", apiKey: "secret", nested: { WIREGUARD_PRIVATE_KEY: "key" } })).toEqual({
      username: "safe",
      apiKey: "[REDACTED]",
      nested: { WIREGUARD_PRIVATE_KEY: "[REDACTED]" }
    });
    expect(redactText("OPENVPN_PASSWORD=secret\nVPN_TYPE=wireguard")).toBe("OPENVPN_PASSWORD=[REDACTED]\nVPN_TYPE=wireguard");
  });

  it("encrypts and decrypts stored credentials", () => {
    const key = "1".repeat(64);
    const encrypted = encryptCredential({ apiKey: "private" }, key);
    expect(encrypted).not.toContain("private");
    expect(decryptCredential(encrypted, key)).toEqual({ apiKey: "private" });
  });
});

describe("first-run validation", () => {
  const valid = {
    setupSecret: "setup-secret-that-is-long",
    configuredSecret: "setup-secret-that-is-long",
    displayName: "Tuniku Admin",
    username: "admin.user",
    email: "admin@example.invalid",
    password: "a long unique admin password",
    passwordConfirm: "a long unique admin password"
  };

  it("accepts valid input", () => {
    expect(validateAdminInput(valid)).toEqual([]);
  });

  it("rejects a reused setup secret", () => {
    expect(validateAdminInput({ ...valid, password: valid.setupSecret, passwordConfirm: valid.setupSecret }))
      .toContain("Admin password must differ from the setup secret.");
  });
});
