import { FieldValidationError } from "../validation.js";
import YAML, { parseDocument } from "yaml";
import net from "node:net";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { validateStorage } from "./storageValidation.js";
import { bindingsOverlap, composeBindings } from "./ports.js";
import { redactValue } from "../security.js";
import { getProviderProfile, type GluetunProviderProfile } from "./providers.js";
import type { ServerCatalog, ServerFilterKey } from "./serverCatalog.js";

export const composeTasks = [
  "new_gluetun_setup",
  "enable_control_server",
  "configure_control_auth",
  "configure_provider",
  "configure_wireguard",
  "configure_openvpn",
  "set_server_selection",
  "publish_app_port",
  "route_app_manually",
  "migrate_secrets",
  "review_existing_configuration"
] as const;

export type ComposeTask = typeof composeTasks[number];

export interface ComposeGenerationInput {
  taskType: ComposeTask;
  managedClearEnvironmentKeys?: string[];
  managedPortAction?: "add" | "replace" | "remove";
  managedOriginalBinding?: { address: string; port: string };
  gluetunServiceName?: string;
  gluetunContainerName?: string;
  composeProjectName?: string;
  externalNetworkName?: string;
  provider?: string;
  vpnType?: "wireguard" | "openvpn";
  anyLocation?: boolean;
  countries?: string;
  regions?: string;
  cities?: string;
  hostnames?: string;
  serverNames?: string;
  categories?: string;
  isps?: string;
  providerOptions?: Record<string, string>;
  authMode?: "none" | "api_key" | "basic";
  apiKey?: string;
  basicUsername?: string;
  basicPassword?: string;
  wireguardPrivateKey?: string;
  wireguardAddresses?: string;
  wireguardPresharedKey?: string;
  wireguardPublicKey?: string;
  wireguardEndpointIp?: string;
  wireguardEndpointPort?: number;
  openvpnUser?: string;
  openvpnPassword?: string;
  openvpnCertificate?: string;
  openvpnKey?: string;
  openvpnEncryptedKey?: string;
  openvpnKeyPassphrase?: string;
  customOpenvpnConfigPath?: string;
  routingScope?: "same_project" | "separate_project";
  appName?: string;
  appImage?: string;
  hostAddress?: string;
  hostPort?: number;
  containerPort?: number;
  protocol?: "tcp" | "udp";
  pastedCompose?: string;
  includeSecrets?: boolean;
  useEnvFile?: boolean;
}

export interface ComposeArtifact {
  filename: string;
  content: string;
  mediaType: string;
}

export interface ComposeValidationCheck {
  id: "yaml" | "provider" | "compose_structure" | "compose_cli" | "runtime" | "selected_ports";
  label: string;
  status: "passed" | "failed" | "not_run" | "not_applicable";
  detail: string;
}

export interface ComposeGenerationResult {
  detectedConfiguration: Record<string, unknown>;
  recommendedChange: string;
  snippets: {
    compose: string;
    env: string;
    secrets: string;
    steps: string;
  };
  manualSteps: string[];
  securityWarnings: string[];
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    checks: ComposeValidationCheck[];
  };
  artifacts: ComposeArtifact[];
  containsSecretValues: boolean;
  redacted: boolean;
}

const secretFields = [
  "apiKey",
  "basicPassword",
  "wireguardPrivateKey",
  "wireguardPresharedKey",
  "openvpnUser",
  "openvpnPassword",
  "openvpnCertificate",
  "openvpnKey",
  "openvpnEncryptedKey",
  "openvpnKeyPassphrase"
] as const;

const providerTasks = new Set<ComposeTask>(["new_gluetun_setup", "configure_provider", "configure_wireguard", "configure_openvpn", "set_server_selection"]);
const completeProviderTasks = new Set<ComposeTask>(["new_gluetun_setup", "configure_provider", "configure_wireguard", "configure_openvpn"]);
const filterInputs: Record<ServerFilterKey, keyof ComposeGenerationInput> = {
  countries: "countries",
  regions: "regions",
  cities: "cities",
  hostnames: "hostnames",
  names: "serverNames",
  categories: "categories",
  isps: "isps"
};

function assertPort(value: number | undefined, label: string, path: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65_535)) {
    throw new FieldValidationError(path, `${label} must be a number between 1 and 65535.`);
  }
}

function requireValue(value: string | undefined, label: string, path: string): void {
  if (!value?.trim()) throw new FieldValidationError(path, `${label} is required for this provider and protocol.`);
}

function assertWireguardKey(value: string | undefined, label: string, path: string): void {
  if (!value) return;
  const decoded = Buffer.from(value, "base64");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || decoded.length !== 32 || decoded.toString("base64") !== value || decoded.every((byte) => byte === 0)) {
    throw new FieldValidationError(path, `${label} must be a nonzero, canonical base64-encoded 32-byte key.`);
  }
}

function assertAddresses(value: string | undefined): void {
  if (!value) return;
  for (const cidr of value.split(",")) {
    const parts = cidr.trim().split("/");
    const family = net.isIP(parts[0] ?? "");
    if (parts.length !== 2 || !family || !/^\d+$/.test(parts[1] ?? "") || Number(parts[1]) > (family === 4 ? 32 : 128)) {
      throw new FieldValidationError("wireguardAddresses", "WireGuard addresses must be comma-separated IPv4 or IPv6 CIDRs with valid prefixes.");
    }
  }
}

function certificateBytes(value: string, label: string): Buffer {
  const trimmed = value.trim();
  const wrapped = trimmed.match(/^-----BEGIN ([A-Z ]+)-----\s*([A-Za-z0-9+/=\s]+)\s*-----END \1-----$/);
  if (trimmed.includes("-----") && !wrapped) throw new Error(`${label} must contain one complete PEM block or its base64 body.`);
  const body = (wrapped?.[2] ?? trimmed).replace(/\s/g, "");
  const bytes = Buffer.from(body, "base64");
  if (!body || bytes.toString("base64") !== body) throw new Error(`${label} must contain valid canonical base64 data.`);
  return bytes;
}

function validateOpenvpnCertificate(input: ComposeGenerationInput): void {
  if (!input.openvpnCertificate) return;
  let certificate: X509Certificate;
  try { certificate = new X509Certificate(certificateBytes(input.openvpnCertificate, "OpenVPN client certificate")); }
  catch { throw new FieldValidationError("openvpnCertificate", "OpenVPN client certificate is not a valid X.509 certificate. Paste the complete PEM certificate or its base64 body."); }
  if (!input.openvpnKey) return;
  let key;
  try {
    const bytes = certificateBytes(input.openvpnKey, "OpenVPN client key");
    for (const type of ["pkcs8", "pkcs1", "sec1"] as const) {
      try { key = createPrivateKey({ key: bytes, format: "der", type }); break; } catch { /* Try the next supported private-key container. */ }
    }
    if (!key) throw new Error("invalid");
  } catch { throw new FieldValidationError("openvpnKey", "OpenVPN client key is not a supported unencrypted private key. Paste its complete PEM block or base64 body."); }
  if (!certificate.checkPrivateKey(key)) throw new FieldValidationError("openvpnKey", "The OpenVPN client certificate and private key do not match.");
}

