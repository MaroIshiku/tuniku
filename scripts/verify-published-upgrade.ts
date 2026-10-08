import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const current = process.env.TUNIKU_TEST_IMAGE;
if (!current) throw new Error("Set TUNIKU_TEST_IMAGE to a locally built current image.");
const previous = "ghcr.io/maroishiku/tuniku@sha256:40a83603f67d73ec9cfeb22bde5f11f57fee1278c45a7272e52184a42e7fa606";
const prefix = `tuniku-upgrade-${crypto.randomBytes(6).toString("hex")}`;
const containers: string[] = [], volumes: string[] = [];
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 90_000 }).trim();
const offline = ["--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "128", "--memory", "512m", "--tmpfs", "/tmp:rw,size=16m,mode=1777"];
const setupSecret = "synthetic-upgrade-setup-secret-over32", password = "synthetic-upgrade-admin-password", instanceId = "11111111-1111-4111-8111-111111111111";
const node = (name: string, source: string) => docker("exec", name, "/nodejs/bin/node", "-e", source);
const volume = (suffix: string) => { const name = `${prefix}-${suffix}`; docker("volume", "create", "--label", `tuniku.test=${prefix}`, name); volumes.push(name); return name; };
async function start(data: string, suffix: string, image: string) {
  const name = `${prefix}-${suffix}`; containers.push(name);
  // Old published releases created files using the process umask. This synthetic
  // fixture explicitly uses a private umask; no existing host file is changed.
  docker("run", "-d", "--name", name, "--label", `tuniku.test=${prefix}`, ...offline, "--user", "1000:1000", "-v", `${data}:/data`, "-e", `ISHIKU_SETUP_SECRET=${setupSecret}`, "-e", "HTTPS_ONLY=false", "-e", "TUNIKU_LOG_LEVEL=error", "--entrypoint", "/nodejs/bin/node", image, "-e", "process.umask(0o077); import('./dist/server/index.js');");
  for (let attempt = 0; attempt < 40; attempt++) {
    try { node(name, "fetch('http://127.0.0.1:8080/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"); return name; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error("Synthetic upgrade container did not become ready.");
}
function inspect(name: string, seed: boolean) {
  return JSON.parse(node(name, `(async()=>{
    const assert=require('node:assert/strict'),base='http://127.0.0.1:8080/api/v1';
    const auth=await fetch(base+'/auth/${seed ? "register-first-admin" : "login"}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'synthetic-admin',password:'${password}',${seed ? `passwordConfirm:'${password}',displayName:'Synthetic Admin',setupSecret:'${setupSecret}'` : ""}})});
    assert.equal(auth.status,200);const session=await auth.json(),cookie=auth.headers.get('set-cookie');
    const request=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{cookie,'x-csrf-token':session.csrfToken,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200);return response.json();};
    ${seed ? `await request('/instances/${instanceId}','PUT',{displayName:'Synthetic Upgrade VPN',baseUrl:'http://192.168.254.254:8000',authMode:'api_key',apiKey:'synthetic-upgrade-control-key',saveCredential:true,tlsVerify:true,requestTimeoutSeconds:2});await request('/compose/generate','POST',{saveDraft:true,title:'Synthetic Upgrade Draft',input:{taskType:'configure_control_auth',authMode:'api_key',apiKey:'synthetic-upgrade-control-key',includeSecrets:false}});` : ""}
    const instance=(await request('/instances/${instanceId}')).instance;assert.equal(instance.displayName,'Synthetic Upgrade VPN');assert.equal(instance.hasStoredCredential,true);
    const drafts=(await request('/compose/drafts')).drafts;assert.equal(drafts.length,1);assert.equal(drafts[0].title,'Synthetic Upgrade Draft');assert.ok(!JSON.stringify(drafts).includes('synthetic-upgrade-control-key'));
    const diagnostics=await request('/admin/diagnostics');if(diagnostics.gluetun.accessState)assert.equal(diagnostics.gluetun.accessState,'stored_readable');
    const fs=require('node:fs'),crypto=require('node:crypto');const keys=['session-secret','credential-encryption-key'].map(file=>crypto.createHash('sha256').update(fs.readFileSync('/data/.secrets/'+file)).digest('hex'));
    console.log(JSON.stringify({schema:diagnostics.database.migrationVersion,keys,drafts:drafts.length,userId:session.user.id,credentialAccess:diagnostics.gluetun.accessState}));
  })().catch(()=>process.exit(1));`));
}
const stop = (name: string) => docker("stop", "--time", "10", name);
const copy = (source: string, target: string) => docker("run", "--rm", ...offline, "--user", "1000:1000", "-v", `${source}:/source:ro`, "-v", `${target}:/data`, "--entrypoint", "/nodejs/bin/node", current!, "-e", "const fs=require('node:fs'),path=require('node:path');process.umask(0o077);fs.cpSync('/source','/data',{recursive:true,preserveTimestamps:true});function modes(s,t){const stat=fs.lstatSync(s);if(stat.isSymbolicLink())throw new Error('Unexpected symlink');fs.chmodSync(t,stat.mode&0o777);if(stat.isDirectory())for(const child of fs.readdirSync(s))modes(path.join(s,child),path.join(t,child));}modes('/source','/data');");
try {
  const oldImage=JSON.parse(docker("image","inspect",previous))[0],newImage=JSON.parse(docker("image","inspect",current))[0];
  const data=volume("data"),backup=volume("backup"),rollback=volume("rollback");
  let name=await start(data,"old",previous);const before=inspect(name,true);assert.equal(before.schema,3);stop(name);copy(data,backup);
  name=await start(data,"current",current);const after=inspect(name,false);assert.equal(after.schema,4);assert.deepEqual(after.keys,before.keys);assert.equal(after.userId,before.userId);assert.equal(after.credentialAccess,'stored_readable');stop(name);
  copy(backup,rollback);name=await start(rollback,"rollback",previous);const restored=inspect(name,false);assert.equal(restored.schema,3);assert.deepEqual(restored.keys,before.keys);assert.equal(restored.userId,before.userId);stop(name);
  console.log(JSON.stringify({result:'PASS',previousDigest:previous,previousImageId:oldImage.Id,currentImageId:newImage.Id,architecture:newImage.Architecture,scenarios:['published schema3 fixture','stopped matching-key backup','schema3 to schema4 upgrade preserves account, draft and readable encrypted credential','schema3 backup-based rollback'],limits:'Isolated synthetic local rootless engine; private fixture umask; no existing NAS data, reboot, real VPN or second-architecture execution.'}));
} finally {
  const failures: string[]=[];
  for(const name of containers.reverse())try{docker('rm','-f',name);}catch{failures.push(name);}
  for(const name of volumes.reverse())try{docker('volume','rm',name);}catch{failures.push(name);}
  if(failures.length){console.error(`Synthetic resource cleanup failed: ${failures.join(', ')}`);process.exitCode=1;}
}
