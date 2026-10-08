import crypto from "node:crypto";
import { exportManagedCompose } from "./export.js";
import { containerEnvironment, settingsFields, settingsFromEnvironment, wireguardMountSource } from "./settings.js";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { generateCompose, type ComposeGenerationInput } from "../compose/generator.js";
import { gluetunProviderProfiles } from "../compose/providers.js";
import { managedRecoveryIds } from "./inventory.js";
import { ServerCatalog } from "../compose/serverCatalog.js";
import { bindingsOverlap, dockerBindings, type HostBinding } from "../compose/ports.js";

export class ManagedError extends Error { constructor(message: string, public readonly code?: string) { super(message); } }

export interface ManagedContainer {
  Id: string;
  Name: string;
  Image?: string;
  Config: Record<string, any>;
  HostConfig: Record<string, any>;
  NetworkSettings?: { Networks?: Record<string, any> };
  Mounts?: Array<{ Type: string; Name?: string; Destination: string; RW?: boolean }>;
  State: { Running?: boolean; Status?: string; ExitCode?: number; Health?: { Status?: string } };
}
export interface ManagedDocker {
  inspect(id: string): Promise<ManagedContainer>;
  dependents(vpn: ManagedContainer): Promise<string[]>;
  hostBindings(excludeId: string): Promise<HostBinding[]>;
  create(name: string, configuration: Record<string, any>): Promise<string>;
  rename(id: string, name: string): Promise<void>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  waitHealthy(id: string, requireHealth: boolean): Promise<void>;
}
export type ManagedServiceDiagnostic = { id: string; name: string | null; availability: "available" | "missing" | "unavailable" | "out_of_scope"; state: string | null; health: string | null; exitCode: number | null; namespace: "vpn" | "attached" | "different" | "not_shared" | "unknown"; issue: string | null };
export type ManagedConfiguration = { state: "matched" | "drifted" | "unavailable"; baselineAt: string | null; baselineSource: "adoption" | "successful_apply" | "unavailable"; changedServiceIds: string[] };
export type ManagedDiagnostics = { projectId: string; observedAt: string; stale: boolean; vpn: ManagedServiceDiagnostic; applications: ManagedServiceDiagnostic[]; configuration: ManagedConfiguration; publishedPorts: Record<string, unknown> | null };
type Baseline = { containers: ManagedContainer[]; observedAt: string; operationId: string | null };
type Project = { id: string; vpnId: string; clientIds: string[]; composeProject: string; vpnImageId?: string };
type Plan = { id: string; projectId: string; expiresAt: number; snapshots: ManagedContainer[]; fingerprint: string; desired: Record<string, any>; summary: ChangeSummary; baseline?: Baseline };
export type ChangeSummary = { id: string; projectId: string; expiresAt: string; environmentKeys: string[]; removedEnvironmentKeys: string[]; portsChanged: boolean; portsBefore: Record<string, unknown>; portsAfter: Record<string, unknown>; services: Array<{ name: string; image: string; running: boolean }>; interruptionRequired: boolean; warnings: string[] };
type Operation = { id: string; projectId: string; planId: string; status: "applying" | "succeeded" | "rolled_back" | "rollback_failed" | "interrupted"; step: string; createdIds: string[]; renamedIds: string[]; snapshots: ManagedContainer[]; startedAt: string; finishedAt: string | null; error: string | null; cleanupStatus?: "applying" | "completed" | "interrupted"; cleanedIds?: string[]; manualRecoveryAt?: string };

const nameOf = (container: ManagedContainer): string => container.Name.replace(/^\//, "");
const providerKeys = new Set(["VPN_SERVICE_PROVIDER", "VPN_TYPE", "ISP", ...Object.keys({ WIREGUARD_PRIVATE_KEY: 0, WIREGUARD_ADDRESSES: 0, WIREGUARD_PRESHARED_KEY: 0, WIREGUARD_PUBLIC_KEY: 0, WIREGUARD_ENDPOINT_IP: 0, WIREGUARD_ENDPOINT_PORT: 0, OPENVPN_USER: 0, OPENVPN_PASSWORD: 0, OPENVPN_CERT: 0, OPENVPN_KEY: 0, OPENVPN_ENCRYPTED_KEY: 0, OPENVPN_KEY_PASSPHRASE: 0, OPENVPN_CUSTOM_CONFIG: 0 }), ...["COUNTRIES", "REGIONS", "CITIES", "HOSTNAMES", "NAMES", "CATEGORIES"].map((key) => `SERVER_${key}`), ...gluetunProviderProfiles.flatMap((profile) => profile.options.map((option) => option.env))]);
function identity(containers: ManagedContainer[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(containers.map((container) => ({ id: container.Id, name: container.Name, imageId: container.Image, configuration: container.Config, host: container.HostConfig, mounts: container.Mounts, networks: container.NetworkSettings?.Networks, running: Boolean(container.State.Running) })))).digest("hex");
}
function configurationIdentity(container: ManagedContainer): string {
  // Exclude dynamic IPs, counters, health and process state. Compare configured values only.
  return crypto.createHash("sha256").update(JSON.stringify({ id: container.Id, name: container.Name, image: container.Image, config: container.Config, host: container.HostConfig, mounts: container.Mounts, networks: Object.entries(container.NetworkSettings?.Networks ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, endpoint]) => [name, { aliases: endpoint.Aliases ?? [], ipam: endpoint.IPAMConfig ?? null }]) })).digest("hex");
}
function createConfiguration(container: ManagedContainer): Record<string, any> {
  const configuration: Record<string, any> = { ...container.Config, HostConfig: structuredClone(container.HostConfig) };
  if (configuration.Hostname === container.Id.slice(0, 12) || configuration.Hostname === container.Id) delete configuration.Hostname;
  configuration.Image = container.Image ?? container.Config.Image;
  // Docker assigns names to anonymous volumes. Reuse those exact volumes.
  for (const mount of container.Mounts ?? []) {
    if (mount.Type !== "volume") continue;
    if (!mount.Name) throw new ManagedError("A volume has no recoverable Docker identity.");
    const bound = (configuration.HostConfig.Binds ?? []).some((bind: string) => bind.split(":")[1] === mount.Destination)
      || (configuration.HostConfig.Mounts ?? []).some((existing: any) => existing.Target === mount.Destination);
    if (!bound) (configuration.HostConfig.Mounts ??= []).push({ Type: "volume", Source: mount.Name, Target: mount.Destination, ReadOnly: mount.RW === false });
  }
  // Preserve explicit network attachments; do not reuse endpoint IDs or IPAM state.
  const networks = container.NetworkSettings?.Networks;
  if (networks && !String(container.HostConfig.NetworkMode ?? "").startsWith("container:")) {
    configuration.NetworkingConfig = { EndpointsConfig: Object.fromEntries(Object.entries(networks).map(([name, endpoint]) => [name, { Aliases: (endpoint.Aliases ?? []).filter((alias: string) => alias !== container.Id && alias !== container.Id.slice(0, 12)) }])) };
  }
  return configuration;
}

