import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Environment = NodeJS.ProcessEnv;

function readSecret(
  environment: Environment,
  fileEnvs: string[],
  fallbackEnvs: string[],
  defaultFiles: string[] = []
): string | null {
  const explicitPath = fileEnvs.map((name) => environment[name]?.trim()).find(Boolean);
  const candidates = explicitPath ? [explicitPath] : defaultFiles;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const value = fs.readFileSync(candidate, "utf8").trim();
    return value || null;
  }
  if (explicitPath) return null;
  for (const name of fallbackEnvs) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return null;
}

function requireMinimumSecret(value: string, name: string, minimum = 32): string {
  if (value.length < minimum) throw new Error(`${name} must contain at least ${minimum} characters.`);
  return value;
}

function readOrCreatePersistentSecret(input: {
  environment: Environment;
  fileEnvs: string[];
  fallbackEnvs: string[];
  defaultFiles: string[];
  persistentFile: string;
  label: string;
  generate: () => string;
}): string {
  const configured = readSecret(input.environment, input.fileEnvs, input.fallbackEnvs, input.defaultFiles);
  const explicitFile = input.fileEnvs.some((name) => Boolean(input.environment[name]?.trim()));
  if (explicitFile && !configured) throw new Error(`${input.label} file is missing or empty.`);
  if (configured) return requireMinimumSecret(configured, input.label);

  if (fs.existsSync(input.persistentFile)) {
    return requireMinimumSecret(fs.readFileSync(input.persistentFile, "utf8").trim(), `Persistent ${input.label}`);
  }

  fs.mkdirSync(path.dirname(input.persistentFile), { recursive: true, mode: 0o700 });
  const generated = requireMinimumSecret(input.generate(), input.label);
  try {
    fs.writeFileSync(input.persistentFile, `${generated}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return requireMinimumSecret(fs.readFileSync(input.persistentFile, "utf8").trim(), `Persistent ${input.label}`);
  }
}

function integerEnv(environment: Environment, name: string, fallback: number): number {
  const parsed = Number.parseInt(environment[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(environment: Environment = process.env) {
  const dataPath = path.resolve(environment.TUNIKU_DATA_PATH || environment.ISHIKU_DATA_DIR || "./data");
  const runtimeSecretPath = path.join(dataPath, ".secrets");
  const registrationSecret = readSecret(
    environment,
    ["ISHIKU_SETUP_SECRET_FILE", "TUNIKU_REGISTRATION_SECRET_FILE"],
    ["ISHIKU_SETUP_SECRET", "TUNIKU_REGISTRATION_SECRET"],
    ["/run/secrets/ishiku_setup_secret", "/run/secrets/tuniku_registration_secret"]
  );

  const httpsOnly = (environment.HTTPS_ONLY || environment.HTTPSONLY || environment.TUNIKU_SECURE_COOKIES) === "true";

  return {
    host: environment.TUNIKU_HOST || "0.0.0.0",
    port: integerEnv(environment, "TUNIKU_PORT", 8080),
    dataPath,
    databasePath: environment.TUNIKU_DATABASE_PATH || path.join(dataPath, "tuniku.db"),
    logLevel: environment.TUNIKU_LOG_LEVEL || environment.ISHIKU_LOG_LEVEL || "info",
    trustedProxyCount: integerEnv(environment, "TUNIKU_TRUSTED_PROXY_COUNT", 0),
    secureCookies: httpsOnly,
    allowLoopbackUpstream: environment.TUNIKU_ALLOW_LOOPBACK_UPSTREAM === "true",
    dockerProxyUrl: environment.TUNIKU_DOCKER_PROXY_URL?.trim() || null,
    registrationSecret: registrationSecret && registrationSecret.length >= 32 ? registrationSecret : null,
    sessionSecret: readOrCreatePersistentSecret({
      environment,
      fileEnvs: ["TUNIKU_SESSION_SECRET_FILE"],
      fallbackEnvs: ["TUNIKU_SESSION_SECRET"],
      defaultFiles: ["/run/secrets/tuniku_session_secret"],
      persistentFile: path.join(runtimeSecretPath, "session-secret"),
      label: "session secret",
      generate: () => crypto.randomBytes(48).toString("base64url")
    }),
    encryptionKey: readOrCreatePersistentSecret({
      environment,
      fileEnvs: ["TUNIKU_ENCRYPTION_KEY_FILE"],
      fallbackEnvs: ["TUNIKU_ENCRYPTION_KEY"],
      defaultFiles: ["/run/secrets/tuniku_encryption_key"],
      persistentFile: path.join(runtimeSecretPath, "credential-encryption-key"),
      label: "credential encryption key",
      generate: () => crypto.randomBytes(32).toString("base64")
    }),
    build: {
      version: environment.TUNIKU_VERSION || "0.3.5",
      date: environment.TUNIKU_BUILD_DATE || "development",
      gitSha: environment.TUNIKU_GIT_SHA || "development"
    }
  } as const;
}

export const config = loadConfig();

export type AppConfig = ReturnType<typeof loadConfig>;
