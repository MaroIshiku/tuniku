import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {ManagedStackEngine,ManagedStore} from '../src/server/management/engine.js';
import {SocketManagedDocker} from '../src/server/management/docker.js';
import {ServerCatalog} from '../src/server/compose/serverCatalog.js';
// Run only against a local Unix-socket engine with disposable owned resources.
// Gluetun runs an offline sleep fixture with a synthetic health check. The
// client is a Node process named jdownloader, not the JDownloader application.
const vpnImage=process.env.GLUETUN_TEST_IMAGE;
const appImage=process.env.TUNIKU_TEST_IMAGE;
if(!vpnImage||!/^qmcgaw\/gluetun@sha256:[a-f0-9]{64}$/.test(vpnImage))throw Error('Set GLUETUN_TEST_IMAGE to an already local exact official architecture digest.');
if(!appImage||!/^sha256:[a-f0-9]{64}$/.test(appImage))throw Error('Set TUNIKU_TEST_IMAGE to an immutable already local Tuniku image ID.');
const root=new URL('../',import.meta.url);
const prefix='tuniku-managed-test-'+randomUUID().slice(0,8);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),prefix+'-'));const volumeName=prefix+'-data';
function docker(...args:string[]){try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:2097152}).trim()}catch{throw Error('Synthetic Docker operation failed: '+args[0])}}
class ObservedDocker extends SocketManagedDocker {
 writes:string[]=[];failNextClient=false;retainedClients=new Set<string>();
 async create(name:string,configuration:Record<string,any>){this.writes.push('create');return super.create(name,configuration)}
 async rename(id:string,name:string){this.writes.push('rename');return super.rename(id,name)}
 async start(id:string){this.writes.push('start');return super.start(id)}
 async stop(id:string){this.writes.push('stop');return super.stop(id)}
 async remove(id:string){this.writes.push('remove');return super.remove(id)}
 async waitHealthy(id:string,required:boolean){await super.waitHealthy(id,required);if(this.failNextClient&&!required&&!this.retainedClients.has(id)){this.failNextClient=false;throw Error('Synthetic forced new-client health failure')}}
}
const endpoint=process.env.DOCKER_HOST&&!process.env.DOCKER_CONTEXT?process.env.DOCKER_HOST:docker('context','inspect','--format','{{.Endpoints.docker.Host}}');
const socketUrl=new URL(endpoint);
if(socketUrl.protocol!=='unix:'||socketUrl.hostname||socketUrl.username||socketUrl.password||socketUrl.search||socketUrl.hash)throw Error('The managed lifecycle test requires a local Unix-socket Docker context.');
// Scope the test socket to resources carrying this run's ownership label.
// Unrelated host containers are neither detailed nor mutated by this harness.
const actualSocket=decodeURIComponent(socketUrl.pathname);
const scopedSocket=path.join(directory,'owned-docker.sock');
const ownedIds=new Set<string>();
const bridge=http.createServer(async(request,response)=>{
 try {
  const url=new URL(request.url!,'http://owned.test');
  const list=request.method==='GET'&&url.pathname==='/containers/json';
  const create=request.method==='POST'&&url.pathname==='/containers/create';
  const match=url.pathname.match(/^\/containers\/([a-f0-9]{64})(?:\/(json|stop|start|rename))?$/);
  if(!list&&!create&&(!match||!ownedIds.has(match[1]!))){response.writeHead(403);response.end();return}
  const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>4*1024*1024)throw Error('Oversized synthetic request');chunks.push(chunk)}
  const body=Buffer.concat(chunks);
  if(create){const config=JSON.parse(body.toString());assert.equal(config.Labels?.['tuniku.test'],prefix);assert.equal(config.Labels?.['com.docker.compose.project'],prefix)}
  const forwarded=http.request({socketPath:actualSocket,path:request.url,method:request.method,headers:{'content-type':'application/json',...(body.length?{'content-length':body.length}:{})}},upstream=>{
   const result:Buffer[]=[];let length=0;
   upstream.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>4*1024*1024)forwarded.destroy();else result.push(chunk)});
   upstream.on('end',()=>{
    try{
     let bytes=Buffer.concat(result);
     if(list&&upstream.statusCode===200){const rows=JSON.parse(bytes.toString()).filter((container:any)=>container.Labels?.['tuniku.test']===prefix);for(const container of rows)ownedIds.add(container.Id);bytes=Buffer.from(JSON.stringify(rows))}
     if(create&&upstream.statusCode===201)ownedIds.add(JSON.parse(bytes.toString()).Id);
     response.writeHead(upstream.statusCode??502,{'content-type':'application/json'});response.end(bytes);
    }catch{response.writeHead(502);response.end()}
   });
  });
  forwarded.setTimeout(40000,()=>forwarded.destroy());forwarded.on('error',()=>{response.writeHead(502);response.end()});forwarded.end(body);
 }catch{response.writeHead(403);response.end()}
});
await new Promise<void>(resolve=>bridge.listen(scopedSocket,resolve));
const backend=new ObservedDocker(scopedSocket,15000,[prefix,`${prefix}-outside`]);
const store=new ManagedStore(path.join(directory,'managed'),randomUUID()+randomUUID());
const engine=new ManagedStackEngine(backend,store,[prefix],[],new ServerCatalog(directory));
const ownerLabels=['--label',`tuniku.test=${prefix}`];const projectLabels=[...ownerLabels,'--label',`com.docker.compose.project=${prefix}`];
const hardening=['--pull','never','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','1000:1000','--memory','128m','--pids-limit','32','--log-driver','none'];
const change={taskType:'configure_provider' as const,provider:'private internet access',vpnType:'openvpn' as const,openvpnUser:'synthetic-runtime-user',openvpnPassword:'synthetic-runtime-new-password'};
const marker='synthetic-volume-'+randomUUID();let volumeCreated=false;
let result:any={status:'IMPLEMENTED_BUT_NOT_VERIFIED',scope:'Synthetic real-Docker process/namespace/volume/rollback tests only; no VPN, Control API, leak or NAS reboot proof'};
try{
 const expectedVpnImage=docker('image','inspect',vpnImage,'--format','{{.Id}}');assert.equal(docker('image','inspect',appImage,'--format','{{.Id}}'),appImage);
 docker('volume','create',...ownerLabels,volumeName);volumeCreated=true;
 const vpnId=docker('run','-d','--name',prefix+'-vpn',...projectLabels,'--label','com.docker.compose.service=vpn',...hardening,'--network','none','--entrypoint','/bin/sleep','--health-cmd','/bin/true','--health-interval','1s','--health-timeout','1s','--health-retries','3','-e','VPN_SERVICE_PROVIDER=private internet access','-e','VPN_TYPE=openvpn','-e','OPENVPN_USER=synthetic-runtime-user','-e','OPENVPN_PASSWORD=synthetic-runtime-old-password',vpnImage,'3600');ownedIds.add(vpnId);await backend.waitHealthy(vpnId,true);
 const clientId=docker('run','-d','--name',prefix+'-jdownloader',...projectLabels,'--label','com.docker.compose.service=jdownloader',...hardening,'--network','container:'+vpnId,'--no-healthcheck','--mount',`type=volume,source=${volumeName},target=/data`,'--entrypoint','/nodejs/bin/node',appImage,'-e','setInterval(()=>{},1000)');backend.retainedClients.add(clientId);
 docker('exec',clientId,'/nodejs/bin/node','-e',`require('node:fs').writeFileSync('/data/synthetic-marker',${JSON.stringify(marker)})`);
 const readMarker=(id:string)=>docker('exec',id,'/nodejs/bin/node','-e',"process.stdout.write(require('node:fs').readFileSync('/data/synthetic-marker','utf8'))");assert.equal(readMarker(clientId),marker);
 const foreignId=docker('run','-d','--name',prefix+'-outside',...ownerLabels,'--label',`com.docker.compose.project=${prefix}-outside`,'--label','com.docker.compose.service=unadopted',...hardening,'--network','none','--no-healthcheck','--entrypoint','/nodejs/bin/node',appImage,'-e','setInterval(()=>{},1000)');
 for(const id of [vpnId,clientId,foreignId])ownedIds.add(id);
 const candidates=await backend.candidates([prefix]);assert.ok(candidates.some(c=>c.id===vpnId));assert.ok(candidates.some(c=>c.id===clientId));assert.ok(!candidates.some(c=>c.id===foreignId));
 assert.deepEqual(candidates.find(candidate=>candidate.id===clientId)?.network,{kind:'vpn_namespace',vpnId});
 result.step="outside-project rejection";const beforeForeign=backend.writes.length;await assert.rejects(engine.adopt(vpnId,[foreignId],true),/allowlist|separate projects/);assert.equal(backend.writes.length,beforeForeign);
 const project=await engine.adopt(vpnId,[clientId],true);assert.equal((await engine.diagnostics(project.id)).applications[0].namespace,'attached');
 assert.equal((await engine.diagnostics(project.id)).configuration.state,'matched');
 const plan=await engine.plan(project.id,change);const operation=await engine.apply(plan.id,true);assert.equal(operation.status,'succeeded');
 assert.equal((await engine.diagnostics(project.id)).configuration.state,'matched');
 const savedState=store.load<Record<string,any>>('project',project.id);
 const current=engine.projects().find(p=>p.id===project.id)!;assert.notEqual(current.vpnId,vpnId);assert.notEqual(current.clientIds[0],clientId);backend.retainedClients.add(current.clientIds[0]);
 const vpn=await backend.inspect(current.vpnId);const client=await backend.inspect(current.clientIds[0]);assert.equal(vpn.Image,expectedVpnImage);assert.ok([current.vpnId,current.vpnId.slice(0,12),vpn.Name.slice(1)].includes(client.HostConfig.NetworkMode.slice(10)));
 assert.equal(vpn.Config.Labels['com.ishiku.tuniku.role'],'gluetun');assert.equal((await backend.candidates([prefix])).find(c=>c.id===current.vpnId)?.role,'vpn');
 assert.ok(vpn.Config.Env.includes('OPENVPN_PASSWORD=synthetic-runtime-new-password'));assert.equal(client.Mounts?.find(m=>m.Destination==='/data')?.Name,volumeName);assert.equal(readMarker(current.clientIds[0]),marker);assert.equal((await backend.inspect(vpnId)).State.Running,false);assert.equal((await backend.inspect(clientId)).State.Running,false);
 const beforeRecovery=backend.writes.length;await assert.rejects(engine.adopt(vpnId,[clientId],true),/Retained recovery/);assert.equal(backend.writes.length,beforeRecovery);
 // Seed only our encrypted fixture record with a genuinely obsolete running namespace.
 docker('start',vpnId);docker('start',clientId);store.save('project',project.id,{...savedState,clientIds:[clientId]});
 const stale=await engine.diagnostics(project.id);assert.equal(stale.applications[0].namespace,'different');assert.equal(stale.applications[0].state,'running');
 result.step="obsolete namespace rejection";const beforeStale=backend.writes.length;await assert.rejects(engine.plan(project.id,change),/no longer shares/);assert.equal(backend.writes.length,beforeStale);store.save('project',project.id,savedState);docker('stop','--time','2',clientId);docker('stop','--time','2',vpnId);
 // Actual external stop invalidates a preview before any manager writes.
 result.step="runtime stop drift rejection";const driftPlan=await engine.plan(project.id,change);docker('stop','--time','2',current.clientIds[0]);assert.equal((await engine.diagnostics(project.id)).configuration.state,'matched');const beforeDrift=backend.writes.length;const refusedDrift=await engine.apply(driftPlan.id,true);assert.equal(refusedDrift.status,'rolled_back');assert.equal(refusedDrift.step,'Validation failed before container changes.');assert.equal(backend.writes.length,beforeDrift);docker('start',current.clientIds[0]);
 // Force only new-client verification to fail after actual Docker recreation.
 result.step="forced health rollback";const rollbackPlan=await engine.plan(project.id,{...change,openvpnPassword:'synthetic-runtime-rollback-password'});backend.failNextClient=true;
 const rollback=await engine.apply(rollbackPlan.id,true);assert.equal(rollback.status,'rolled_back');const restored=engine.projects().find(p=>p.id===project.id)!;assert.equal(restored.vpnId,current.vpnId);assert.deepEqual(restored.clientIds,current.clientIds);assert.equal((await engine.diagnostics(project.id)).applications[0].namespace,'attached');assert.equal((await engine.diagnostics(project.id)).configuration.state,'matched');assert.equal(readMarker(restored.clientIds[0]),marker);assert.ok((await backend.inspect(restored.vpnId)).Config.Env.includes('OPENVPN_PASSWORD=synthetic-runtime-new-password'));
 const cleanupReview=await engine.reviewCleanup(operation.id);assert.deepEqual(new Set(cleanupReview.containers.map(c=>c.id)),new Set([vpnId,clientId]));await engine.cleanup(operation.id,cleanupReview.fingerprint,true);assert.equal(readMarker(restored.clientIds[0]),marker);assert.equal(engine.storageStatus().retainedContainers,0);
 result={...result,status:'PASS',socketScope:'Actual Docker RPCs through an owned-label-only test bridge; no unapproved foreign detail reads',project:prefix,vpnImageId:expectedVpnImage,appImageId:appImage,oldVpnId:vpnId,newVpnId:current.vpnId,oldClientId:clientId,newClientId:current.clientIds[0],scenarios:['actual namespace recreation','existing named-volume data retained','outside-project exclusion before writes','actual network inventory and retained recovery exclusion','running client on obsolete VPN namespace diagnosed and refused','actual runtime drift invalidates preview without writes','actual Docker rollback after forced client health failure','custom VPN role survives pinned-image recreation','confirmed retained-original cleanup preserves live volume data'],vpnConnectivityTested:false,nasRebootTested:false,clientFixture:'Node process, not the JDownloader application',vpnHealth:'synthetic /bin/true',dockerClient:docker('version','--format','{{.Client.Version}}'),engine:docker('version','--format','{{.Server.Version}}'),compose:docker('compose','version','--short'),sourceSha256:Object.fromEntries(['scripts/verify-managed-lifecycle.ts','src/server/management/engine.ts','src/server/management/docker.ts','src/server/management/inventory.ts','src/server/management/settings.ts','src/server/management/export.ts','src/server/compose/generator.ts'].map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL(file,root))).digest('hex')]))};
}catch(error){result.error=error instanceof Error?error.message:'Synthetic probe failed';process.exitCode=1;}
finally{
 await new Promise<void>(resolve=>bridge.close(()=>resolve()));
 const failures:string[]=[];
 try{const owned=docker('ps','-aq','--no-trunc','--filter',`label=tuniku.test=${prefix}`).split('\n').filter(Boolean).map(id=>JSON.parse(docker('inspect',id))[0]);owned.sort((a,b)=>Number(!String(a.HostConfig.NetworkMode).startsWith('container:'))-Number(!String(b.HostConfig.NetworkMode).startsWith('container:')));result.containers_seen=owned.length;for(const meta of owned){try{assert.equal(meta.Config.Labels['tuniku.test'],prefix);docker('rm','-f',meta.Id)}catch{failures.push(meta.Id)}}}catch{failures.push('enumeration')}
 if(volumeCreated)try{const metadata=JSON.parse(docker('volume','inspect',volumeName))[0];assert.equal(metadata.Labels['tuniku.test'],prefix);docker('volume','rm',volumeName)}catch{failures.push(volumeName)}
 fs.rmSync(directory,{recursive:true,force:true});result.cleanupFailures=failures;if(failures.length){process.exitCode=1;result.status='IMPLEMENTED_BUT_NOT_VERIFIED'}
 const report=new URL('.ishiku/reports/managed-lifecycle.json',root);fs.mkdirSync(new URL('.ishiku/reports/',root),{recursive:true});fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
