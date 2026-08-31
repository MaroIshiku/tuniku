import YAML, { parseDocument } from "yaml";
import { redactText, redactValue } from "../security.js";
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
  provider?: string;
  vpnType?: "wireguard" | "openvpn";
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
  appName?: string;
  appImage?: string;
  hostAddress?: string;
  hostPort?: number;
  containerPort?: number;
  protocol?: "tcp" | "udp";
  pastedCompose?: string;
  includeSecrets?: boolean;
}

export interface ComposeArtifact {
  filename: string;
  content: string;
  mediaType: string;
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

function assertPort(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65_535)) {
    throw new Error(`${label} must be a number between 1 and 65535.`);
  }
}

function requireValue(value: string | undefined, label: string): void {
  if (!value?.trim()) throw new Error(`${label} is required for this provider and protocol.`);
}

function validateProviderInput(input: ComposeGenerationInput, serverCatalog?: Pick<ServerCatalog, "validate">): GluetunProviderProfile | undefined {
  if (!providerTasks.has(input.taskType)) return undefined;
  const profile = getProviderProfile(input.provider);
  if (!profile) throw new Error("Choose a supported Gluetun provider from the list.");
  if (!input.vpnType || !profile.protocols.includes(input.vpnType)) {
    throw new Error(`${profile.label} does not support the selected VPN protocol in the current Gluetun latest image.`);
  }
  for (const [filter, inputKey] of Object.entries(filterInputs) as Array<[ServerFilterKey, keyof ComposeGenerationInput]>) {
    const value = input[inputKey];
    if (typeof value !== "string" || !value.trim()) continue;
    if (!profile.serverFilters.includes(filter)) {
      throw new Error(`${profile.label} does not support the ${filter} server filter.`);
    }
    const catalogErrors = serverCatalog?.validate(profile.id, input.vpnType, filter, value) ?? [];
    if (catalogErrors.length > 0) throw new Error(catalogErrors[0]);
  }
  for (const [environmentName, value] of Object.entries(input.providerOptions ?? {})) {
    if (!value) continue;
    const option = profile.options.find((candidate) => candidate.env === environmentName && (!candidate.protocols || candidate.protocols.includes(input.vpnType!)));
    if (!option) throw new Error(`${environmentName} is not supported for ${profile.label} with ${input.vpnType}.`);
    if (option.kind === "select" && !option.choices?.includes(value)) throw new Error(`${environmentName} has an unsupported value.`);
    if (option.kind === "number") assertPort(Number(value), option.label);
    if (option.kind === "boolean" && value !== option.enabledValue) throw new Error(`${environmentName} has an unsupported enabled value.`);
  }
  if (!completeProviderTasks.has(input.taskType)) return profile;
  if (input.vpnType === "wireguard") {
    requireValue(input.wireguardPrivateKey, "WireGuard private key");
    if (!profile.wireguardAddresses && input.wireguardAddresses?.trim()) throw new Error(`${profile.label} does not use WIREGUARD_ADDRESSES in its official walkthrough.`);
    if (!profile.wireguardPresharedKey && !profile.customConfiguration && input.wireguardPresharedKey?.trim()) throw new Error(`${profile.label} does not use WIREGUARD_PRESHARED_KEY in its official walkthrough.`);
    if (profile.wireguardAddresses) requireValue(input.wireguardAddresses, "WireGuard address");
    if (profile.wireguardPresharedKey) requireValue(input.wireguardPresharedKey, "WireGuard preshared key");
    if (profile.customConfiguration) {
      requireValue(input.wireguardPublicKey, "WireGuard server public key");
      requireValue(input.wireguardEndpointIp, "WireGuard endpoint IP");
      assertPort(input.wireguardEndpointPort, "WireGuard endpoint port");
      if (!input.wireguardEndpointPort) throw new Error("WireGuard endpoint port is required for a custom provider.");
    }
  } else if (profile.customConfiguration) {
    requireValue(input.customOpenvpnConfigPath, "Host path to the custom OpenVPN configuration");
    const sourcePath = input.customOpenvpnConfigPath?.trim() ?? "";
    if (!sourcePath.startsWith("/") || sourcePath.includes(":") || /[\r\n\0]/.test(sourcePath)) {
      throw new Error("The custom OpenVPN configuration must use a safe absolute Linux host path.");
    }
  } else {
    if (profile.openvpnCredentials === "required" || profile.id === "ivpn") requireValue(input.openvpnUser, "OpenVPN username");
    if (profile.openvpnCredentials === "required" && !profile.openvpnPasswordDefault) requireValue(input.openvpnPassword, "OpenVPN password");
    if (profile.openvpnCertificate === "client_key") {
      requireValue(input.openvpnCertificate, "OpenVPN client certificate");
      requireValue(input.openvpnKey, "OpenVPN client key");
    }
    if (profile.openvpnCertificate === "encrypted_key") {
      requireValue(input.openvpnCertificate, "OpenVPN client certificate");
      requireValue(input.openvpnEncryptedKey, "OpenVPN encrypted client key");
      requireValue(input.openvpnKeyPassphrase, "OpenVPN key passphrase");
    }
  }
  return profile;
}

