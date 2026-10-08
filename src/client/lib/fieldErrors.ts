import { ApiError } from "./api.js";
export function fieldErrors(error: unknown, prefix = ""): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const entries = error.details.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== "object") return [];
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (typeof path !== "string" || typeof message !== "string") return [];
    const key = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
    return /^[A-Za-z][A-Za-z0-9_.]*$/.test(key) ? [[key, message]] : [];
  });
  return Object.fromEntries(entries);
}