type GenerationCatalog = Pick<ServerCatalog, "validate"> & Partial<Pick<ServerCatalog, "validateSelection">>;
function validateProviderInput(input: ComposeGenerationInput, serverCatalog?: GenerationCatalog): GluetunProviderProfile | undefined {
  if (!providerTasks.has(input.taskType)) return undefined;
  const profile = getProviderProfile(input.provider);
  if (!profile) throw new FieldValidationError("provider", "Choose a supported Gluetun provider from the list.");
  if (!input.vpnType || !profile.protocols.includes(input.vpnType)) {
    throw new FieldValidationError("vpnType", `${profile.label} does not support the selected VPN protocol in the current Gluetun latest image.`);
  }
  if (input.anyLocation) {
    if (profile.customConfiguration) throw new FieldValidationError("anyLocation", "A custom VPN endpoint has no provider location selection.");
    if ([input.countries, input.regions, input.cities, input.hostnames, input.serverNames].some(value => value?.trim())) throw new FieldValidationError("anyLocation", "Any location cannot be combined with specific location filters.");
  }
  for (const [filter, inputKey] of Object.entries(filterInputs) as Array<[ServerFilterKey, keyof ComposeGenerationInput]>) {
    const value = input[inputKey];
    if (typeof value !== "string" || !value.trim()) continue;
    if (!profile.serverFilters.includes(filter)) {
      throw new FieldValidationError(String(inputKey), `${profile.label} does not support the ${filter} server filter.`);
    }
    const catalogErrors = serverCatalog?.validate(profile.id, input.vpnType, filter, value) ?? [];
    if (catalogErrors.length > 0) throw new FieldValidationError(String(inputKey), catalogErrors[0]!);
  }
  const selection = Object.fromEntries(Object.entries(filterInputs).map(([filter, inputKey]) => [filter, input[inputKey] ?? ""]));
  const selectionErrors = serverCatalog?.validateSelection?.(profile.id, input.vpnType, selection) ?? [];
  if (selectionErrors.length) throw new FieldValidationError(String(Object.values(filterInputs).find((key) => typeof input[key] === "string" && String(input[key]).trim()) ?? "provider"), selectionErrors[0]!);
  for (const [environmentName, value] of Object.entries(input.providerOptions ?? {})) {
    if (!value) continue;
    const option = profile.options.find((candidate) => candidate.env === environmentName && (!candidate.protocols || candidate.protocols.includes(input.vpnType!)));
    if (!option) throw new FieldValidationError(`providerOptions.${environmentName}`, `${environmentName} is not supported for ${profile.label} with ${input.vpnType}.`);
    if (option.kind === "select" && !option.choices?.includes(value)) throw new FieldValidationError(`providerOptions.${environmentName}`, `${environmentName} has an unsupported value.`);
    if (option.kind === "number") assertPort(Number(value), option.label, `providerOptions.${environmentName}`);
    if (option.kind === "boolean" && value !== option.enabledValue) throw new FieldValidationError(`providerOptions.${environmentName}`, `${environmentName} has an unsupported enabled value.`);
  }
  if (!completeProviderTasks.has(input.taskType)) return profile;
  if (input.vpnType === "wireguard") {
    requireValue(input.wireguardPrivateKey, "WireGuard private key", "wireguardPrivateKey");
    if (!profile.wireguardAddresses && input.wireguardAddresses?.trim()) throw new FieldValidationError("wireguardAddresses", `${profile.label} does not use WIREGUARD_ADDRESSES in its official walkthrough.`);
    if (!profile.wireguardPresharedKey && !profile.customConfiguration && input.wireguardPresharedKey?.trim()) throw new FieldValidationError("wireguardPresharedKey", `${profile.label} does not use WIREGUARD_PRESHARED_KEY in its official walkthrough.`);
    if (profile.wireguardAddresses) requireValue(input.wireguardAddresses, "WireGuard address", "wireguardAddresses");
    if (profile.wireguardPresharedKey) requireValue(input.wireguardPresharedKey, "WireGuard preshared key", "wireguardPresharedKey");
    if (profile.customConfiguration) {
      requireValue(input.wireguardPublicKey, "WireGuard server public key", "wireguardPublicKey");
      requireValue(input.wireguardEndpointIp, "WireGuard endpoint IP", "wireguardEndpointIp");
      assertPort(input.wireguardEndpointPort, "WireGuard endpoint port", "wireguardEndpointPort");
      if (!input.wireguardEndpointPort) throw new FieldValidationError("wireguardEndpointPort", "WireGuard endpoint port is required for a custom provider.");
    }
  } else if (profile.customConfiguration) {
    requireValue(input.customOpenvpnConfigPath, "Host path to the custom OpenVPN configuration", "customOpenvpnConfigPath");
    const sourcePath = input.customOpenvpnConfigPath?.trim() ?? "";
    if (!sourcePath.startsWith("/") || sourcePath.includes(":") || /[\r\n\0]/.test(sourcePath)) {
      throw new FieldValidationError("customOpenvpnConfigPath", "The custom OpenVPN configuration must use a safe absolute Linux host path.");
    }
  } else {
    if (profile.openvpnCredentials === "required" || profile.id === "ivpn") requireValue(input.openvpnUser, "OpenVPN username", "openvpnUser");
    if (profile.openvpnCredentials === "required") requireValue(input.openvpnPassword, "OpenVPN password", "openvpnPassword");
    if (profile.id === "ivpn" && !/^(?:i|ivpn)-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(input.openvpnUser ?? "")) requireValue(input.openvpnPassword, "OpenVPN password when not using an IVPN account ID", "openvpnPassword");
    if (profile.openvpnCertificate === "client_key") {
      requireValue(input.openvpnCertificate, "OpenVPN client certificate", "openvpnCertificate");
      requireValue(input.openvpnKey, "OpenVPN client key", "openvpnKey");
    }
    if (profile.openvpnCertificate === "encrypted_key") {
      requireValue(input.openvpnCertificate, "OpenVPN client certificate", "openvpnCertificate");
      requireValue(input.openvpnEncryptedKey, "OpenVPN encrypted client key", "openvpnEncryptedKey");
      requireValue(input.openvpnKeyPassphrase, "OpenVPN key passphrase", "openvpnKeyPassphrase");
    }
  }
  if (input.vpnType === "wireguard") {
    assertWireguardKey(input.wireguardPrivateKey, "WireGuard private key", "wireguardPrivateKey");
    assertWireguardKey(input.wireguardPresharedKey, "WireGuard preshared key", "wireguardPresharedKey");
    assertWireguardKey(input.wireguardPublicKey, "WireGuard server public key", "wireguardPublicKey");
    assertAddresses(input.wireguardAddresses);
    if (input.wireguardEndpointIp && !net.isIP(input.wireguardEndpointIp)) throw new FieldValidationError("wireguardEndpointIp", "WireGuard endpoint must be an IPv4 or IPv6 address.");
  }
  if (input.vpnType === "openvpn" && profile.openvpnCertificate !== "none") validateOpenvpnCertificate(input);
  return profile;
}