function pemBody(value: string): string {
  return value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, "");
}

function validateControlAuth(input: ComposeGenerationInput): void {
  if (!["new_gluetun_setup", "enable_control_server", "configure_control_auth"].includes(input.taskType)) return;
  if (!input.authMode) throw new Error("Choose a Control Server authentication mode.");
  if (input.authMode === "api_key") requireValue(input.apiKey, "Control Server API key");
  if (input.authMode === "basic") {
    requireValue(input.basicUsername, "Control Server Basic Auth username");
    requireValue(input.basicPassword, "Control Server Basic Auth password");
  }
}

function safeServiceName(value: string | undefined): string {
  const name = (value || "app").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) return "app";
  return name.slice(0, 63);
}

function envLine(key: string, value: string | undefined, includeSecrets: boolean, secret: boolean): string | null {
  if (!value) return null;
  return `${key}=${secret && !includeSecrets ? "[REDACTED]" : value}`;
}

function validateDocument(input: string): { valid: boolean; errors: string[]; warnings: string[]; parsed: unknown } {
  if (Buffer.byteLength(input, "utf8") > 1_048_576) {
    return { valid: false, errors: ["Compose input exceeds the 1 MiB limit."], warnings: [], parsed: null };
  }
  const document = parseDocument(input, { strict: true, uniqueKeys: true });
  const errors = document.errors.map((error) => error.message);
  const warnings = document.warnings.map((warning) => warning.message);
  let parsed: unknown = null;
  if (errors.length === 0) {
    parsed = document.toJS({ maxAliasCount: 0 });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) errors.push("Compose content must be a YAML object.");
  }
  return { valid: errors.length === 0, errors, warnings, parsed };
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
    return { valid: false, errors: validation.errors, warnings: validation.warnings, detected: {}, redacted: redactText(input) };
  }
  const parsed = validation.parsed as any;
  const services = parsed.services && typeof parsed.services === "object" ? Object.keys(parsed.services) : [];
  const gluetun = parsed.services?.gluetun;
  const environment = Array.isArray(gluetun?.environment)
    ? gluetun.environment
    : gluetun?.environment && typeof gluetun.environment === "object"
      ? redactValue(gluetun.environment)
      : {};
  return {
    valid: true,
    errors: [],
    warnings: validation.warnings,
    detected: {
      services,
      hasGluetunService: Boolean(gluetun),
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
    const openvpnPassword = input.openvpnPassword || profile?.openvpnPasswordDefault;
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

function buildCompose(input: ComposeGenerationInput, profile?: GluetunProviderProfile): Record<string, unknown> {
  const gluetunVolumes = ["gluetun_data:/gluetun"];
  if (input.vpnType === "openvpn" && profile?.customConfiguration && input.customOpenvpnConfigPath) {
    gluetunVolumes.push(`${input.customOpenvpnConfigPath.trim()}:/gluetun/custom.conf:ro`);
  }
  const gluetun: Record<string, unknown> = {
    image: "qmcgaw/gluetun:latest",
    pull_policy: "always",
    container_name: "gluetun",
    cap_add: ["NET_ADMIN"],
    devices: ["/dev/net/tun:/dev/net/tun"],
    environment: providerEnvironment(input, profile),
    volumes: gluetunVolumes,
    networks: ["tuniku"],
    init: true,
    restart: "unless-stopped"
  };
  const services: Record<string, unknown> = { gluetun };
  if (input.hostPort && input.containerPort) {
    gluetun.ports = [
      `${input.hostAddress?.trim() ? `${input.hostAddress.trim()}:` : ""}${input.hostPort}:${input.containerPort}/${input.protocol || "tcp"}`
    ];
  }
  if (input.taskType === "route_app_manually") {
    const serviceName = safeServiceName(input.appName);
    services[serviceName] = {
      image: input.appImage || "example/app:version",
      network_mode: "service:gluetun",
      depends_on: ["gluetun"]
    };
  }
  const document: Record<string, unknown> = {
    name: "tuniku-gluetun",
    services,
    networks: {
      tuniku: {
        external: true,
        name: "tuniku"
      }
    },
    volumes: { gluetun_data: {} }
  };
  return document;
}

function buildEnv(input: ComposeGenerationInput, profile?: GluetunProviderProfile): string {
  const includeSecrets = input.includeSecrets === true;
  const lines = [
    envLine("VPN_SERVICE_PROVIDER", input.provider, includeSecrets, false),
    envLine("VPN_TYPE", input.vpnType, includeSecrets, false),
    envLine("SERVER_COUNTRIES", input.countries, includeSecrets, false),
    envLine("SERVER_REGIONS", input.regions, includeSecrets, false),
    envLine("SERVER_CITIES", input.cities, includeSecrets, false),
    envLine("SERVER_HOSTNAMES", input.hostnames, includeSecrets, false),
    envLine("SERVER_NAMES", input.serverNames, includeSecrets, false),
    envLine("SERVER_CATEGORIES", input.categories, includeSecrets, false),
    envLine("ISP", input.isps, includeSecrets, false),
    envLine("WIREGUARD_PRIVATE_KEY", input.vpnType === "wireguard" ? input.wireguardPrivateKey : undefined, includeSecrets, true),
    envLine("WIREGUARD_ADDRESSES", input.vpnType === "wireguard" ? input.wireguardAddresses : undefined, includeSecrets, false),
    envLine("WIREGUARD_PRESHARED_KEY", input.vpnType === "wireguard" ? input.wireguardPresharedKey : undefined, includeSecrets, true),
    envLine("WIREGUARD_PUBLIC_KEY", input.vpnType === "wireguard" && profile?.customConfiguration ? input.wireguardPublicKey : undefined, includeSecrets, false),
    envLine("WIREGUARD_ENDPOINT_IP", input.vpnType === "wireguard" && profile?.customConfiguration ? input.wireguardEndpointIp : undefined, includeSecrets, false),
    envLine("WIREGUARD_ENDPOINT_PORT", input.vpnType === "wireguard" && profile?.customConfiguration && input.wireguardEndpointPort ? String(input.wireguardEndpointPort) : undefined, includeSecrets, false),
    envLine("OPENVPN_USER", input.vpnType === "openvpn" ? input.openvpnUser : undefined, includeSecrets, true),
    envLine("OPENVPN_PASSWORD", input.vpnType === "openvpn" ? input.openvpnPassword || profile?.openvpnPasswordDefault : undefined, includeSecrets, true),
    envLine("OPENVPN_CERT", input.vpnType === "openvpn" && input.openvpnCertificate ? pemBody(input.openvpnCertificate) : undefined, includeSecrets, true),
    envLine("OPENVPN_KEY", input.vpnType === "openvpn" && input.openvpnKey ? pemBody(input.openvpnKey) : undefined, includeSecrets, true),
    envLine("OPENVPN_ENCRYPTED_KEY", input.vpnType === "openvpn" && input.openvpnEncryptedKey ? pemBody(input.openvpnEncryptedKey) : undefined, includeSecrets, true),
    envLine("OPENVPN_KEY_PASSPHRASE", input.vpnType === "openvpn" ? input.openvpnKeyPassphrase : undefined, includeSecrets, true),
    envLine("OPENVPN_CUSTOM_CONFIG", input.vpnType === "openvpn" && profile?.customConfiguration && input.customOpenvpnConfigPath ? "/gluetun/custom.conf" : undefined, includeSecrets, false)
  ];
  for (const [key, value] of Object.entries(input.providerOptions ?? {})) {
    lines.push(envLine(key, value, includeSecrets, false));
  }
  if (input.authMode === "api_key" && input.apiKey) {
    lines.push(
      envLine(
        "HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE",
        JSON.stringify({ auth: "apikey", apikey: input.apiKey }),
        includeSecrets,
        true
      )
    );
  }
  if (input.authMode === "basic" && input.basicUsername && input.basicPassword) {
    lines.push(
      envLine(
        "HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE",
        JSON.stringify({ auth: "basic", username: input.basicUsername, password: input.basicPassword }),
        includeSecrets,
        true
      )
    );
  }
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export function generateCompose(input: ComposeGenerationInput, serverCatalog?: Pick<ServerCatalog, "validate">): ComposeGenerationResult {
  if (!composeTasks.includes(input.taskType)) throw new Error("Unsupported Compose Assistant task.");
  assertPort(input.hostPort, "Host port");
  assertPort(input.containerPort, "Container port");
  if ((input.hostPort === undefined) !== (input.containerPort === undefined)) {
    throw new Error("Host port and container port must be supplied together.");
  }
  const profile = validateProviderInput(input, serverCatalog);
  validateControlAuth(input);
  const containsSecretValues = secretFields.some((field) => Boolean(input[field])) || Boolean(input.basicUsername);
  const composeDocument = buildCompose(input, profile);
  const compose = YAML.stringify(composeDocument, { lineWidth: 0 });
  const validation = validateCompose(compose);
  const inspected = input.pastedCompose ? inspectCompose(input.pastedCompose) : null;
  const existingPorts = inspected?.valid ? (inspected.detected.publishedHostPorts as number[] ?? []) : [];
  const plannedPorts = input.hostPort ? [input.hostPort] : [];
  const collisions = detectPortCollisions(existingPorts, plannedPorts);
  const warnings = [...validation.warnings];
  if (collisions.length) warnings.push(`Host port collision detected: ${collisions.join(", ")}.`);
  if (input.authMode === "none") warnings.push("Unauthenticated Gluetun Control Server access is strongly discouraged.");
  if (input.pastedCompose && !inspected?.valid) warnings.push("The pasted Compose file is invalid and was not used for detection.");
  if (containsSecretValues && input.includeSecrets !== true) warnings.push("Secret values are redacted. Include sensitive values and generate again before deployment.");

  const manualSteps = input.taskType === "new_gluetun_setup" ? [
    "Keep the current Tuniku stack running; do not replace or duplicate its service.",
    "Confirm that the existing Tuniku stack created the Docker network named `tuniku`.",
    "Import this file as a separate `tuniku-gluetun` stack in ZimaOS. It attaches only Gluetun to the existing external network.",
    "Validate the add-on with `docker compose -f docker-compose.gluetun-addon.yml config`.",
    "Deploy the add-on and inspect the Gluetun logs until its health check is healthy.",
    "In Tuniku Settings, connect to `http://gluetun:8000` and enter the same Control Server authentication values.",
    "Test the connection in Tuniku and verify the VPN public IP."
  ] : [
    "Review the generated fragment and compare it with the Gluetun documentation for your installed version.",
    "Keep the current Tuniku stack running and attach Gluetun to its existing external `tuniku` network.",
    "Edit your Compose stack manually with this proposal. Tuniku does not write the host file or require Docker access.",
    "Validate the resulting Compose stack with `docker compose config`.",
    "Redeploy or recreate the affected services manually.",
    "Test the Gluetun Control Server and verify the application public IP after deployment."
  ];
  const securityWarnings = [
    "Never commit real VPN credentials, private keys, API keys, or generated full-secret snippets.",
    "Do not expose an unauthenticated Gluetun Control Server to an untrusted network.",
    "Published ports may expose an application beyond the intended network; consider an explicit host bind address.",
    "The generated response can contain VPN and Control Server credentials. Keep it local and close the result when deployment is complete.",
    "Environment and file binding support can depend on the installed Gluetun version. Verify generated keys before deployment."
  ];
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
    recommendedChange: input.taskType === "new_gluetun_setup"
      ? "Deploy the generated Gluetun-only add-on beside the running Tuniku stack, then connect Tuniku to http://gluetun:8000."
      : "Apply the generated Compose fragment manually, then redeploy and verify the actual Gluetun state.",
    snippets: { compose, env, secrets, steps },
    manualSteps,
    securityWarnings,
    validation: { valid: validation.valid && collisions.length === 0, errors: validation.errors, warnings },
    artifacts: [
      { filename: input.taskType === "new_gluetun_setup" ? "docker-compose.gluetun-addon.yml" : "docker-compose.generated.yml", content: compose, mediaType: "application/yaml" },
      { filename: "gluetun.optional.env", content: env, mediaType: "text/plain" },
      { filename: "secrets.README.txt", content: `${secrets}\n`, mediaType: "text/plain" },
      { filename: "tuniku-manual-steps.md", content: `${steps}\n`, mediaType: "text/markdown" }
    ],
    containsSecretValues,
    redacted: containsSecretValues && input.includeSecrets !== true
  };
  return result;
}

export function redactedDraftInput(input: ComposeGenerationInput): Record<string, unknown> {
  return redactValue({ ...input, pastedCompose: input.pastedCompose ? redactText(input.pastedCompose) : undefined }) as Record<string, unknown>;
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
