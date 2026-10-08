import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { config } from "../../src/server/config.js";

it("returns stable field paths without reflecting credentials and leaves rejected connections unsaved", async () => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-fields-"));
  const app = await buildApp({ ...config, dataPath, databasePath: path.join(dataPath, "test.db"), logLevel: "silent", registrationSecret: "synthetic-fields-setup", sessionSecret: "synthetic-fields-session-secret-over-32", encryptionKey: "2".repeat(64), dockerProxyUrl: null, managerUrl: null });
  try {
    const register = await app.inject({ method: "POST", url: "/api/v1/auth/register-first-admin", payload: { setupSecret: "synthetic-fields-setup", displayName: "Synthetic Admin", username: "field-admin", password: "synthetic-field-admin-password", passwordConfirm: "synthetic-field-admin-password" } });
    const headers = { cookie: register.headers["set-cookie"] as string, "x-csrf-token": register.json().csrfToken };
    for (const [input, field] of [
      [{ taskType: "configure_wireguard", provider: "protonvpn", vpnType: "wireguard", wireguardPrivateKey: "synthetic-invalid-private-key" }, "wireguardPrivateKey"],
      [{ taskType: "set_server_selection", provider: "nordvpn", vpnType: "openvpn", anyLocation: true, countries: "Netherlands" }, "anyLocation"],
      [{ taskType: "set_server_selection", provider: "custom", vpnType: "wireguard", anyLocation: true }, "anyLocation"],
      [{ taskType: "configure_control_auth", authMode: "api_key" }, "apiKey"],
      [{ taskType: "publish_app_port", gluetunServiceName: "user@host", hostPort: 8080, containerPort: 80 }, "gluetunServiceName"],
      [{ taskType: "publish_app_port", gluetunServiceName: "missing", hostPort: 8080, containerPort: 80, pastedCompose: "services:\n  vpn:\n    image: qmcgaw/gluetun:latest\n" }, "gluetunServiceName"],
      [{ taskType: "publish_app_port", hostPort: 70000, containerPort: 80 }, "input.hostPort"],
      [{ taskType: "publish_app_port", hostPort: 8080, containerPort: 80, hostAddress: "invalid" }, "hostAddress"]
    ] as const) {
      const response = await app.inject({ method: "POST", url: "/api/v1/compose/generate", headers, payload: { input } });
      expect(response.statusCode).toBe(400); expect(response.json().error.details[0].path).toBe(field);
      expect(response.body).not.toContain("synthetic-invalid-private-key");
    }
    const id = "11111111-1111-4111-8111-111111111111";
    const configuration = { displayName: "Synthetic", baseUrl: "http://user:synthetic-url-secret@example.test:8000", authMode: "none", tlsVerify: true, requestTimeoutSeconds: 15 };
    for (const [method, url, payload] of [["PUT", `/api/v1/instances/${id}`, configuration], ["POST", `/api/v1/instances/${id}/test`, { configuration }]] as const) {
      const response = await app.inject({ method, url, headers, payload });
      expect(response.statusCode).toBe(400); expect(response.json().error.details[0].path).toBe("baseUrl");
      expect(response.body).not.toContain("synthetic-url-secret");
    }
    expect((await app.inject({ url: "/api/v1/instances", headers })).json().instances).toHaveLength(0);
    expect((await app.inject({ method: "PUT", url: `/api/v1/instances/${id}`, headers, payload: { ...configuration, baseUrl: "http://192.168.254.254:8000" } })).statusCode).toBe(200);
    const note = { label: "Synthetic IPv6", hostPort: 8585, containerPort: 85, protocol: "udp", notes: null };
    for (const hostAddress of ["2001:db8::invalid", "[2001:db8::1]", "http://[::1]"]) {
      const rejected = await app.inject({ method: "POST", url: `/api/v1/instances/${id}/port-labels`, headers, payload: { ...note, hostAddress } });
      expect(rejected.statusCode).toBe(400); expect(rejected.json().error.details[0].path).toBe("hostAddress");
      expect(rejected.body).not.toContain(hostAddress);
    }
    const saved = await app.inject({ method: "POST", url: `/api/v1/instances/${id}/port-labels`, headers, payload: { ...note, hostAddress: "2001:db8::1" } });
    expect(saved.statusCode).toBe(201); expect(saved.json().port).toMatchObject({ hostAddress: "2001:db8::1", protocol: "udp" });
    expect((await app.inject({ url: `/api/v1/instances/${id}/ports`, headers })).json().ports).toHaveLength(1);
    for (const hostAddress of ["2001:db8::2", "127.0.0.1"]) expect((await app.inject({ method: "POST", url: `/api/v1/instances/${id}/port-labels`, headers, payload: { ...note, hostAddress } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/api/v1/instances/${id}/port-labels`, headers, payload: { ...note, hostAddress: "2001:db8::1", protocol: "tcp" } })).statusCode).toBe(201);
    for (const hostAddress of ["2001:0db8:0:0:0:0:0:1", "::ffff:127.0.0.1", "::"]) {
      const rejected = await app.inject({ method: "POST", url: `/api/v1/instances/${id}/port-labels`, headers, payload: { ...note, hostAddress } });
      expect(rejected.statusCode).toBe(400); expect(rejected.json().error.details[0].path).toBe("hostPort");
    }
    const updated = await app.inject({ method: "PUT", url: `/api/v1/instances/${id}/port-labels/${saved.json().port.id}`, headers, payload: { ...note, hostAddress: "2001:db8::1" } });
    expect(updated.statusCode).toBe(200);


  } finally { await app.close(); fs.rmSync(dataPath, { recursive: true, force: true }); }
});