function pemBody(value: string): string {
  return value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, "");
}

function validateControlAuth(input: ComposeGenerationInput): void {
  if (!["new_gluetun_setup", "enable_control_server", "configure_control_auth"].includes(input.taskType)) return;
  if (!input.authMode) throw new FieldValidationError("authMode", "Choose a Control Server authentication mode.");
  if (input.authMode === "api_key") requireValue(input.apiKey, "Control Server API key", "apiKey");
  if (input.authMode === "basic") {
    requireValue(input.basicUsername, "Control Server Basic Auth username", "basicUsername");
    requireValue(input.basicPassword, "Control Server Basic Auth password", "basicPassword");
  }
}

function safeServiceName(value: string | undefined): string {
  const name = (value || "app").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) return "app";
  if (name === "gluetun" || name === "tuniku") throw new FieldValidationError("appName", "Choose an application name other than gluetun or tuniku.");
  return deploymentName(name.slice(0, 63), "app", "appName");
}

function deploymentName(value: string | undefined, fallback: string, field: string, project = false): string {
  const name = value?.trim() || fallback;
  const service = ["gluetunServiceName", "appName"].includes(field);
  const pattern = project ? /^[a-z0-9][a-z0-9_-]*$/ : service ? /^[A-Za-z0-9_.-]+$/ : /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
  if (name.length > 128 || !pattern.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new FieldValidationError(field, project ? "Use a lowercase project name with letters, numbers, hyphens or underscores." : "Use letters, numbers, dots, hyphens or underscores; container and network names must begin with a letter or number.");
  return name;
}

function vpnServiceNames(services: Record<string, any>): string[] {
  return Object.entries(services).filter(([name, service]) => name === "gluetun" || typeof service?.image === "string" && /^(?:docker\.io\/)?qmcgaw\/gluetun(?::|@|$)/.test(service.image)).map(([name]) => name);
}

function targetService(input: ComposeGenerationInput, inspected: ReturnType<typeof inspectCompose> | null): string {
  if (["review_existing_configuration", "migrate_secrets"].includes(input.taskType)) return "gluetun";
  if (input.taskType === "new_gluetun_setup" || !inspected?.valid) return deploymentName(input.gluetunServiceName, "gluetun", "gluetunServiceName");
  const services = inspected.detected.services as string[];
  const candidates = inspected.detected.gluetunServices as string[];
  if (input.gluetunServiceName?.trim()) {
    const selected = deploymentName(input.gluetunServiceName, "gluetun", "gluetunServiceName");
    if (!services.includes(selected)) throw new FieldValidationError("gluetunServiceName", "The selected VPN service does not exist in the pasted stack. Use its exact Compose service name.");
    if (!candidates.includes(selected)) throw new FieldValidationError("gluetunServiceName", "The selected service is not identified as Gluetun. Review its image before generating changes.");
    return selected;
  }
  if (!candidates.length) return "gluetun";
  if (candidates.length !== 1) throw new FieldValidationError("gluetunServiceName", "Several Gluetun services exist. Enter the exact VPN service name to change.");
  return deploymentName(candidates[0], "gluetun", "gluetunServiceName");
}

function envLine(key: string, value: string | undefined, includeSecrets: boolean, secret: boolean): string | null {
  if (value === undefined) return null;
  const output = secret && !includeSecrets ? "[REDACTED]" : value;
  return `${key}=${/[\s$#'"\\]/.test(output) ? JSON.stringify(output.replaceAll("$", "$$$$")) : output}`;
}

function validateDocument(input: string, fragment = false): { valid: boolean; yamlValid: boolean; errors: string[]; warnings: string[]; parsed: unknown } {
  if (Buffer.byteLength(input, "utf8") > 1_048_576) {
    return { valid: false, yamlValid: false, errors: ["Compose input exceeds the 1 MiB limit."], warnings: [], parsed: null };
  }
  const document = parseDocument(input, { strict: true, uniqueKeys: true });
  // Parser messages may contain the original secret-bearing source line.
  const errors = document.errors.map((error) => `Invalid YAML (${error.code}).`);
  const warnings = document.warnings.map((warning) => `YAML warning (${warning.code}).`);
  let parsed: unknown = null;
  let yamlValid = errors.length === 0;
  if (errors.length === 0) {
    try { parsed = document.toJS({ maxAliasCount: 100 }); }
    catch { yamlValid = false; errors.push("Compose aliases could not be resolved within the safe limit."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) errors.push("Compose content must be a YAML object.");
    else {
      const services = (parsed as any).services;
      if (!services || typeof services !== "object" || Array.isArray(services) || Object.keys(services).length === 0) errors.push("Compose must contain a non-empty services mapping.");
      else for (const [name, service] of Object.entries(services)) {
        if (!service || typeof service !== "object" || Array.isArray(service)) errors.push(`Service ${name} must be a mapping.`);
        else {
          if ((service as any).network_mode && (service as any).networks) errors.push(`Service ${name} cannot specify both network_mode and networks.`);
          const ports = (service as any).ports;
          if (ports !== undefined && (!Array.isArray(ports) || ports.some((port: unknown) => !validPortMapping(port)))) errors.push(`Service ${name} contains an invalid port mapping.`);
          const namespace = (service as any).network_mode;
          if (typeof namespace === "string" && namespace.startsWith("service:") && !Object.hasOwn(services, namespace.slice(8))) errors.push(`Service ${name} references a missing network service.`);
          validateServiceStructure(name, service as Record<string, unknown>, services, parsed as Record<string, unknown>, fragment, errors, warnings);
        }
      }
    }
  }
  return { valid: errors.length === 0, yamlValid, errors, warnings, parsed };
}

function isMapping(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

function validateServiceStructure(name: string, service: Record<string, unknown>, services: Record<string, unknown>, document: Record<string, unknown>, fragment: boolean, errors: string[], warnings: string[]): void {
  const environment = service.environment;
  if (environment !== undefined) {
    if (Array.isArray(environment)) {
      if (environment.some(value => typeof value !== "string")) errors.push(`Service ${name} environment list must contain strings.`);
      else {
        const keys = environment.map(value => value.split("=", 1)[0]);
        if (new Set(keys).size !== keys.length) errors.push(`Service ${name} has duplicate environment settings; keep one value per setting.`);
        if (environment.some(value => !value.includes("=") || /\$(?:\{|[A-Za-z_])/.test(value))) warnings.push(`Service ${name} environment needs deployment-time values; they have not been resolved.`);
      }
    } else if (!isMapping(environment) || Object.values(environment).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value))) errors.push(`Service ${name} environment must be a scalar mapping or a string list.`);
    else {
      if (Object.values(environment).some(value => typeof value === "boolean")) warnings.push(`Service ${name} uses YAML booleans in environment; quote these values as strings for portable Compose behavior.`);
      if (Object.values(environment).some(value => value === null || typeof value === "string" && /\$(?:\{|[A-Za-z_])/.test(value))) warnings.push(`Service ${name} environment needs deployment-time values; they have not been resolved.`);
    }
  }
  validateStorage(name, service, errors, warnings);
  const envFile = service.env_file;
  if (envFile !== undefined) {
    const entries = Array.isArray(envFile) ? envFile : [envFile];
    if (!entries.length || entries.some(value => typeof value === "string" ? !value.trim() : !isMapping(value) || typeof value.path !== "string" || !value.path.trim() || value.required !== undefined && typeof value.required !== "boolean" || value.format !== undefined && value.format !== "raw")) errors.push(`Service ${name} env_file must contain file paths or supported path mappings.`);
    warnings.push(`Service ${name} env_file contents and relative host paths have not been read or checked. Resolve them in the deployment directory.`);
    if (environment !== undefined) warnings.push(`Service ${name} combines environment and env_file. Environment takes precedence, including empty values; keep a single authoritative source for each setting and inspect the resolved configuration locally.`);
  }
  const dependencies = service.depends_on;
  if (dependencies !== undefined) {
    const references = Array.isArray(dependencies) ? dependencies : isMapping(dependencies) ? Object.keys(dependencies) : null;
    if (!references || references.some(value => typeof value !== "string")) errors.push(`Service ${name} depends_on must be a service list or mapping.`);
    else for (const reference of references) {
      if (reference === name) errors.push(`Service ${name} cannot depend on itself.`);
      else if (!Object.hasOwn(services, reference)) (fragment || isMapping(dependencies) && isMapping(dependencies[reference]) && dependencies[reference].required === false ? warnings : errors).push(`Service ${name} references a dependency absent from this ${fragment ? "fragment; check the complete merged stack" : "Compose file"}.`);
    }
    if (isMapping(dependencies) && Object.values(dependencies).some(value => !isMapping(value) || !["service_started", "service_healthy", "service_completed_successfully"].includes(String(value.condition)) || value.restart !== undefined && typeof value.restart !== "boolean" || value.required !== undefined && typeof value.required !== "boolean")) errors.push(`Service ${name} has an invalid depends_on condition or option.`);
  }
  const networks = service.networks;
  if (networks !== undefined) {
    const references = Array.isArray(networks) ? networks : isMapping(networks) ? Object.keys(networks) : null;
    if (!references || references.some(value => typeof value !== "string")) errors.push(`Service ${name} networks must be a name list or mapping.`);
    else for (const reference of references) {
      if (reference !== "default" && (!isMapping(document.networks) || !Object.hasOwn(document.networks, reference))) (fragment ? warnings : errors).push(`Service ${name} references a network absent from this ${fragment ? "fragment; check the complete merged stack" : "Compose file"}.`);
    }
  }
  if (service.volumes !== undefined) {
    if (!Array.isArray(service.volumes)) errors.push(`Service ${name} volumes must be a list.`);
    else for (const volume of service.volumes) {
      const source = typeof volume === "string" && volume.includes(":") ? volume.split(":", 1)[0] : isMapping(volume) && volume.type === "volume" ? volume.source : undefined;
      if (typeof volume !== "string" && (!isMapping(volume) || !["bind", "volume", "tmpfs", "image", "npipe", "cluster"].includes(String(volume.type)) || typeof volume.target !== "string")) errors.push(`Service ${name} has an invalid volume mapping.`);
      if (typeof source === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source) && (!isMapping(document.volumes) || !Object.hasOwn(document.volumes, source))) (fragment ? warnings : errors).push(`Service ${name} references a named volume absent from this ${fragment ? "fragment; check the complete merged stack" : "Compose file"}.`);
    }
  }
  for (const key of ["networks", "volumes"]) if (document[key] !== undefined && !isMapping(document[key])) errors.push(`Top-level ${key} must be a mapping.`);
}

function portRange(value: unknown, allowZero = false): [number, number] | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value).match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const last = Number(match[2] ?? match[1]);
  return first >= (allowZero ? 0 : 1) && last >= first && last <= 65535 ? [first, last] : null;
}

