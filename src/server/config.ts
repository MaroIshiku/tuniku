import fs from "node:fs";
import path from "node:path";

function readSecret(fileEnv: string, fallbackEnvs: string[], defaultFile?: string): string | null {
  const explicitPath = process.env[fileEnv]?.trim();
  const candidate = explicitPath || defaultFile;
  if (candidate && fs.existsSync(candidate)) {
    const value = fs.readFileSync(candidate, "utf8").trim();
    return value || null;
  }
  if (explicitPath) {
    return null;
  }
  for (const name of fallbackEnvs) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function integerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const dataPath = path.resolve(process.env.TUNIKU_DATA_PATH || process.env.ISHIKU_DATA_DIR || "./data");

export const config = {
  host: process.env.TUNIKU_HOST || "0.0.0.0",
  port: integerEnv("TUNIKU_PORT", 8080),
  dataPath,
  databasePath: process.env.TUNIKU_DATABASE_PATH || path.join(dataPath, "tuniku.db"),
  logLevel: process.env.TUNIKU_LOG_LEVEL || process.env.ISHIKU_LOG_LEVEL || "info",
  trustedProxyCount: integerEnv("TUNIKU_TRUSTED_PROXY_COUNT", 0),
  secureCookies: process.env.TUNIKU_SECURE_COOKIES === "true",
  allowLoopbackUpstream: process.env.TUNIKU_ALLOW_LOOPBACK_UPSTREAM === "true",
  dockerProxyUrl: process.env.TUNIKU_DOCKER_PROXY_URL?.trim() || null,
  registrationSecret: readSecret(
    "TUNIKU_REGISTRATION_SECRET_FILE",
    ["TUNIKU_REGISTRATION_SECRET", "ISHIKU_SETUP_SECRET"],
    "/run/secrets/tuniku_registration_secret"
  ),
  sessionSecret: readSecret(
    "TUNIKU_SESSION_SECRET_FILE",
    ["TUNIKU_SESSION_SECRET"],
    "/run/secrets/tuniku_session_secret"
  ),
  encryptionKey: readSecret(
    "TUNIKU_ENCRYPTION_KEY_FILE",
    ["TUNIKU_ENCRYPTION_KEY"],
    "/run/secrets/tuniku_encryption_key"
  ),
  build: {
    version: process.env.TUNIKU_VERSION || "0.1.0",
    date: process.env.TUNIKU_BUILD_DATE || "development",
    gitSha: process.env.TUNIKU_GIT_SHA || "development"
  }
} as const;

export type AppConfig = typeof config;