/** Encrypted, atomic helper-local storage; never serialize these records into an API response. */
export class ManagedStore {
  private readonly encryptionKey: Buffer;
  constructor(private readonly directory: string, secret: string) {
    if (secret.length < 32) throw new ManagedError("A manager key of at least 32 characters is required.");
    this.encryptionKey = crypto.createHash("sha256").update(`Tuniku managed storage\0${secret}`).digest();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if ((fs.statSync(directory).mode & 0o077) !== 0) throw new ManagedError("Manager storage requires private Linux filesystem permissions.");
  }
  private filename(kind: string, id: string): string {
    if (!["project", "plan", "operation", "baseline", "review"].includes(kind) || !/^[0-9a-f-]{36}$/.test(id)) throw new ManagedError("Invalid managed record identity.");
    return path.join(this.directory, `${kind}-${id}.json`);
  }
  save(kind: string, id: string, value: unknown): void {
    const target = this.filename(kind, id);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(`${kind}:${id}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const payload = JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, payload); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, target);
    const directory = fs.openSync(this.directory, "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
  load<T>(kind: string, id: string): T {
    try {
      const payload = JSON.parse(fs.readFileSync(this.filename(kind, id), "utf8"));
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(payload.iv, "base64"));
      decipher.setAAD(Buffer.from(`${kind}:${id}`));
      decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString()) as T;
    } catch { throw new ManagedError("Managed state is missing or unreadable. Preserve the state and original manager key for recovery."); }
  }
  removeReview(id: string): void { fs.unlinkSync(this.filename("review", id)); }
  removePlan(id: string): void { fs.unlinkSync(this.filename("plan", id)); }
  bytes(): number { return fs.readdirSync(this.directory).filter(file => /^(?:project|plan|operation|baseline|review)-[0-9a-f-]{36}\.json$/.test(file)).reduce((sum, file) => sum + fs.statSync(path.join(this.directory, file)).size, 0); }
  ids(kind: string): string[] { return fs.readdirSync(this.directory).filter((entry) => entry.startsWith(`${kind}-`) && entry.endsWith(".json")).map((entry) => entry.slice(kind.length + 1, -5)); }
}

export class ManagedStackEngine {
  private readonly locks = new Set<string>();
  private readonly running = new Set<Promise<unknown>>();
  constructor(private readonly docker: ManagedDocker, private readonly store: ManagedStore, private readonly allowedProjects: string[], private readonly allowedBindRoots: string[], private readonly catalog: ServerCatalog) {
    // A process crash never causes automatic replay of an incomplete mutation.
    for (const id of store.ids("operation")) {
      const operation = store.load<Operation>("operation", id);
      if (operation.cleanupStatus === "applying") { operation.cleanupStatus = "interrupted"; store.save("operation", id, operation); }
      if (operation.status === "applying") {
        operation.status = "interrupted"; operation.step = "Manual recovery required after helper restart.";
        store.save("operation", id, operation);
      }
    }
  }
  private baseline(projectId: string): Baseline | null {
    return this.store.ids("baseline").includes(projectId) ? this.store.load<Baseline | null>("baseline", projectId) : null;
  }
  async diagnostics(projectId: string): Promise<ManagedDiagnostics> {
    const project = this.store.load<Project>("project", projectId);
    const baseline = this.baseline(projectId);
    if (!this.allowedProjects.includes(project.composeProject)) throw new ManagedError("The adopted project is outside the current allowlist.");
    const read = async (id: string): Promise<ManagedContainer | ManagedServiceDiagnostic> => {
      try {
        const container = await this.docker.inspect(id);
        if (container.Id !== id || container.Config.Labels?.["com.docker.compose.project"] !== project.composeProject) return { id, name: null, availability: "out_of_scope", state: null, health: null, exitCode: null, namespace: "unknown", issue: "The adopted container identity or project changed. Review its ownership before continuing." };
        return container;
      } catch (error) { return { id, name: null, availability: error instanceof ManagedError && error.code === "not_found" ? "missing" : "unavailable", state: null, health: null, exitCode: null, namespace: "unknown", issue: "The adopted container could not be inspected. Check its existence and Docker access." }; }
    };
    const containers = await Promise.all([project.vpnId, ...project.clientIds].map(read));
    const vpn = containers[0]!;
    const targets = "Id" in vpn ? [vpn.Id, vpn.Id.slice(0, 12), nameOf(vpn)] : [];
    const rows = containers.map((container, index): ManagedServiceDiagnostic => {
      if (!("Id" in container)) return container;
      const mode = String(container.HostConfig.NetworkMode ?? "");
      const namespace = index === 0 ? "vpn" : !targets.length ? "unknown" : !mode.startsWith("container:") ? "not_shared" : targets.includes(mode.slice(10)) ? "attached" : "different";
      return { id: container.Id, name: nameOf(container), availability: "available", state: container.State.Status || (container.State.Running === true ? "running" : container.State.Running === false ? "stopped" : "unknown"), health: container.State.Health?.Status ?? null, exitCode: Number.isInteger(container.State.ExitCode) ? container.State.ExitCode! : null, namespace,
        issue: namespace === "different" ? "This application references a different or outdated VPN namespace. Review and recreate its network association before applying a managed change." : namespace === "not_shared" ? "This application no longer shares the adopted VPN namespace. Review its routing before continuing." : namespace === "unknown" ? "The VPN could not be inspected, so this application's network association is unverified." : null };
    });
    const latest = this.store.load<Project>("project", projectId);
    const changedServiceIds = baseline ? containers.flatMap((container, index) => "Id" in container && baseline.containers[index] && configurationIdentity(container) !== configurationIdentity(baseline.containers[index]!) ? [container.Id] : []) : [];
    const complete = baseline && baseline.containers.length === containers.length && containers.every(container => "Id" in container);
    const configuration: ManagedConfiguration = { state: !complete ? "unavailable" : changedServiceIds.length ? "drifted" : "matched", baselineAt: baseline?.observedAt ?? null, baselineSource: baseline ? baseline.operationId ? "successful_apply" : "adoption" : "unavailable", changedServiceIds };
    return { projectId, observedAt: new Date().toISOString(), stale: JSON.stringify(latest) !== JSON.stringify(project) || JSON.stringify(this.baseline(projectId)) !== JSON.stringify(baseline), vpn: rows[0]!, applications: rows.slice(1), configuration, publishedPorts: "Id" in vpn ? vpn.HostConfig.PortBindings ?? {} : null };
  }
  private assertSafe(container: ManagedContainer, vpn: boolean, approvedImage?: string): void {
    const host = container.HostConfig;
    if (!/^[a-f0-9]{64}$/.test(container.Id) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/.test(nameOf(container))) throw new ManagedError("Unsupported container identity.");
    const project = container.Config.Labels?.["com.docker.compose.project"];
    if (!this.allowedProjects.includes(project)) throw new ManagedError("The Compose project is outside the manager allowlist.");
    if (host.RestartPolicy?.Name === "always") throw new ManagedError("Restart policy always is unsupported: stopped recovery containers can restart with Docker. Review and change it to unless-stopped before adoption.");
    if (host.Privileged || ["host", "service:host"].includes(host.NetworkMode) || host.PidMode === "host" || host.IpcMode === "host" || host.VolumesFrom?.length || host.DeviceRequests?.length) throw new ManagedError("Privileged or host-sharing containers cannot be adopted.");
    if (host.UsernsMode === "host" || host.CgroupnsMode === "host" || host.DeviceCgroupRules?.length || (host.SecurityOpt ?? []).some((option: string) => /unconfined|label[=:]disable/.test(option))) throw new ManagedError("Unsupported host isolation settings require a separate review.");
    if (Object.values(container.NetworkSettings?.Networks ?? {}).some((endpoint: any) => endpoint.IPAMConfig?.IPv4Address || endpoint.IPAMConfig?.IPv6Address)) throw new ManagedError("Static network addresses require a separate migration review.");
    const caps = host.CapAdd ?? [];
    if (caps.some((cap: string) => !vpn || cap !== "NET_ADMIN")) throw new ManagedError("The container requests capabilities outside the managed profile.");
    if ((host.Devices ?? []).some((device: any) => !vpn || device.PathOnHost !== "/dev/net/tun" || device.PathInContainer !== "/dev/net/tun")) throw new ManagedError("Unsupported managed device mapping.");
    for (const bind of host.Binds ?? []) {
      const source = String(bind).split(":")[0]!;
      if (source.startsWith("/") && (!this.allowedBindRoots.some((root) => source === root || source.startsWith(`${root}/`)) || source.includes("/../") || source.endsWith("/..") || /docker\.sock|podman\.sock/.test(source))) throw new ManagedError("A bind mount is outside the approved data roots.");
    }
    // Long-form host bind mounts are checked separately from Binds.
    for (const mount of host.Mounts ?? []) {
      if (mount.Type === "bind" && (!this.allowedBindRoots.some((root) => mount.Source === root || mount.Source.startsWith(`${root}/`)) || /(?:^|\/)\.\.(?:\/|$)|docker\.sock|podman\.sock/.test(mount.Source))) throw new ManagedError("A bind mount is outside the approved data roots.");
    }
    if (vpn && !/^(?:docker\.io\/)?qmcgaw\/gluetun(?::|@)/.test(String(container.Config.Image)) && !(approvedImage && container.Image === approvedImage && container.Config.Image === approvedImage)) throw new ManagedError("Only the official Gluetun image can be managed.");
    if (!vpn && !String(host.NetworkMode ?? "").startsWith("container:")) throw new ManagedError("Only applications already routed through this VPN stack can be adopted; moving an existing application requires a migration decision.");
  }
  private async snapshots(project: Project): Promise<ManagedContainer[]> {
    const snapshots = await Promise.all([project.vpnId, ...project.clientIds].map((id) => this.docker.inspect(id)));
    for (const [index, container] of snapshots.entries()) {
      if (container.Id !== [project.vpnId, ...project.clientIds][index]) throw new ManagedError("Docker returned a different container identity.");
      this.assertSafe(container, index === 0, project.vpnImageId);
      if (container.Config.Labels?.["com.docker.compose.project"] !== project.composeProject) throw new ManagedError("The adopted project identity changed.");
      if (index > 0 && ![project.vpnId, project.vpnId.slice(0, 12), nameOf(snapshots[0]!)].includes(String(container.HostConfig.NetworkMode).slice(10))) throw new ManagedError("An application no longer shares the adopted VPN namespace. Review its association before applying changes.");
    }
    await this.assertDependents(snapshots[0]!, project.clientIds);
    return snapshots;
  }
  private async assertDependents(vpn: ManagedContainer, clients: string[]): Promise<void> {
    const actual = await this.docker.dependents(vpn);
    if (actual.some((id) => !clients.includes(id))) throw new ManagedError("Select every application sharing this VPN namespace. Applications outside the approved project require a migration review.");
  }
  private async assertPorts(vpnId: string, configuration: Record<string, any>): Promise<void> {
    const planned = dockerBindings(configuration.HostConfig.PortBindings ?? {});
    if (!planned.length) return;
    const occupied = await this.docker.hostBindings(vpnId);
    if (planned.some((binding) => occupied.some((other) => bindingsOverlap(binding, other))) || planned.some((binding, index) => planned.slice(index + 1).some((other) => bindingsOverlap(binding, other)))) throw new ManagedError("A requested host port conflicts with an existing published binding. Review its address, protocol and port before applying.");
  }
  async adopt(vpnId: string, clientIds: string[], confirmed: boolean): Promise<{ id: string; services: string[] }> {
    if (!confirmed) throw new ManagedError("Confirm adoption of the selected VPN and applications.");
    if (clientIds.length > 20 || new Set([vpnId, ...clientIds]).size !== clientIds.length + 1) throw new ManagedError("Invalid application selection.");
    const recovery = managedRecoveryIds(this.operations());
    if ([vpnId, ...clientIds].some(id => recovery.has(id))) throw new ManagedError("Retained recovery containers cannot be adopted as a new stack. Review the existing operation and recovery state.");
    const vpn = await this.docker.inspect(vpnId); this.assertSafe(vpn, true);
    const clients = await Promise.all(clientIds.map((id) => this.docker.inspect(id)));
    const composeProject = String(vpn.Config.Labels["com.docker.compose.project"]);
    for (const client of clients) {
      this.assertSafe(client, false);
      if (client.Config.Labels["com.docker.compose.project"] !== composeProject) throw new ManagedError("Applications in separate projects require a migration decision.");
      const target = String(client.HostConfig.NetworkMode).slice(10);
      if (![vpnId, vpnId.slice(0, 12), nameOf(vpn)].includes(target)) throw new ManagedError("An application references a different or replaced VPN container. Repair its association before adoption.");
    }
    await this.assertDependents(vpn, clientIds);
    for (const id of this.store.ids("project")) {
      const existing = this.store.load<Project>("project", id);
      if ([existing.vpnId, ...existing.clientIds].some((id) => [vpnId, ...clientIds].includes(id))) throw new ManagedError("A selected container is already owned by a managed project.");
    }
    const id = crypto.randomUUID();
    this.store.save("baseline", id, { containers: [vpn, ...clients], observedAt: new Date().toISOString(), operationId: null } satisfies Baseline);
    this.store.save("project", id, { id, vpnId, clientIds, composeProject, ...(vpn.Image ? { vpnImageId: vpn.Image } : {}) } satisfies Project);
    return { id, services: [vpn, ...clients].map(nameOf) };
  }
  async plan(projectId: string, input: ComposeGenerationInput): Promise<ChangeSummary> {
    if (this.locks.has(projectId) || this.operations().some(operation => operation.projectId === projectId && (["applying", "interrupted", "rollback_failed"].includes(operation.status) || operation.cleanupStatus === "applying" || operation.cleanupStatus === "interrupted"))) throw new ManagedError("An active or incomplete operation locks this project. Review its recovery state before preparing another change.");
    if (!["configure_provider", "configure_wireguard", "configure_openvpn", "set_server_selection", "publish_app_port"].includes(input.taskType)) throw new ManagedError("This task is not supported by the managed change profile.");
    if (input.provider === "custom" && input.vpnType === "openvpn") throw new ManagedError("Custom host configuration files need a separate reviewed import path.");
    const project = this.store.load<Project>("project", projectId);
    const snapshots = await this.snapshots(project);
    const vpn = snapshots[0]!;
    const current = containerEnvironment(vpn);
    if (input.taskType === "set_server_selection" && ((input.provider && input.provider !== current.VPN_SERVICE_PROVIDER) || (input.vpnType && input.vpnType !== current.VPN_TYPE))) throw new ManagedError("Server selection must retain the observed provider and protocol. Use a complete provider change instead.");
    const sameProvider = (!input.provider || input.provider === current.VPN_SERVICE_PROVIDER) && (!input.vpnType || input.vpnType === current.VPN_TYPE);
    const clearKeys = input.managedClearEnvironmentKeys ?? [];
    if (clearKeys.some(key => !providerKeys.has(key) || ["VPN_SERVICE_PROVIDER", "VPN_TYPE"].includes(key))) throw new ManagedError("Only supported provider settings may be explicitly cleared.");
    const retained = sameProvider ? settingsFromEnvironment(current) : { taskType: input.taskType };
    const patches = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== "" && value !== undefined));
    input = { ...retained, ...patches, providerOptions: { ...(sameProvider ? settingsFromEnvironment(current).providerOptions : {}), ...Object.fromEntries(Object.entries(input.providerOptions ?? {}).filter(([, value]) => value !== "")) } } as ComposeGenerationInput;
    for (const [field, key] of Object.entries(settingsFields)) if (clearKeys.includes(key)) delete (input as any)[field];
    for (const key of clearKeys) delete input.providerOptions?.[key];
    if (input.anyLocation) for (const field of ["countries", "regions", "cities", "hostnames", "serverNames"] as const) delete input[field];
    if (input.vpnType === "wireguard" && input.taskType !== "publish_app_port" && wireguardMountSource(vpn) !== "environment") throw new ManagedError("A WireGuard configuration file may override environment changes. Review the mounted file source manually; Tuniku does not read or modify it.");
    this.pruneExpiredPlans();
    if (this.store.ids("plan").length >= 1000) throw new ManagedError("Manager plan storage is full. Referenced recovery plans are protected. Review completed operations before preparing more changes.");
    const managedInput = { ...input };
    delete managedInput.pastedCompose;
    const generated = generateCompose({ ...managedInput, gluetunServiceName: "gluetun", includeSecrets: true }, this.catalog);
    if (!generated.validation.valid) throw new ManagedError("The proposed configuration did not pass validation.");
    const fragment = YAML.parse(generated.snippets.compose).services.gluetun;
    const desired = createConfiguration(vpn);
    const next = { ...current };
    if (input.taskType !== "publish_app_port") {
      for (const key of Object.keys(next)) {
        if (providerKeys.has(key) && (!sameProvider || clearKeys.includes(key) || input.anyLocation && ["SERVER_COUNTRIES", "SERVER_REGIONS", "SERVER_CITIES", "SERVER_HOSTNAMES", "SERVER_NAMES"].includes(key))) delete next[key];
      }
      // Compose escaping is serialization-specific; Docker's JSON API needs the literal values.
      for (const [key, value] of Object.entries(fragment.environment ?? {})) next[key] = String(value).replaceAll("$$", "$");
      const finalValidation = generateCompose({ ...settingsFromEnvironment(next), includeSecrets: true }, this.catalog);
      if (!finalValidation.validation.valid) throw new ManagedError("The complete resulting provider configuration is invalid.");
      desired.Env = Object.entries(next).map(([key, value]) => `${key}=${value}`);
    } else {
      const port = input.containerPort!;
      const protocol = input.protocol ?? "tcp";
      const binding = { HostIp: input.hostAddress?.replace(/^\[|\]$/g, "") ?? "", HostPort: String(input.hostPort!) };
      const key = `${port}/${protocol}`;
      const bindings = [...(desired.HostConfig.PortBindings?.[key] ?? [])];
      const action = input.managedPortAction ?? "add";
      if (action !== "add") {
        const original = input.managedOriginalBinding;
        const index = bindings.findIndex(existing => existing.HostIp === original?.address && existing.HostPort === original?.port);
        if (index < 0) throw new ManagedError("The selected original port binding is missing. Inspect ports again.");
        bindings.splice(index, 1);
      }
      if (action !== "remove" && !bindings.some(existing => (existing.HostIp === "0.0.0.0" ? "" : existing.HostIp ?? "") === (binding.HostIp === "0.0.0.0" ? "" : binding.HostIp) && existing.HostPort === binding.HostPort)) bindings.push(binding);
      desired.HostConfig.PortBindings = { ...(desired.HostConfig.PortBindings ?? {}), [key]: bindings };
      desired.ExposedPorts = { ...(desired.ExposedPorts ?? {}), [`${port}/${protocol}`]: {} };
    }
    desired.Labels = { ...(desired.Labels ?? {}), "com.ishiku.tuniku.role": "gluetun" };
    const changed = [...new Set([...Object.keys(current), ...Object.keys(next)])].filter((key) => current[key] !== next[key]).sort();
    const portsChanged = JSON.stringify(vpn.HostConfig.PortBindings ?? {}) !== JSON.stringify(desired.HostConfig.PortBindings ?? {});
    if (portsChanged) await this.assertPorts(vpn.Id, desired);
    const id = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60_000;
    const summary: ChangeSummary = { id, projectId, expiresAt: new Date(expiresAt).toISOString(), environmentKeys: changed, removedEnvironmentKeys: changed.filter(key => !(key in next)), portsChanged, portsBefore: vpn.HostConfig.PortBindings ?? {}, portsAfter: desired.HostConfig.PortBindings ?? {}, services: snapshots.map((container) => ({ name: nameOf(container), image: String(container.Config.Image), running: Boolean(container.State.Running) })), interruptionRequired: changed.length > 0 || portsChanged, warnings: ["Applying replaces the VPN container and recreates its routed applications. Existing volumes and data bindings are retained.", "Startup settings cannot be applied with a container restart. There will be an interruption.", "The encrypted recovery record and its original manager key are required for recovery.", ...(!vpn.State.Running ? ["The VPN is stopped and will remain stopped. Routed applications will also stay stopped until the VPN is started and checked."] : [])] };
    this.store.save("plan", id, { id, projectId, expiresAt, snapshots, fingerprint: identity(snapshots), desired, summary, ...(this.baseline(projectId) ? { baseline: this.baseline(projectId)! } : {}) } satisfies Plan);
    return summary;
  }
  pruneExpiredPlans(): number {
    for (const id of this.store.ids("review")) if (this.store.load<{ expiresAt: number }>("review", id).expiresAt < Date.now()) this.store.removeReview(id);
    const referenced = new Set(this.operations().map(operation => operation.planId));
    let removed = 0;
    for (const id of this.store.ids("plan")) {
      const plan = this.store.load<Plan>("plan", id);
      if (plan.expiresAt < Date.now() && !referenced.has(id)) { this.store.removePlan(id); removed++; }
    }
    return removed;
  }
  storageStatus(): { plans: number; expiredUnreferenced: number; bytes: number; retainedContainers: number; limit: number } {
    const referenced = new Set(this.operations().map(operation => operation.planId));
    return { plans: this.store.ids("plan").length, expiredUnreferenced: this.store.ids("plan").filter(id => this.store.load<Plan>("plan", id).expiresAt < Date.now() && !referenced.has(id)).length, bytes: this.store.bytes(), retainedContainers: managedRecoveryIds(this.operations()).size, limit: 1000 };
  }
  async settings(projectId: string) {
    const project = this.store.load<Project>("project", projectId);
    const snapshots = await this.snapshots(project);
    return { input: settingsFromEnvironment(containerEnvironment(snapshots[0]!), true), clearableKeys: [...providerKeys].filter(key => !["VPN_SERVICE_PROVIDER", "VPN_TYPE"].includes(key) && containerEnvironment(snapshots[0]!)[key] !== undefined), configurationSource: wireguardMountSource(snapshots[0]!), prerequisites: ["Approved project and bind roots", "All routed applications selected", "Volumes and image identities preserved", "Restart policy checked"], publishedPorts: snapshots[0]!.HostConfig.PortBindings ?? {} };
  }
  private async recoverySnapshots(operation: Operation): Promise<ManagedContainer[]> {
    if (!["interrupted", "rollback_failed"].includes(operation.status) || this.locks.has(operation.projectId) || !operation.snapshots.length) throw new ManagedError("This operation is not available for manual recovery completion.");
    const project = this.store.load<Project>("project", operation.projectId);
    const originals = await Promise.all(operation.snapshots.map(snapshot => this.docker.inspect(snapshot.Id)));
    for (const [index, original] of originals.entries()) {
      const expected = operation.snapshots[index]!;
      this.assertSafe(original, index === 0, project.vpnImageId);
      if (original.Config.Labels?.["com.docker.compose.project"] !== project.composeProject || configurationIdentity(original) !== configurationIdentity(expected) || Boolean(original.State.Running) !== Boolean(expected.State.Running)) throw new ManagedError("Restore the original container identities, names, configuration, data bindings and running state before completing recovery.");
      if (original.State.Running) await this.docker.waitHealthy(original.Id, index === 0 || Boolean(expected.State.Health));
    }
    for (const id of operation.createdIds) {
      try { await this.docker.inspect(id); } catch (error) { if (error instanceof ManagedError && error.code === "not_found") continue; throw error; }
      throw new ManagedError("Replacement containers still exist. Review and remove only those replacements manually before completing recovery; preserve volumes.");
    }
    await this.assertDependents(originals[0]!, originals.slice(1).map(container => container.Id));
    return originals;
  }
  private saveReview(kind: "recovery" | "cleanup", operationId: string, containers: ManagedContainer[]): string {
    this.pruneExpiredPlans();
    if (this.store.ids("review").length >= 1000) throw new ManagedError("Too many active review confirmations. Wait for them to expire.");
    const token = crypto.randomUUID();
    this.store.save("review", token, { kind, operationId, fingerprint: identity(containers), expiresAt: Date.now() + 5 * 60_000 });
    return token;
  }
  private checkReview(kind: string, operationId: string, token: string, containers: ManagedContainer[]): void {
    const review = this.store.load<{ kind: string; operationId: string; fingerprint: string; expiresAt: number }>("review", token);
    if (review.kind !== kind || review.operationId !== operationId || review.expiresAt < Date.now() || review.fingerprint !== identity(containers)) throw new ManagedError("Reviewed state changed or expired. Inspect it again.");
  }
  async exportConfiguration(projectId: string, source: string) {
    const project = this.store.load<Project>("project", projectId);
    const snapshots = await this.snapshots(project);
    const baseline = this.baseline(projectId);
    if (!baseline || baseline.containers.length !== snapshots.length || snapshots.some((container, index) => configurationIdentity(container) !== configurationIdentity(baseline.containers[index]!))) throw new ManagedError("Runtime drift or missing reference prevents export. Inspect the managed configuration first.");
    return exportManagedCompose(source, snapshots);
  }
  async reviewRecovery(operationId: string) {
    const operation = this.store.load<Operation>("operation", operationId);
    const originals = await this.recoverySnapshots(operation);
    return { operationId, projectId: operation.projectId, fingerprint: this.saveReview("recovery", operationId, originals), services: originals.map(container => ({ name: nameOf(container), running: Boolean(container.State.Running) })), effect: "Close the recovery lock for restored original containers only. No Docker writes or automatic replay." };
  }
  async completeRecovery(operationId: string, fingerprint: string, confirmed: boolean) {
    if (!confirmed) throw new ManagedError("Confirm the inspected manual recovery.");
    const operation = this.store.load<Operation>("operation", operationId);
    const originals = await this.recoverySnapshots(operation);
    this.checkReview("recovery", operationId, fingerprint, originals);
    this.locks.add(operation.projectId);
    try {
      const project = this.store.load<Project>("project", operation.projectId);
      const plan = this.store.load<Plan>("plan", operation.planId);
      this.store.save("project", project.id, { ...project, vpnId: originals[0]!.Id, clientIds: originals.slice(1).map(container => container.Id) });
      this.store.save("baseline", project.id, plan.baseline ?? null);
      operation.status = "rolled_back"; operation.manualRecoveryAt = new Date().toISOString(); operation.finishedAt = operation.manualRecoveryAt; operation.step = "Owner-confirmed original-container recovery inspected; no Docker mutation or replay.";
      this.store.save("operation", operation.id, operation);
    } finally { this.locks.delete(operation.projectId); }
    return { operationId, status: operation.status };
  }
  private async cleanupCandidates(operation: Operation, locked = false) {
    if (operation.status !== "succeeded" || !locked && this.locks.has(operation.projectId) || this.operations().some(other => other.id !== operation.id && other.projectId === operation.projectId && (["applying", "interrupted", "rollback_failed"].includes(other.status) || other.cleanupStatus === "applying" || other.cleanupStatus === "interrupted"))) throw new ManagedError("Recovery originals can only be cleaned after a completed change with no active recovery.");
    const project = this.store.load<Project>("project", operation.projectId);
    const current = await this.snapshots(project);
    const baseline = this.baseline(project.id);
    if (!baseline || current.some((container, index) => !baseline.containers[index] || configurationIdentity(container) !== configurationIdentity(baseline.containers[index]!))) throw new ManagedError("Inspect and resolve runtime drift before deleting recovery containers.");
    if (!current[0]!.State.Running) throw new ManagedError("Start and verify the current VPN before removing its recovery containers.");
    for (const [index, container] of current.entries()) if (container.State.Running) await this.docker.waitHealthy(container.Id, index === 0 || Boolean(container.State.Health));
    const active = new Set(this.projects().flatMap(p => [p.vpnId, ...p.clientIds]));
    const candidates: ManagedContainer[] = [];
    for (const snapshot of [...operation.snapshots.slice(1), operation.snapshots[0]!]) {
      if (!operation.renamedIds.includes(snapshot.Id) || operation.cleanedIds?.includes(snapshot.Id)) continue;
      let container: ManagedContainer;
      try { container = await this.docker.inspect(snapshot.Id); } catch (error) { if (error instanceof ManagedError && error.code === "not_found") continue; throw error; }
      if (active.has(container.Id) || container.State.Running || container.Name !== `/${nameOf(snapshot)}-tuniku-backup-${operation.id.slice(0, 8)}` || JSON.stringify(container.Config) !== JSON.stringify(snapshot.Config) || JSON.stringify(container.HostConfig) !== JSON.stringify(snapshot.HostConfig) || JSON.stringify(container.Mounts) !== JSON.stringify(snapshot.Mounts)) throw new ManagedError("A retained container changed or is active. Cleanup is blocked.");
      const dependencies = await this.docker.dependents(container);
      if (dependencies.some(id => !operation.renamedIds.includes(id))) throw new ManagedError("A retained container has external dependents. Cleanup is blocked.");
      candidates.push(container);
    }
    return candidates;
  }
  async reviewCleanup(operationId: string) {
    const operation = this.store.load<Operation>("operation", operationId);
    const containers = await this.cleanupCandidates(operation);
    return { operationId, fingerprint: this.saveReview("cleanup", operationId, containers), containers: containers.map(container => ({ id: container.Id, name: nameOf(container) })), effect: "Delete only these stopped recovery containers. Volumes, data bindings, plans and journals are preserved. Container rollback will no longer be available." };
  }
  async cleanup(operationId: string, fingerprint: string, confirmed: boolean) {
    if (!confirmed) throw new ManagedError("Confirm irreversible removal of these stopped recovery containers.");
    const operation = this.store.load<Operation>("operation", operationId);
    if (this.locks.has(operation.projectId)) throw new ManagedError("This project is already locked.");
    this.locks.add(operation.projectId);
    try {
      const containers = await this.cleanupCandidates(operation, true);
      this.checkReview("cleanup", operationId, fingerprint, containers);
      operation.cleanupStatus = "applying"; this.store.save("operation", operation.id, operation);
      for (const container of containers) {
        const current = await this.docker.inspect(container.Id);
        if (identity([current]) !== identity([container])) throw new ManagedError("Retained container changed during cleanup. Inspect recovery before retrying.");
        await this.docker.remove(container.Id);
        (operation.cleanedIds ??= []).push(container.Id); this.store.save("operation", operation.id, operation);
      }
      operation.cleanupStatus = "completed"; this.store.save("operation", operation.id, operation);
    } catch (error) { if (operation.cleanupStatus === "applying") { operation.cleanupStatus = "interrupted"; this.store.save("operation", operation.id, operation); } throw error; }
    finally { this.locks.delete(operation.projectId); }
    return { operationId, cleanedIds: operation.cleanedIds ?? [] };
  }
  operations(): Array<Omit<Operation, "snapshots">> {
    return this.store.ids("operation").map((id) => { const { snapshots: _snapshots, ...summary } = this.store.load<Operation>("operation", id); return summary; });
  }
  projects(): Project[] { return this.store.ids("project").map((id) => { const project = this.store.load<Project>("project", id); return { id: project.id, vpnId: project.vpnId, clientIds: project.clientIds, composeProject: project.composeProject, ...(project.vpnImageId ? { vpnImageId: project.vpnImageId } : {}) }; }); }
  async beginApply(planId: string, confirmed: boolean): Promise<Omit<Operation, "snapshots">> {
    const work = this.apply(planId, confirmed);
    const operation = this.operations().find((candidate) => candidate.planId === planId);
    if (!operation || operation.status !== "applying") return work;
    this.running.add(work);
    void work.finally(() => this.running.delete(work)).catch(() => {});
    return operation;
  }
  async close(): Promise<void> { await Promise.allSettled([...this.running]); }
  async apply(planId: string, confirmed: boolean): Promise<Omit<Operation, "snapshots">> {
    if (!confirmed) throw new ManagedError("Confirm the service interruption and application recreation.");
    const plan = this.store.load<Plan>("plan", planId);
    if (plan.expiresAt < Date.now()) throw new ManagedError("The change plan expired. Generate a new plan.");
    if (this.operations().some((operation) => operation.planId === planId)) throw new ManagedError("This plan already has an operation. Inspect its result before continuing.");
    if (this.locks.has(plan.projectId) || this.operations().some((operation) => operation.projectId === plan.projectId && (["applying", "interrupted", "rollback_failed"].includes(operation.status) || operation.cleanupStatus === "applying" || operation.cleanupStatus === "interrupted"))) throw new ManagedError("This project is locked by an active or incomplete operation.");
    this.locks.add(plan.projectId);
    const operation: Operation = { id: crypto.randomUUID(), projectId: plan.projectId, planId, status: "applying", step: "validating", createdIds: [], renamedIds: [], snapshots: plan.snapshots, startedAt: new Date().toISOString(), finishedAt: null, error: null };
    const record = (step: string) => { operation.step = step; this.store.save("operation", operation.id, operation); };
    let mutated = false;
    try {
      record("validating");
      const project = this.store.load<Project>("project", plan.projectId);
      if (identity(await this.snapshots(project)) !== plan.fingerprint) throw new ManagedError("The running configuration changed after planning. Generate a new plan.");
      if (plan.summary.portsChanged) await this.assertPorts(project.vpnId, plan.desired);
      record("prepared");
      if (!plan.summary.interruptionRequired) {
        this.store.save("baseline", project.id, { containers: plan.snapshots, observedAt: new Date().toISOString(), operationId: operation.id } satisfies Baseline);
        operation.status = "succeeded"; record("No changes were necessary.");
      }
      else {
        mutated = true;
        for (const container of [...plan.snapshots.slice(1), plan.snapshots[0]!]) {
          if (container.State.Running) { record(`stopping ${nameOf(container)}`); await this.docker.stop(container.Id); }
        }
        for (const container of plan.snapshots) {
          record(`renaming ${nameOf(container)}`);
          await this.docker.rename(container.Id, `${nameOf(container)}-tuniku-backup-${operation.id.slice(0, 8)}`);
          operation.renamedIds.push(container.Id); record("original retained for rollback");
        }
        record("creating VPN");
        const vpnId = await this.docker.create(nameOf(plan.snapshots[0]!), plan.desired);
        operation.createdIds.push(vpnId); record("starting VPN");
        if (plan.snapshots[0]!.State.Running) { await this.docker.start(vpnId); await this.docker.waitHealthy(vpnId, true); }
        const clientIds: string[] = [];
        for (const container of plan.snapshots.slice(1)) {
          const configuration = createConfiguration(container);
          configuration.HostConfig.NetworkMode = `container:${vpnId}`;
          delete configuration.NetworkingConfig;
          record(`creating ${nameOf(container)}`);
          const id = await this.docker.create(nameOf(container), configuration);
          operation.createdIds.push(id); clientIds.push(id); record("application created");
          if (container.State.Running && plan.snapshots[0]!.State.Running) { await this.docker.start(id); await this.docker.waitHealthy(id, Boolean(container.State.Health)); }
          if ((await this.docker.inspect(id)).HostConfig.NetworkMode !== `container:${vpnId}`) throw new ManagedError("The recreated application has an incorrect VPN namespace.");
        }
        const baseline: Baseline = { containers: await Promise.all([vpnId, ...clientIds].map(id => this.docker.inspect(id))), observedAt: new Date().toISOString(), operationId: operation.id };
        this.store.save("baseline", project.id, baseline);
        this.store.save("project", project.id, { ...project, vpnId, clientIds });
        operation.status = "succeeded"; record(plan.snapshots[0]!.State.Running ? "VPN healthy; applications recreated with the new namespace. Originals remain stopped for recovery." : "Configuration replaced; VPN and applications remain stopped. Originals retained for recovery.");
      }
    } catch {
      operation.error = "The change did not complete. Inspect the operation and recovery state; no secret-bearing Docker error is exposed.";
      if (mutated) {
        try {
          record("rolling back");
          for (const id of [...operation.createdIds].reverse()) { await this.docker.stop(id); await this.docker.remove(id); }
          for (const container of plan.snapshots) if (operation.renamedIds.includes(container.Id)) await this.docker.rename(container.Id, nameOf(container));
          const vpn = plan.snapshots[0]!;
          const saved = this.store.load<Project>("project", plan.projectId);
          this.store.save("baseline", plan.projectId, plan.baseline ?? null);
          this.store.save("project", plan.projectId, { ...saved, vpnId: vpn.Id, clientIds: plan.snapshots.slice(1).map((container) => container.Id) });
          if (vpn.State.Running) { await this.docker.start(vpn.Id); await this.docker.waitHealthy(vpn.Id, true); }
          for (const container of plan.snapshots.slice(1)) if (container.State.Running && vpn.State.Running) { await this.docker.start(container.Id); await this.docker.waitHealthy(container.Id, Boolean(container.State.Health)); }
          operation.status = "rolled_back"; record("Original containers and application associations restored.");
        } catch {
          // A later client's health check may fail after an earlier client started.
          await Promise.allSettled([...plan.snapshots.slice(1).map((container) => container.Id), ...operation.createdIds].map((id) => this.docker.stop(id)));
          operation.status = "rollback_failed"; record("Automatic rollback failed. Verify that clients are stopped and recover the retained original containers manually.");
        }
      } else {
        this.store.save("baseline", plan.projectId, plan.baseline ?? null);
        operation.status = "rolled_back"; record("Validation failed before container changes.");
      }
    } finally {
      operation.finishedAt = new Date().toISOString(); this.store.save("operation", operation.id, operation); this.locks.delete(plan.projectId);
    }
    const { snapshots: _snapshots, ...summary } = operation;
    return summary;
  }
}