function validPortMapping(value: unknown): boolean {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const port = value as Record<string, unknown>;
    const target = portRange(port.target);
    return Boolean(target && target[0] === target[1] && (port.published === undefined || portRange(port.published, true)) &&
      (port.protocol === undefined || ["tcp", "udp"].includes(String(port.protocol))) &&
      (port.host_ip === undefined || (typeof port.host_ip === "string" && net.isIP(port.host_ip))));
  }
  if (typeof value !== "string" && typeof value !== "number") return false;
  const text = String(value);
  // Interpolated bindings need Docker Compose with the operator's environment.
  if (/\$(?:\$|\{[^}]+\}|[A-Za-z_][A-Za-z0-9_]*)/.test(text)) return true;
  const match = text.match(/^(?:(\[[^\]]+\]|[^:]+):)?(?:(\d+(?:-\d+)?):)?(\d+(?:-\d+)?)(?:\/(tcp|udp))?$/);
  if (!match) return false;
  let host = match[1];
  let published = match[2];
  if (host && !published && /^\d+(?:-\d+)?$/.test(host)) { published = host; host = undefined; }
  if (host && !net.isIP(host.replace(/^\[|\]$/g, ""))) return false;
  const target = portRange(match[3]);
  const binding = published === undefined ? null : portRange(published, true);
  return Boolean(target && (published === undefined || (binding && binding[1] - binding[0] === target[1] - target[0])));
}

export function validateCompose(input: string): Omit<ReturnType<typeof validateDocument>, "parsed"> {
  const { parsed: _parsed, ...result } = validateDocument(input);
  return result;
}

