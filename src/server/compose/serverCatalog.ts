import fs from "node:fs";
import path from "node:path";
import { fetch } from "undici";
import bundledCatalog from "./server-catalog.json" with { type: "json" };
import type { VpnProtocol } from "./providers.js";

export const serverFilterKeys = ["countries", "regions", "cities", "hostnames", "names", "categories", "isps"] as const;
export type ServerFilterKey = typeof serverFilterKeys[number];

type FilterChoices = Record<ServerFilterKey, string[]>;
type ProviderCatalog = {
  timestamp: number | null;
  protocols: Record<VpnProtocol, FilterChoices>;
};
type CatalogDocument = {
  schemaVersion: number;
  source: { repository: string; commit: string };
  generatedAt: string;
  providers: Record<string, ProviderCatalog>;
};

const bundled = bundledCatalog as CatalogDocument;
const sourceBaseUrl = "https://raw.githubusercontent.com/qdm12/gluetun-servers/main/pkg/servers";

function emptyChoices(): FilterChoices {
  return { countries: [], regions: [], cities: [], hostnames: [], names: [], categories: [], isps: [] };
}

function extractChoices(servers: unknown[], protocol: VpnProtocol): FilterChoices {
  const choices = emptyChoices();
  const sourceKeys: Record<ServerFilterKey, string> = {
    countries: "country",
    regions: "region",
    cities: "city",
    hostnames: "hostname",
    names: "server_name",
    categories: "categories",
    isps: "isp"
  };
  for (const server of servers) {
    if (!server || typeof server !== "object" || (server as any).vpn !== protocol) continue;
    for (const key of serverFilterKeys) {
      const raw = (server as any)[sourceKeys[key]];
      const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const value of values) {
        if (typeof value !== "string" || value.length === 0 || value.length > 500) continue;
        choices[key].push(value);
      }
    }
  }
  for (const key of serverFilterKeys) {
    choices[key] = [...new Set(choices[key])].sort((left, right) => left.localeCompare(right));
  }
  return choices;
}

function compactProvider(document: unknown): ProviderCatalog {
  if (!document || typeof document !== "object" || !Array.isArray((document as any).servers)) {
    throw new Error("The official Gluetun server response has an unsupported format.");
  }
  const servers = (document as any).servers as unknown[];
  if (servers.length > 100_000) throw new Error("The official Gluetun server response exceeds the safe record limit.");
  const timestamp = Number((document as any).timestamp);
  return {
    timestamp: Number.isSafeInteger(timestamp) ? timestamp : null,
    protocols: {
      openvpn: extractChoices(servers, "openvpn"),
      wireguard: extractChoices(servers, "wireguard")
    }
  };
}

function safeProviderFilename(provider: string): string {
  return `${provider.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`;
}

export class ServerCatalog {
  private readonly cacheDirectory: string;

  constructor(dataPath: string) {
    this.cacheDirectory = path.join(dataPath, "server-catalog");
  }

  private loadCached(provider: string): ProviderCatalog | null {
    const cachePath = path.join(this.cacheDirectory, safeProviderFilename(provider));
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf8")) as ProviderCatalog;
    } catch {
      return null;
    }
  }

  getProvider(provider: string): { catalog: ProviderCatalog; source: "refreshed" | "bundled"; sourceRevision: string } | null {
    const cached = this.loadCached(provider);
    if (cached) return { catalog: cached, source: "refreshed", sourceRevision: "qdm12/gluetun-servers main" };
    const catalog = bundled.providers[provider];
    return catalog ? { catalog, source: "bundled", sourceRevision: bundled.source.commit } : null;
  }

  choices(provider: string, protocol: VpnProtocol, field: ServerFilterKey): string[] {
    return this.getProvider(provider)?.catalog.protocols[protocol]?.[field] ?? [];
  }

  validate(provider: string, protocol: VpnProtocol, field: ServerFilterKey, input: string): string[] {
    const available = this.choices(provider, protocol, field);
    if (available.length === 0) return [`${field} is not available for ${provider} with ${protocol}.`];
    const lookup = new Map(available.map((value) => [value.toLocaleLowerCase("en"), value]));
    return input.split(",").map((value) => value.trim()).filter(Boolean).flatMap((value) =>
      lookup.has(value.toLocaleLowerCase("en")) ? [] : [`${value} is not a current ${field} value for ${provider} with ${protocol}.`]
    );
  }

  query(provider: string, protocol: VpnProtocol, field: ServerFilterKey, query: string, limit = 50): {
    values: string[];
    source: "refreshed" | "bundled";
    sourceRevision: string;
    updatedAt: string | null;
  } | null {
    const loaded = this.getProvider(provider);
    if (!loaded) return null;
    const needle = query.trim().toLocaleLowerCase("en");
    const values = loaded.catalog.protocols[protocol][field]
      .filter((value) => !needle || value.toLocaleLowerCase("en").includes(needle))
      .slice(0, Math.min(Math.max(limit, 1), 100));
    return {
      values,
      source: loaded.source,
      sourceRevision: loaded.sourceRevision,
      updatedAt: loaded.catalog.timestamp ? new Date(loaded.catalog.timestamp * 1000).toISOString() : null
    };
  }

  async refresh(provider: string): Promise<{ sourceRevision: string; updatedAt: string | null }> {
    const url = `${sourceBaseUrl}/${encodeURIComponent(provider)}.json`;
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Tuniku server catalog" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Official Gluetun server catalog returned HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("Official Gluetun server catalog exceeds the 16 MiB safety limit.");
    const compact = compactProvider(JSON.parse(new TextDecoder().decode(bytes)));
    fs.mkdirSync(this.cacheDirectory, { recursive: true, mode: 0o700 });
    const target = path.join(this.cacheDirectory, safeProviderFilename(provider));
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(compact)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
    return {
      sourceRevision: "qdm12/gluetun-servers main",
      updatedAt: compact.timestamp ? new Date(compact.timestamp * 1000).toISOString() : null
    };
  }
}
