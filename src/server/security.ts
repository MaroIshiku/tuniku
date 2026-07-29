import crypto from "node:crypto";
import dns from "node:dns/promises";
import argon2 from "argon2";
import type { UpstreamCredential } from "./types.js";

const sensitiveKey = /(password|token|secret|private[_-]?key|api[_-]?key|authorization|credential|openvpn_user|wireguard)/i;
const knownWeakPasswords = new Set(["changeme", "admin", "password", "passwort", "123456", "ishiku", "tuniku"]);

export function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(leftBuffer, Buffer.alloc(leftBuffer.length));
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateAdminInput(input: {
  setupSecret: string;
  configuredSecret: string;
  displayName: string;
  username: string;
  email?: string;
  password: string;
  passwordConfirm: string;
}): string[] {
  const errors: string[] = [];
  const username = input.username.trim();
  if (!timingSafeEqualText(input.setupSecret, input.configuredSecret)) errors.push("The setup secret is invalid.");
  if (input.displayName.trim().length < 2) errors.push("Display name must contain at least 2 characters.");
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) errors.push("Username must contain 3–64 letters, numbers, dots, dashes, or underscores.");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.push("Email address is invalid.");
  if (input.password.length < 12) errors.push("Password must contain at least 12 characters.");
  if (input.password !== input.passwordConfirm) errors.push("Password confirmation does not match.");
  if (input.password === input.setupSecret) errors.push("Admin password must differ from the setup secret.");
  if (
    input.password.toLowerCase() === username.toLowerCase() ||
    knownWeakPasswords.has(input.password.toLowerCase())
  ) {
    errors.push("Choose a password that is not a username, app name, or common placeholder.");
  }
  return errors;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function redactValue(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey)
      ])
    );
  }
  return value;
}

export function redactText(input: string): string {
  return input
    .replace(
      /(^|\n)(\s*(?:[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|PRIVATE_KEY|API_KEY|AUTH)[A-Z0-9_]*?)\s*[:=]\s*)([^\n]+)/gi,
      "$1$2[REDACTED]"
    )
    .replace(/(X-API-Key\s*:\s*)\S+/gi, "$1[REDACTED]")
    .replace(/(Authorization\s*:\s*)[^\n]+/gi, "$1[REDACTED]");
}

function normalizeEncryptionKey(input: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(input)) return Buffer.from(input, "hex");
  const decoded = Buffer.from(input, "base64");
  if (decoded.length === 32) return decoded;
  return crypto.createHash("sha256").update(input).digest();
}

export function encryptCredential(credential: UpstreamCredential, encryptionKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", normalizeEncryptionKey(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64")
  });
}

export function decryptCredential(payload: string, encryptionKey: string): UpstreamCredential {
  const envelope = JSON.parse(payload) as { v: number; iv: string; tag: string; data: string };
  if (envelope.v !== 1) throw new Error("Unsupported credential envelope.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    normalizeEncryptionKey(encryptionKey),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8")
  ) as UpstreamCredential;
}

function isBlockedIpv4(address: string, allowLoopback: boolean): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a >= 224 || (a === 169 && b === 254)) return true;
  if (!allowLoopback && a === 127) return true;
  if (address === "169.254.169.254" || address === "100.100.100.200") return true;
  return false;
}

function isBlockedIpv6(address: string, allowLoopback: boolean): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";
  if (normalized === "::" || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (!allowLoopback && normalized === "::1") return true;
  return false;
}

export async function validateUpstreamUrl(input: string, allowLoopback: boolean): Promise<string> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in the URL.");
  if (url.search || url.hash) throw new Error("The base URL must not contain a query or fragment.");
  if (["metadata.google.internal", "metadata.aws.internal"].includes(url.hostname.toLowerCase())) {
    throw new Error("Cloud metadata destinations are not allowed.");
  }
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("The configured host could not be resolved.");
  for (const result of addresses) {
    const blocked = result.family === 4
      ? isBlockedIpv4(result.address, allowLoopback)
      : isBlockedIpv6(result.address, allowLoopback);
    if (blocked) throw new Error("The configured host resolves to a blocked destination.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const active = (this.attempts.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs);
    if (active.length >= this.maxAttempts) {
      this.attempts.set(key, active);
      return false;
    }
    active.push(now);
    this.attempts.set(key, active);
    return true;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