function collectPorts(value: unknown): number[] {
  if (!value || typeof value !== "object") return [];
  const services = (value as any).services;
  if (!services || typeof services !== "object") return [];
  const ports: number[] = [];
  for (const service of Object.values(services) as any[]) {
    if (!Array.isArray(service?.ports)) continue;
    for (const entry of service.ports) {
      if (entry && typeof entry === "object" && /^\d+$/.test(String(entry.published))) {
        ports.push(Number(entry.published));
        continue;
      }
      const text = typeof entry === "string" || typeof entry === "number" ? String(entry) : "";
      const withoutProtocol = text.split("/")[0] ?? "";
      const segments = withoutProtocol.split(":");
      const host = segments.length >= 2 ? segments.at(-2) : null;
      if (host && /^\d+$/.test(host)) ports.push(Number(host));
    }
  }
  return ports;
}

export function inspectCompose(input: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  detected: Record<string, unknown>;
  redacted: string;
} {
  const validation = validateDocument(input);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors, warnings: validation.warnings, detected: {}, redacted: "# Invalid Compose input omitted to protect credentials.\n" };
  }
  const parsed = validation.parsed as any;
  const services = parsed.services && typeof parsed.services === "object" ? Object.keys(parsed.services) : [];
  const gluetunServices = vpnServiceNames(parsed.services ?? {});
  const gluetun = gluetunServices.length === 1 ? parsed.services[gluetunServices[0]!] : undefined;
  const environment = Array.isArray(gluetun?.environment)
    ? redactValue(gluetun.environment)
    : gluetun?.environment && typeof gluetun.environment === "object"
      ? redactValue(gluetun.environment)
      : {};
  return {
    valid: true,
    errors: [],
    warnings: validation.warnings,
    detected: {
      services,
      gluetunServices,
      hasGluetunService: gluetunServices.length > 0,
      gluetunEnvironment: environment,
      publishedHostPorts: collectPorts(parsed)
    },
    redacted: YAML.stringify(redactValue(parsed))
  };
}

export function detectPortCollisions(existingPorts: number[], plannedPorts: number[]): number[] {
  const seen = new Set(existingPorts);
  return [...new Set(plannedPorts.filter((port) => seen.has(port)))].sort((left, right) => left - right);
}

function outputValue(value: string, input: ComposeGenerationInput, secret = false): string {
  return secret && input.includeSecrets !== true ? "[REDACTED]" : value;
}

function providerEnvironment(input: ComposeGenerationInput, profile?: GluetunProviderProfile): Record<string, string> {
  const environment: Record<string, string> = {};
  if (input.provider) environment.VPN_SERVICE_PROVIDER = input.provider;
  if (input.vpnType) environment.VPN_TYPE = input.vpnType;
  if (input.countries) environment.SERVER_COUNTRIES = input.countries;
  if (input.regions) environment.SERVER_REGIONS = input.regions;
  if (input.cities) environment.SERVER_CITIES = input.cities;
  if (input.hostnames) environment.SERVER_HOSTNAMES = input.hostnames;
  if (input.serverNames) environment.SERVER_NAMES = input.serverNames;
  if (input.anyLocation && profile) {
    const locationVariables: Record<string, string> = { countries: "SERVER_COUNTRIES", regions: "SERVER_REGIONS", cities: "SERVER_CITIES", names: "SERVER_NAMES", hostnames: "SERVER_HOSTNAMES" };
    for (const filter of profile.serverFilters) if (locationVariables[filter]) environment[locationVariables[filter]!] = "";
  }
  if (input.categories) environment.SERVER_CATEGORIES = input.categories;
  if (input.isps) environment.ISP = input.isps;
  for (const [key, value] of Object.entries(input.providerOptions ?? {})) {
    if (value) environment[key] = value;
  }
  if (input.vpnType === "wireguard") {
    if (input.wireguardPrivateKey) environment.WIREGUARD_PRIVATE_KEY = outputValue(input.wireguardPrivateKey, input, true);
    if (input.wireguardAddresses) environment.WIREGUARD_ADDRESSES = input.wireguardAddresses;
    if (input.wireguardPresharedKey) environment.WIREGUARD_PRESHARED_KEY = outputValue(input.wireguardPresharedKey, input, true);
    if (profile?.customConfiguration && input.wireguardPublicKey) environment.WIREGUARD_PUBLIC_KEY = input.wireguardPublicKey;
    if (profile?.customConfiguration && input.wireguardEndpointIp) environment.WIREGUARD_ENDPOINT_IP = input.wireguardEndpointIp;
    if (profile?.customConfiguration && input.wireguardEndpointPort) environment.WIREGUARD_ENDPOINT_PORT = String(input.wireguardEndpointPort);
  }
  if (input.vpnType === "openvpn") {
    if (input.openvpnUser) environment.OPENVPN_USER = outputValue(input.openvpnUser, input, true);
    const openvpnPassword = input.openvpnPassword;
    if (openvpnPassword) environment.OPENVPN_PASSWORD = outputValue(openvpnPassword, input, true);
    if (input.openvpnCertificate) environment.OPENVPN_CERT = outputValue(pemBody(input.openvpnCertificate), input, true);
    if (input.openvpnKey) environment.OPENVPN_KEY = outputValue(pemBody(input.openvpnKey), input, true);
    if (input.openvpnEncryptedKey) environment.OPENVPN_ENCRYPTED_KEY = outputValue(pemBody(input.openvpnEncryptedKey), input, true);
    if (input.openvpnKeyPassphrase) environment.OPENVPN_KEY_PASSPHRASE = outputValue(input.openvpnKeyPassphrase, input, true);
    if (profile?.customConfiguration && input.customOpenvpnConfigPath) environment.OPENVPN_CUSTOM_CONFIG = "/gluetun/custom.conf";
  }
  if (input.authMode === "none") environment.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE = '{"auth":"none"}';
  if (input.authMode === "api_key" && input.apiKey) environment.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE = outputValue(JSON.stringify({ auth: "apikey", apikey: input.apiKey }), input, true);
  if (input.authMode === "basic" && input.basicUsername && input.basicPassword) environment.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE = outputValue(JSON.stringify({ auth: "basic", username: input.basicUsername, password: input.basicPassword }), input, true);
  return environment;
}

