import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.js";

describe("runtime secret configuration", () => {
  it("needs only one operator-provided setup secret and persists internal keys", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-config-"));
    const environment = {
      TUNIKU_DATA_PATH: dataPath,
      ISHIKU_SETUP_SECRET: "synthetic-setup-secret-with-at-least-32-characters"
    };

    const first = loadConfig(environment);
    const second = loadConfig(environment);

    expect(first.registrationSecret).toBe(environment.ISHIKU_SETUP_SECRET);
    expect(first.sessionSecret).toBe(second.sessionSecret);
    expect(first.encryptionKey).toBe(second.encryptionKey);
    for (const name of ["session-secret", "credential-encryption-key"]) {
      const secretPath = path.join(dataPath, ".secrets", name);
      expect(fs.existsSync(secretPath)).toBe(true);
      expect(fs.statSync(secretPath).mode & 0o777).toBe(0o600);
    }
  });

  it("fails setup closed when the supplied setup secret is too short", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-config-"));
    const configured = loadConfig({ TUNIKU_DATA_PATH: dataPath, ISHIKU_SETUP_SECRET: "too-short" });

    expect(configured.registrationSecret).toBeNull();
  });

  it("keeps legacy file-backed overrides compatible", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-config-"));
    const secretPath = path.join(dataPath, "legacy-setup");
    const sessionPath = path.join(dataPath, "legacy-session");
    const encryptionPath = path.join(dataPath, "legacy-encryption");
    fs.writeFileSync(secretPath, "legacy-setup-secret-with-at-least-32-characters\n");
    fs.writeFileSync(sessionPath, "legacy-session-secret-with-at-least-32-characters\n");
    fs.writeFileSync(encryptionPath, "4".repeat(64));

    const configured = loadConfig({
      TUNIKU_DATA_PATH: dataPath,
      TUNIKU_REGISTRATION_SECRET_FILE: secretPath,
      TUNIKU_SESSION_SECRET_FILE: sessionPath,
      TUNIKU_ENCRYPTION_KEY_FILE: encryptionPath
    });

    expect(configured.registrationSecret).toMatch(/^legacy-setup/);
    expect(configured.sessionSecret).toMatch(/^legacy-session/);
    expect(configured.encryptionKey).toBe("4".repeat(64));
  });

  it("fails closed instead of replacing an explicitly configured missing key file", () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-config-"));

    expect(() => loadConfig({
      TUNIKU_DATA_PATH: dataPath,
      TUNIKU_SESSION_SECRET_FILE: path.join(dataPath, "missing-session-secret")
    })).toThrow("session secret file is missing or empty");
  });
});
