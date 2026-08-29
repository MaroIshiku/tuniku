import YAML, { parseDocument } from "yaml";
import { redactText, redactValue } from "../security.js";

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
  authMode?: "none" | "api_key" | "basic";
  apiKey?: string;
  basicUsername?: string;
  basicPassword?: string;
  wireguardPrivateKey?: string;
  wireguardAddresses?: string;
  openvpnUser?: string;
  openvpnPassword?: string;
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
  "openvpnUser",
  "openvpnPassword"
] as const;

function assertPort(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65_535)) {
    throw new Error(`${label} must be a number between 1 and 65535.`);
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

function providerEnvironment(input: ComposeGenerationInput): Record<string, string> {
  const environment: Record<string, string> = {};
  if (input.provider) environment.VPN_SERVICE_PROVIDER = "${VPN_SERVICE_PROVIDER}";
  if (input.vpnType) environment.VPN_TYPE = "${VPN_TYPE}";
  if (input.countries) environment.SERVER_COUNTRIES = "${SERVER_COUNTRIES}";
  if (input.regions) environment.SERVER_REGIONS = "${SERVER_REGIONS}";
  if (input.cities) environment.SERVER_CITIES = "${SERVER_CITIES}";
  if (input.wireguardPrivateKey) environment.WIREGUARD_PRIVATE_KEY = "${WIREGUARD_PRIVATE_KEY}";
  if (input.wireguardAddresses) environment.WIREGUARD_ADDRESSES = "${WIREGUARD_ADDRESSES}";
  if (input.openvpnUser) environment.OPENVPN_USER = "${OPENVPN_USER}";
  if (input.openvpnPassword) environment.OPENVPN_PASSWORD = "${OPENVPN_PASSWORD}";
  if (input.authMode === "none") environment.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE = '{"auth":"none"}';
  if (input.authMode === "api_key") environment.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE = "${HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE}";
  if (input.authMode === "basic") environment.HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE = "${HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE}";
  return environment;
}

function buildCompose(input: ComposeGenerationInput): Record<string, unknown> {
  const gluetun: Record<string, unknown> = {
    image: "ghcr.io/qdm12/gluetun:v3.41.3@sha256:fa19cc76b2af13d57a8d3dc3066f2ada061b1c761b8aecf989b3877c0486e027",
    container_name: "gluetun",
    cap_add: ["NET_ADMIN"],
    environment: providerEnvironment(input),
    volumes: ["./gluetun:/gluetun"],
    restart: "unless-stopped"
  };
  const services: Record<string, unknown> = { gluetun };
  if (input.taskType === "new_gluetun_setup") {
    services.tuniku = {
      image: "ghcr.io/maroishiku/tuniku:0.3.0@sha256:41465fe12b1d5bf8b4d6a841bbe2c9a52f00937e3c46f32609a63616a163caf0",
      ports: ["65001:8080/tcp"],
      environment: {
        TUNIKU_DATA_PATH: "/data",
        ISHIKU_SETUP_SECRET: "replace-with-at-least-32-random-characters"
      },
      volumes: ["tuniku_data:/data"],
      depends_on: ["gluetun"],
      restart: "unless-stopped"
    };
  }
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
  const document: Record<string, unknown> = { services };
  if (input.taskType === "new_gluetun_setup") {
    document.volumes = { tuniku_data: {} };
  }
  return document;
}

function buildEnv(input: ComposeGenerationInput): string {
  const includeSecrets = input.includeSecrets === true;
  const lines = [
    envLine("VPN_SERVICE_PROVIDER", input.provider, includeSecrets, false),
    envLine("VPN_TYPE", input.vpnType, includeSecrets, false),
    envLine("SERVER_COUNTRIES", input.countries, includeSecrets, false),
    envLine("SERVER_REGIONS", input.regions, includeSecrets, false),
    envLine("SERVER_CITIES", input.cities, includeSecrets, false),
    envLine("WIREGUARD_PRIVATE_KEY", input.wireguardPrivateKey, includeSecrets, true),
    envLine("WIREGUARD_ADDRESSES", input.wireguardAddresses, includeSecrets, false),
    envLine("OPENVPN_USER", input.openvpnUser, includeSecrets, true),
    envLine("OPENVPN_PASSWORD", input.openvpnPassword, includeSecrets, true)
  ];
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

export function generateCompose(input: ComposeGenerationInput): ComposeGenerationResult {
  if (!composeTasks.includes(input.taskType)) throw new Error("Unsupported Compose Assistant task.");
  assertPort(input.hostPort, "Host port");
  assertPort(input.containerPort, "Container port");
  if ((input.hostPort === undefined) !== (input.containerPort === undefined)) {
    throw new Error("Host port and container port must be supplied together.");
  }
  const containsSecretValues = secretFields.some((field) => Boolean(input[field]));
  const composeDocument = buildCompose(input);
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

  const manualSteps = [
    "Review the generated fragment and compare it with the Gluetun documentation for your installed version.",
    "Set ISHIKU_SETUP_SECRET to at least 32 random characters before the first Tuniku start.",
    "Edit your Compose stack manually. Tuniku does not write the host file.",
    "Validate the resulting Compose stack with `docker compose config`.",
    "Redeploy or recreate the affected services manually.",
    "Test the Gluetun Control Server and verify the application public IP after deployment."
  ];
  const securityWarnings = [
    "Never commit real VPN credentials, private keys, API keys, or generated full-secret snippets.",
    "Do not expose an unauthenticated Gluetun Control Server to an untrusted network.",
    "Published ports may expose an application beyond the intended network; consider an explicit host bind address.",
    "Environment and file binding support can depend on the installed Gluetun version. Verify generated keys before deployment."
  ];
  const env = buildEnv(input);
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
    recommendedChange: "Apply the generated Compose fragment manually, then redeploy and verify the actual Gluetun state.",
    snippets: { compose, env, secrets, steps },
    manualSteps,
    securityWarnings,
    validation: { valid: validation.valid && collisions.length === 0, errors: validation.errors, warnings },
    artifacts: [
      { filename: "docker-compose.example.yml", content: compose, mediaType: "application/yaml" },
      { filename: ".env.example", content: env, mediaType: "text/plain" },
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