function buildCompose(input: ComposeGenerationInput, profile?: GluetunProviderProfile, existingServices: string[] = []): Record<string, unknown> {
  const vpnName = input.gluetunServiceName || "gluetun";
  if (input.taskType === "new_gluetun_setup") {
    const protectedNames = ["tuniku", "tuniku-docker-observer", "tuniku-manager"];
    if (protectedNames.includes(vpnName.toLowerCase())) throw new FieldValidationError("gluetunServiceName", "Choose a VPN service name different from Tuniku and its helper services.");
    if (protectedNames.includes(deploymentName(input.gluetunContainerName, "gluetun", "gluetunContainerName").toLowerCase())) throw new FieldValidationError("gluetunContainerName", "Choose a VPN container name different from Tuniku and its helper containers.");
    if (input.composeProjectName?.trim() === "tuniku") throw new FieldValidationError("composeProjectName", "Use a separate project name to keep the existing Tuniku stack independent.");
    if (input.externalNetworkName?.trim().toLowerCase() === "tuniku-observer") throw new FieldValidationError("externalNetworkName", "Use the network shared with Tuniku, not the private Docker observer network.");
  }
  const gluetunVolumes = ["gluetun_data:/gluetun"];
  if (input.vpnType === "openvpn" && profile?.customConfiguration && input.customOpenvpnConfigPath) {
    gluetunVolumes.push(`${input.customOpenvpnConfigPath.trim()}:/gluetun/custom.conf:ro`);
  }
  const gluetun: Record<string, unknown> = {
    image: "qmcgaw/gluetun:latest",
    pull_policy: "always",
    container_name: deploymentName(input.gluetunContainerName, "gluetun", "gluetunContainerName"),
    cap_add: ["NET_ADMIN"],
    devices: ["/dev/net/tun:/dev/net/tun"],
    environment: providerEnvironment(input, profile),
    labels: { "com.ishiku.tuniku.role": "gluetun" },
    volumes: gluetunVolumes,
    networks: ["tuniku"],
    init: true,
    logging: { driver: "json-file", options: { "max-size": "10m", "max-file": "3" } },
    restart: "unless-stopped"
  };
  const services: Record<string, unknown> = { [vpnName]: gluetun };
  if (input.taskType !== "new_gluetun_setup") {
    // Existing-stack tasks must not replace volumes, networks or runtime settings.
    services[vpnName] = { environment: providerEnvironment(input, profile) };
    if (profile?.customConfiguration && input.vpnType === "openvpn" && input.customOpenvpnConfigPath) {
      (services[vpnName] as Record<string, unknown>).volumes = [gluetunVolumes[1]];
    }
  }
  if (input.hostPort && input.containerPort) {
    const bind = input.hostAddress?.trim().replace(/^\[|\]$/g, "") || "";
    (services[vpnName] as Record<string, unknown>).ports = [
      `${bind ? `${net.isIP(bind) === 6 ? `[${bind}]` : bind}:` : ""}${input.hostPort}:${input.containerPort}/${input.protocol || "tcp"}`
    ];
  }
  if (input.taskType === "route_app_manually") {
    const serviceName = input.appName?.trim() && existingServices.includes(input.appName.trim()) ? deploymentName(input.appName, "app", "appName") : safeServiceName(input.appName);
    if (serviceName === vpnName) throw new FieldValidationError("appName", "Application and VPN service names must be different.");
    services[serviceName] = {
      image: input.appImage || "example/app:version",
      network_mode: input.routingScope === "separate_project" ? `container:${deploymentName(input.gluetunContainerName, "", "gluetunContainerName")}` : `service:${vpnName}`,
      ...(input.routingScope === "separate_project" ? {} : { depends_on: [vpnName] })
    };
  }
  if (input.taskType !== "new_gluetun_setup") return { services };
  const document: Record<string, unknown> = {
    name: deploymentName(input.composeProjectName, "tuniku-gluetun", "composeProjectName", true),
    services,
    networks: {
      tuniku: {
        external: true,
        name: deploymentName(input.externalNetworkName, "tuniku", "externalNetworkName")
      }
    },
    volumes: { gluetun_data: {} }
  };
  return document;
}

function buildEnv(input: ComposeGenerationInput, profile?: GluetunProviderProfile): string {
  return `${Object.entries(providerEnvironment(input, profile)).map(([key, value]) => envLine(key, value, true, false)).filter(Boolean).join("\n")}\n`;
}

