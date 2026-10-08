import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { generateCompose, validateCompose } from "../src/server/compose/generator.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tuniku-compose-artifacts-"));
const image = process.env.TUNIKU_TEST_IMAGE || "tuniku:verify";
function checkRuntime(filename: string, password: string): void {
  const assertion = `const assert=require('node:assert/strict'); const expected=Buffer.from('${Buffer.from(password).toString("base64")}','base64').toString(); assert.equal(process.env.OPENVPN_PASSWORD,expected); assert.equal(JSON.parse(process.env.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE).apikey,expected);`;
  execFileSync("docker", ["compose", "-f", filename, "run", "--rm", "--no-deps", "--pull", "never", "-T", "--entrypoint", "/nodejs/bin/node", "probe", "-e", assertion], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
try {
  for (const service of [{ ports: ["70000:80"] }, { network_mode: "service:missing" }, { depends_on: ["missing"] }, { networks: ["missing"] }, { volumes: ["missing:/data"] }, { environment: { SYNTHETIC: true } }, { ports: ["[::1]:8080:80"], environment: { SYNTHETIC: "value" } }]) {
    const filename = path.join(directory, "structure.yml");
    const source = YAML.stringify({ name: "tuniku-structure-check", services: { probe: { image, ...service } } });
    fs.writeFileSync(filename, source);
    let cliValid = true;
    try { execFileSync("docker", ["compose", "-f", filename, "config", "--quiet"], { stdio: ["ignore", "pipe", "pipe"] }); } catch { cliValid = false; }
    assert.equal(validateCompose(source).valid, cliValid, "Tuniku and actual Compose disagree on a synthetic structure case.");
  }
  for (const password of ["synthetic-$VALUE-${OTHER}-$$", "synthetic back\\slash # hash", "synthetic-'quote'-\"double\"", "synthetic-newline\nsecond-line"]) {
    const generated = generateCompose({ taskType: "new_gluetun_setup", provider: "private internet access", vpnType: "openvpn", openvpnUser: "synthetic-user", openvpnPassword: password, authMode: "api_key", apiKey: password, includeSecrets: true });
    const filename = path.join(directory, "compose.yml");
    fs.writeFileSync(filename, generated.snippets.compose);
    const rendered = JSON.parse(execFileSync("docker", ["compose", "-f", filename, "config", "--format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    assert.equal(rendered.services.gluetun.image, "qmcgaw/gluetun:latest");
    // `compose config` re-escapes dollars for serialization. Verify the values
    // received by a disposable offline process, not serialized YAML alone.
    const environment = YAML.parse(generated.snippets.compose).services.gluetun.environment;
    const probe = { image, network_mode: "none", read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"] };
    fs.writeFileSync(filename, YAML.stringify({ name: "tuniku-synthetic-check", services: { probe: { ...probe, environment } } }));
    checkRuntime(filename, password);
    fs.writeFileSync(path.join(directory, "optional.env"), generated.snippets.env);
    fs.writeFileSync(filename, YAML.stringify({ name: "tuniku-synthetic-check", services: { probe: { ...probe, env_file: "optional.env" } } }));
    checkRuntime(filename, password);
  }
  console.log("PASS Docker Compose agrees on 7 synthetic structure/reference cases and preserves credentials in self-contained YAML and optional env artifacts (4 special-character cases).");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
