import { expect, it } from "vitest";
import { setupControlSuggestion } from "../../src/client/lib/controlSuggestion.js";

it("transfers only selected Control Server credentials with a bounded deadline and refuses cleared inputs", () => {
  const fields = { apiKey: "synthetic-control-key", basicUsername: "synthetic-user", basicPassword: "synthetic-password", wireguardPrivateKey: "synthetic-vpn-private", openvpnPassword: "synthetic-vpn-password" };
  const api = setupControlSuggestion({ ...fields, authMode: "api_key" }, 1000);
  expect(api).toEqual({ baseUrl: "http://gluetun:8000", authMode: "api_key", apiKey: fields.apiKey, username: "", password: "", expiresAt: 901000 });
  const basic = setupControlSuggestion({ ...fields, authMode: "basic" }, 1000);
  expect(basic).toMatchObject({ apiKey: "", username: fields.basicUsername, password: fields.basicPassword });
  expect(JSON.stringify([api, basic])).not.toContain("synthetic-vpn-");
  expect(setupControlSuggestion({ ...fields, authMode: "none" }, 1000)).toMatchObject({ apiKey: "", username: "", password: "" });
  expect(() => setupControlSuggestion({ ...fields, authMode: "api_key", apiKey: "" })).toThrow(/cleared/);
  expect(() => setupControlSuggestion({ ...fields, authMode: "basic", basicPassword: "" })).toThrow(/cleared/);
  expect(setupControlSuggestion({ ...fields, authMode: "api_key", gluetunServiceName: "vpn-main" }, 1000).baseUrl).toBe("http://vpn-main:8000");
  for (const name of ["user@host", "host:123", "../escape", "${HOST}", "a".repeat(129)]) expect(() => setupControlSuggestion({ ...fields, authMode: "api_key", gluetunServiceName: name })).toThrow(/service name/);
});