export function generateCompose(input: ComposeGenerationInput, serverCatalog?: GenerationCatalog): ComposeGenerationResult {
  if (!composeTasks.includes(input.taskType)) throw new Error("Unsupported Compose Assistant task.");
  input = scopedInput(input);
  assertPort(input.hostPort, "Host port", "hostPort");
  assertPort(input.containerPort, "Container port", "containerPort");
  if ((input.hostPort === undefined) !== (input.containerPort === undefined)) {
    throw new FieldValidationError("hostPort", "Host port and container port must be supplied together.");
  }
  if (input.hostAddress?.trim() && !net.isIP(input.hostAddress.trim().replace(/^\[|\]$/g, ""))) throw new FieldValidationError("hostAddress", "Host address must be an IPv4 or IPv6 address.");
  if (["publish_app_port", "route_app_manually"].includes(input.taskType) && (!input.hostPort || !input.containerPort)) throw new FieldValidationError("hostPort", "Host port and container port are required.");
  if (input.taskType === "route_app_manually" && input.routingScope === "separate_project" && !input.gluetunContainerName?.trim()) throw new FieldValidationError("gluetunContainerName", "Enter the exact existing VPN container name for a separate project.");
  const profile = validateProviderInput(input, serverCatalog);
  validateControlAuth(input);
  const inspected = input.pastedCompose ? inspectCompose(input.pastedCompose) : null;
  input = { ...input, gluetunServiceName: targetService(input, inspected) };
  const composeDocument = buildCompose(input, profile, inspected?.valid ? inspected.detected.services as string[] : []);
  if (input.useEnvFile) {
    const service = (composeDocument.services as Record<string, Record<string, unknown>>)[input.gluetunServiceName!]!;
    delete service.environment;
    service.env_file = ["./gluetun.optional.env"];
  }
  const review = ["review_existing_configuration", "migrate_secrets"].includes(input.taskType);
  if (review && !input.pastedCompose?.trim()) throw new FieldValidationError("pastedCompose", "Paste your existing Compose configuration first.");
  const containsSecretValues = secretFields.some((field) => Boolean(input[field])) || Boolean(input.basicUsername) || (review && Boolean(inspected?.redacted.includes("[REDACTED]")));
  const separateRouting = input.taskType === "route_app_manually" && input.routingScope === "separate_project";
  let vpnPortFragment = "";
  if (separateRouting) {
    const serviceMap = composeDocument.services as Record<string, unknown>;
    vpnPortFragment = YAML.stringify({ services: { [input.gluetunServiceName!]: serviceMap[input.gluetunServiceName!] } }, { lineWidth: 0 });
    delete serviceMap[input.gluetunServiceName!];
  }
  const compose = review ? inspected!.redacted : YAML.stringify(escapeComposeValues(composeDocument), { lineWidth: 0 });
  const checkedSource = validateDocument(review ? input.pastedCompose! : compose, !review && input.taskType !== "new_gluetun_setup");
  const { parsed: _checkedParsed, ...validation } = checkedSource;
  if (review && !inspected!.valid) { validation.valid = false; validation.errors = inspected!.errors; }
  const existingPorts = inspected?.valid ? (inspected.detected.publishedHostPorts as number[] ?? []) : [];
  const plannedPorts = input.hostPort ? [input.hostPort] : [];
  const existing = input.pastedCompose && inspected?.valid ? composeBindings(YAML.parse(input.pastedCompose)) : { bindings: [], unresolved: false };
  const planned = input.hostPort ? { address: input.hostAddress ?? "", first: input.hostPort, last: input.hostPort, protocol: input.protocol ?? "tcp" } : null;
  const conflicts = planned ? existing.bindings.filter((binding) => bindingsOverlap(binding, planned) && !(binding.service === input.gluetunServiceName && binding.target === input.containerPort && binding.protocol === planned.protocol && binding.first === planned.first && binding.last === planned.last && binding.address === planned.address)) : [];
  const collisions = conflicts.length ? plannedPorts : [];
  const warnings = [...new Set([...validation.warnings, ...(inspected?.warnings ?? [])])];
  if (existing.unresolved) warnings.push("Interpolated host bindings cannot be checked for collisions until Docker Compose resolves the deployment environment.");
  if (collisions.length) warnings.push(`Host port collision detected: ${collisions.join(", ")}.`);
  if (input.authMode === "none") warnings.push("Unauthenticated Gluetun Control Server access is strongly discouraged.");
  if (input.pastedCompose && !inspected?.valid) warnings.push("The pasted Compose file is invalid and was not used for detection.");
  if (!review && input.taskType !== "new_gluetun_setup" && inspected?.valid && !(inspected.detected.gluetunServices as string[]).length) warnings.push("The pasted context contains no identified Gluetun service. The proposal uses the default gluetun target; verify the complete VPN stack and its exact service name before applying it.");
  if (review) warnings.push("Review output always redacts credentials. Keep the original values when applying changes manually.");
  else if (containsSecretValues && input.includeSecrets !== true) warnings.push("Secret values are redacted. Include sensitive values and generate again before deployment.");

  const manualSteps = review ? [
    "This is a redacted review of your existing stack, not a deployable replacement.",
    "Keep your original Compose file and all runtime settings; never deploy [REDACTED] markers.",
    "For secret storage changes, consult the official walkthrough for each image and use only documented credential file settings.",
    "A Compose secret mount alone does not make an application read that secret. Tuniku does not invent *_FILE variables or automatically migrate credentials.",
    "Validate any manual changes with `docker compose config` before redeploying."
  ] : input.taskType === "new_gluetun_setup" ? [
    "Keep the current Tuniku stack running; do not replace or duplicate its service.",
    `Confirm that the existing Tuniku stack created the Docker network named ${deploymentName(input.externalNetworkName, "tuniku", "externalNetworkName")}.`,
    `Import this file as a separate ${deploymentName(input.composeProjectName, "tuniku-gluetun", "composeProjectName", true)} stack in ZimaOS. It attaches only Gluetun to the existing external network.`,
    "Validate the add-on with `docker compose -f docker-compose.gluetun-addon.yml config`.",
    "Deploy the add-on and inspect the Gluetun logs until its health check is healthy.",
    `In Tuniku Settings, connect to http://${input.gluetunServiceName}:8000 and enter the same Control Server authentication values.`,
    "Test the connection in Tuniku and verify the VPN public IP."
  ] : [
    "Review the generated fragment and compare it with the Gluetun documentation for your installed version.",
    "Keep the current Tuniku stack running and preserve the existing project, container names, volumes and networks. Confirm that Tuniku can reach Gluetun on the existing shared network.",
    "Edit your Compose stack manually with this proposal. Tuniku does not write the host file or require Docker access.",
    "Validate the resulting Compose stack with `docker compose config`.",
    "Redeploy or recreate the affected services manually.",
    "Test the Gluetun Control Server and verify the application public IP after deployment."
  ];
  if (separateRouting) {
    warnings.push("Separate projects have no Compose startup dependency. A VPN replacement requires coordinated recreation of the routed application; restarting it does not update its namespace.");
    manualSteps.push("Merge the application fragment only into its existing application project. Preserve its image, volumes, labels and other settings; do not create a duplicate VPN there.");
    manualSteps.push("Save docker-compose.vpn-ports.fragment.yml and merge it into the existing VPN project, not the application project.");
    manualSteps.push("Start and verify the VPN before recreating the application. After every VPN replacement, recreate the dependent application against the current VPN container and verify its routing. Cross-project migration and automatic startup recovery are not performed.");
  }
  const securityWarnings = [
    "Never commit real VPN credentials, private keys, API keys, or generated full-secret snippets.",
    "Do not expose an unauthenticated Gluetun Control Server to an untrusted network.",
    "Published ports may expose an application beyond the intended network; consider an explicit host bind address.",
    "The generated response can contain VPN and Control Server credentials. Keep it local and close the result when deployment is complete.",
    "Environment and file binding support can depend on the installed Gluetun version. Verify generated keys before deployment."
  ];
  if (input.anyLocation) {
    manualSteps.push("Any location removes geographical and server-name/hostname constraints; category, ISP and provider-specific preferences remain. Review the explicit empty location values in this proposal against the complete merged stack.");
    manualSteps.push("Remove conflicting modern and legacy location filters from the base Compose and all env files, including COUNTRY, REGION, CITY, SERVER_HOSTNAME, SERVER_NAME and SERVER_NUMBER. A fragment alone does not delete them. Validate the resolved configuration, recreate affected containers, then inspect actual Gluetun server selection; do not treat a tunnel IP or reported IP geolocation as proof of server location.");
  }
  if (input.useEnvFile) {
    manualSteps.push("Save gluetun.optional.env beside the Compose file, restrict it to mode 0600, and keep both files out of Git and shared backups. It contains plaintext credentials when sensitive values are included.");
    manualSteps.push("Use env_file as the single configuration source; remove overlapping environment entries and inspect docker compose config locally without sharing its secret-bearing output. Recreate the container after changing the env file; restart alone does not reload it.");
  }
  const env = buildEnv(input, profile);
  const secrets = [
    "New Tuniku installations need only ISHIKU_SETUP_SECRET in Compose.",
    "Tuniku generates persistent internal session and credential-encryption keys under /data/.secrets.",
    "Use ISHIKU_SETUP_SECRET_FILE and file mode 0600 only when a file-backed setup value is preferred.",
    "Gluetun credential file support depends on the installed Gluetun version; do not invent *_FILE variables."
  ].join("\n");
  const steps = manualSteps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const result: ComposeGenerationResult = {
    detectedConfiguration: inspected?.detected ?? {
      provider: input.provider || "unknown",
      vpnType: input.vpnType || "unknown",
      publishedHostPorts: existingPorts
    },
    recommendedChange: review ? "Review the redacted copy below alongside your original stack. No runtime configuration or credential storage has been changed."
      : input.taskType === "new_gluetun_setup"
      ? `Deploy the generated Gluetun-only add-on beside the running Tuniku stack, then connect Tuniku to http://${input.gluetunServiceName}:8000.`
      : "Apply the generated Compose fragment manually, then redeploy and verify the actual Gluetun state.",
    snippets: { compose, env, secrets, steps },
    manualSteps,
    securityWarnings,
    validation: { valid: validation.valid && collisions.length === 0, errors: [...validation.errors, ...(collisions.length ? [`Host port collision detected: ${collisions.join(", ")}.`] : [])], warnings, checks: [
      { id: "yaml", label: "YAML syntax", status: validation.yamlValid ? "passed" : "failed", detail: "Safe parsing with duplicate-key and alias limits. This does not prove deployment readiness." },
      { id: "provider", label: "Provider inputs", status: providerTasks.has(input.taskType) ? "passed" : "not_applicable", detail: providerTasks.has(input.taskType) ? "Required fields, supported values and credential formats checked against Tuniku's provider schema. No account login or VPN handshake was attempted." : "This task does not validate provider account settings from the existing deployment." },
      { id: "compose_structure", label: "Compose structure", status: !validation.yamlValid ? "not_run" : validation.valid && collisions.length === 0 ? "passed" : "failed", detail: "Bounded structure, port and reference checks. Fragments still require validation of the complete merged stack." },
      { id: "compose_cli", label: "Docker Compose config", status: "not_run", detail: "Run docker compose config locally on the complete stack with its actual env files and deployment environment. Output may contain secrets." },
      { id: "runtime", label: "VPN and application runtime", status: "not_run", detail: "Deploy manually, test Control Server authentication and verify the application public IP, VPN handshake, DNS and IPv6 behavior. No runtime or leak check has been performed." }
    ] },
    artifacts: [
      { filename: input.taskType === "new_gluetun_setup" ? "docker-compose.gluetun-addon.yml" : "docker-compose.generated.yml", content: compose, mediaType: "application/yaml" },
      ...(separateRouting ? [{ filename: "docker-compose.vpn-ports.fragment.yml", content: vpnPortFragment, mediaType: "application/yaml" }] : []),
      { filename: "gluetun.optional.env", content: env, mediaType: "text/plain" },
      { filename: "secrets.README.txt", content: `${secrets}\n`, mediaType: "text/plain" },
      { filename: "tuniku-manual-steps.md", content: `${steps}\n`, mediaType: "text/markdown" }
    ],
    containsSecretValues,
    redacted: containsSecretValues && (review || input.includeSecrets !== true)
  };
  return result;
}

