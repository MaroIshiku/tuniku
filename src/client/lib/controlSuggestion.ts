export interface ControlSuggestion {
  baseUrl: string;
  authMode: "none" | "api_key" | "basic";
  apiKey: string;
  username: string;
  password: string;
  expiresAt: number;
}

export function setupControlSuggestion(input: { authMode: ControlSuggestion["authMode"]; apiKey: string; basicUsername: string; basicPassword: string; gluetunServiceName?: string }, now = Date.now()): ControlSuggestion {
  const serviceName = input.gluetunServiceName?.trim() || "gluetun";
  if (serviceName.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(serviceName) || ["__proto__", "constructor", "prototype"].includes(serviceName)) throw new Error("Review the VPN service name before transferring the Control Server address.");
  if (input.authMode === "api_key" && !input.apiKey.trim() || input.authMode === "basic" && (!input.basicUsername.trim() || !input.basicPassword.trim())) throw new Error("Setup credentials have been cleared. Enter the Control Server credentials again before transferring them.");
  return { baseUrl: `http://${serviceName}:8000`, authMode: input.authMode, apiKey: input.authMode === "api_key" ? input.apiKey : "", username: input.authMode === "basic" ? input.basicUsername : "", password: input.authMode === "basic" ? input.basicPassword : "", expiresAt: now + 15 * 60_000 };
}
