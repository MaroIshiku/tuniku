import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// Only disposable, randomly named resources belong to this test. No host data,
// Docker socket, published port, external network or VPN credential is used.
const image = process.env.TUNIKU_TEST_IMAGE;
if (!image) throw new Error("Set TUNIKU_TEST_IMAGE to a locally built test image.");
const prefix = `tuniku-lifecycle-${crypto.randomBytes(6).toString("hex")}`;
const volumes: string[] = [], containers: string[] = [];
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 90_000 }).trim();
const offline = ["--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "128", "--memory", "512m", "--tmpfs", "/tmp:rw,size=16m,mode=1777"];
const setupSecret = "synthetic-lifecycle-setup-secret-over32";
const password = "synthetic-lifecycle-admin-password";
const instanceId = "11111111-1111-4111-8111-111111111111";
function volume(suffix: string) { const name = `${prefix}-${suffix}`; docker("volume", "create", "--label", `tuniku.test=${prefix}`, name); volumes.push(name); return name; }
function node(name: string, source: string) { return docker("exec", name, "/nodejs/bin/node", "-e", source); }
async function start(volumeName: string, suffix: string, wrongKey = false) {
  const name = `${prefix}-${suffix}`; containers.push(name);
  docker("run", "-d", "--name", name, "--label", `tuniku.test=${prefix}`, ...offline, "--user", "1000:1000", "-v", `${volumeName}:/data`, "-e", `ISHIKU_SETUP_SECRET=${setupSecret}`, "-e", "HTTPS_ONLY=false", "-e", "TUNIKU_LOG_LEVEL=error", ...(wrongKey ? ["-e", `TUNIKU_ENCRYPTION_KEY=${"3".repeat(64)}`] : []), image!);
  for (let attempts = 0; attempts < 40; attempts++) {
    try { node(name, "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"); return name; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error("Synthetic container did not become ready.");
}
function api(name: string, initialize = false) {
  return JSON.parse(node(name, `(async()=>{
    const assert=require('node:assert/strict');
    const base='http://127.0.0.1:8080/api/v1';
    const auth=await fetch(base+'/auth/${initialize ? "register-first-admin" : "login"}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'synthetic-admin',password:'${password}',${initialize ? `passwordConfirm:'${password}',displayName:'Synthetic Admin',setupSecret:'${setupSecret}'` : ""}})});
    assert.equal(auth.status,200); const session=await auth.json(); const cookie=auth.headers.get('set-cookie'); assert.ok(cookie); assert.ok(!/;\\s*Secure/i.test(cookie)); assert.ok(/HttpOnly/i.test(cookie));
    const request=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{cookie,'x-csrf-token':session.csrfToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}); assert.equal(response.status,200); return response.json();};
    ${initialize ? `await request('/instances/${instanceId}','PUT',{displayName:'Synthetic connection',baseUrl:'http://10.20.30.40:8000',authMode:'api_key',tlsVerify:true,requestTimeoutSeconds:2,apiKey:'synthetic-lifecycle-api-key',saveCredential:true});` : ""}
    const diagnostics=await request('/admin/diagnostics'); assert.equal(diagnostics.transport.mode,'local_http'); assert.equal(diagnostics.database.journalMode,'wal'); assert.equal(diagnostics.database.storage.privateDatabase,true);
    const status=await fetch(base+'/auth/register-first-admin',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); assert.equal(status.status,409);
    console.log(JSON.stringify({accessState:diagnostics.gluetun.accessState,storage:diagnostics.database.storage}));
  })().catch(e=>{console.error(e.message);process.exit(1)});`));
}
function keyFingerprint(name: string) {
  return node(name, "const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict'); assert.equal(process.getuid(),1000); assert.equal(fs.statSync('/data/.secrets').mode&0o777,0o700); const files=fs.readdirSync('/data/.secrets').sort(); const hash=crypto.createHash('sha256'); for(const file of files){const path='/data/.secrets/'+file;assert.equal(fs.statSync(path).mode&0o777,0o600);hash.update(fs.readFileSync(path));} assert.equal(fs.statSync('/data/tuniku.db').mode&0o777,0o600); for(const file of ['tuniku.db-wal','tuniku.db-shm']){if(fs.existsSync('/data/'+file))assert.equal(fs.statSync('/data/'+file).mode&0o777,0o600);} assert.match(fs.readFileSync('/proc/self/status','utf8'),/CapEff:\\s+0+\\n/); console.log(hash.digest('hex'));");
}
function stop(name: string) { docker("stop", "--time", "10", name); docker("rm", name); containers.splice(containers.indexOf(name), 1); }
try {
  const metadata = JSON.parse(docker("image", "inspect", image))[0];
  assert.equal(metadata.Config.User, "1000:1000");
  const data = volume("data"), restored = volume("restore");
  let name = await start(data, "initial");
  const inspection = JSON.parse(docker("inspect", name))[0];
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspection.HostConfig.NetworkMode, "none");
  assert.equal(api(name, true).accessState, "stored_readable");
  const fingerprint = keyFingerprint(name); stop(name);
  name = await start(data, "restart"); assert.equal(api(name).accessState, "stored_readable"); assert.equal(keyFingerprint(name), fingerprint); stop(name);
  name = await start(data, "wrong-key", true); assert.equal(api(name).accessState, "stored_unreadable"); assert.equal(keyFingerprint(name), fingerprint); stop(name);
  name = await start(data, "original-key"); assert.equal(api(name).accessState, "stored_readable"); assert.equal(keyFingerprint(name), fingerprint); stop(name);
  // The writer is stopped. Copy only between our two disposable named volumes.
  docker("run", "--rm", ...offline, "--user", "1000:1000", "-v", `${data}:/source:ro`, "-v", `${restored}:/data`, "--entrypoint", "/nodejs/bin/node", image, "-e", "const fs=require('node:fs'),path=require('node:path'); process.umask(0o077); fs.cpSync('/source','/data',{recursive:true,preserveTimestamps:true}); function modes(source,target){const stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw new Error('Unexpected symlink in synthetic backup');fs.chmodSync(target,stat.mode&0o777);if(stat.isDirectory())for(const child of fs.readdirSync(source))modes(path.join(source,child),path.join(target,child));} modes('/source','/data');");
  name = await start(restored, "restored"); assert.equal(api(name).accessState, "stored_readable"); assert.equal(keyFingerprint(name), fingerprint); stop(name);
  console.log(JSON.stringify({ result: "PASS", imageId: metadata.Id, architecture: metadata.Architecture, dockerClient: docker("version", "--format", "{{.Client.Version}}"), engine: docker("version", "--format", "{{.Server.Version}}"), compose: docker("compose", "version", "--short"), scenarios: ["non-root/read-only/no-capabilities/offline", "HTTP first-admin/login/closed-registration", "private SQLite/WAL/keys", "container replacement persistence", "wrong-key recovery without key replacement", "stopped-writer backup and restore"], limits: "Synthetic local engine only; no NAS reboot, real VPN/leak, upgrade or second-architecture evidence." }));
} finally {
  const failures: string[] = [];
  for (const name of containers.reverse()) try { docker("rm", "-f", name); } catch { failures.push(name); }
  for (const name of volumes.reverse()) try { docker("volume", "rm", name); } catch { failures.push(name); }
  if (failures.length) { console.error(`Synthetic resource cleanup failed: ${failures.join(", ")}`); process.exitCode = 1; }
}