export function redactedDraftInput(input: ComposeGenerationInput): Record<string, unknown> {
  const safe = { ...input, pastedCompose: input.pastedCompose ? inspectCompose(input.pastedCompose).redacted : undefined };
  for (const field of [...secretFields, "basicUsername"] as const) if (safe[field]) safe[field] = "[REDACTED]";
  return redactValue(safe) as Record<string, unknown>;
}

function escapeComposeValues(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll("$", "$$$$");
  if (Array.isArray(value)) return value.map(escapeComposeValues);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, escapeComposeValues(entry)]));
  return value;
}

function scopedInput(input: ComposeGenerationInput): ComposeGenerationInput {
  const result: ComposeGenerationInput = { taskType: input.taskType,
    ...(input.includeSecrets === undefined ? {} : { includeSecrets: input.includeSecrets }),
    ...(input.pastedCompose === undefined ? {} : { pastedCompose: input.pastedCompose }) };
  if (input.taskType === "new_gluetun_setup" && input.useEnvFile !== undefined) result.useEnvFile = input.useEnvFile;
  if (input.gluetunServiceName !== undefined) result.gluetunServiceName = input.gluetunServiceName;
  if (input.taskType === "new_gluetun_setup") Object.assign(result, { gluetunContainerName: input.gluetunContainerName, composeProjectName: input.composeProjectName, externalNetworkName: input.externalNetworkName });
  if (providerTasks.has(input.taskType)) {
    Object.assign(result, Object.fromEntries(["provider", "vpnType", "anyLocation", "countries", "regions", "cities", "hostnames", "serverNames", "categories", "isps", "providerOptions"].map((key) => [key, (input as any)[key]])));
    if (completeProviderTasks.has(input.taskType)) {
      const fields = input.vpnType === "wireguard"
        ? ["wireguardPrivateKey", "wireguardAddresses", "wireguardPresharedKey", "wireguardPublicKey", "wireguardEndpointIp", "wireguardEndpointPort"]
        : ["openvpnUser", "openvpnPassword", "openvpnCertificate", "openvpnKey", "openvpnEncryptedKey", "openvpnKeyPassphrase", "customOpenvpnConfigPath"];
      Object.assign(result, Object.fromEntries(fields.map((key) => [key, (input as any)[key]])));
    }
  }
  if (["new_gluetun_setup", "enable_control_server", "configure_control_auth"].includes(input.taskType)) {
    Object.assign(result, { authMode: input.authMode, ...(input.authMode === "api_key" ? { apiKey: input.apiKey } : input.authMode === "basic" ? { basicUsername: input.basicUsername, basicPassword: input.basicPassword } : {}) });
  }
  if (["new_gluetun_setup", "publish_app_port", "route_app_manually"].includes(input.taskType)) {
    Object.assign(result, { hostAddress: input.hostAddress, hostPort: input.hostPort, containerPort: input.containerPort, protocol: input.protocol });
  }
  if (input.taskType === "route_app_manually") Object.assign(result, { appName: input.appName, appImage: input.appImage, routingScope: input.routingScope, gluetunContainerName: input.gluetunContainerName });
  return result;
}

export function manualRoutingFragment(appName = "app", appImage = "example/app:version", hostPort = 8080, containerPort = 8080): string {
  return YAML.stringify(buildCompose({
    taskType: "route_app_manually",
    appName,
    appImage,
    hostPort,
    containerPort,
    protocol: "tcp"
  }), { lineWidth: 0 });
}
