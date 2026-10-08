import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fetch } from "undici";
import { readBoundedBody } from "../http.js";
import bundledCatalog from "./server-catalog.json" with { type: "json" };
import type { VpnProtocol } from "./providers.js";

export const serverFilterKeys = ["countries", "regions", "cities", "hostnames", "names", "categories", "isps"] as const;
export type ServerFilterKey = typeof serverFilterKeys[number];

type FilterChoices = Record<ServerFilterKey, string[]>;
type ServerRow = Partial<FilterChoices>;
export type ServerSelection = Partial<Record<ServerFilterKey, string | undefined>>;
type ProviderCatalog = {
  provenance?: { revision: string; retrievedAt: string; sha256: string };
  timestamp: number | null;
  protocols: Record<VpnProtocol, FilterChoices>;
  rows?: Record<VpnProtocol, ServerRow[]>;
};
type CatalogDocument = {
  schemaVersion: number;
  source: { repository: string; commit: string };
  generatedAt: string;
  providers: Record<string, ProviderCatalog>;
};

const bundled = bundledCatalog as CatalogDocument;
const sourceRepository = "https://github.com/qdm12/gluetun-servers";

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

function extractRows(servers: unknown[], protocol: VpnProtocol): ServerRow[] {
  const sourceKeys = ["country", "region", "city", "hostname", "server_name", "categories", "isp"];
  return servers.filter((server) => server && typeof server === "object" && (server as any).vpn === protocol).map((server) =>
    Object.fromEntries(serverFilterKeys.flatMap((key, index) => {
      const raw = (server as any)[sourceKeys[index]!];
      const values = (Array.isArray(raw) ? raw : [raw]).filter((value) => typeof value === "string" && value.length > 0 && value.length <= 500);
      return values.length ? [[key, values]] : [];
    })) as ServerRow
  );
}

function matches(row: ServerRow, selection: ServerSelection): boolean {
  return serverFilterKeys.every((field) => {
    const values = (selection[field] ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    return values.length === 0 || (row[field] ?? []).some((value) => values.includes(value.toLowerCase()));
  });
}

function compactProvider(document: unknown): ProviderCatalog {
  if (!document || typeof document !== "object" || !Array.isArray((document as any).servers)) {
    throw new Error("The official Gluetun server response has an unsupported format.");
  }
  const servers = (document as any).servers as unknown[];
  if (servers.length > 100_000) throw new Error("The official Gluetun server response exceeds the safe record limit.");
  const timestamp = Number((document as any).timestamp);
  return {
    timestamp: Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= 8_640_000_000_000 ? timestamp : null,
    protocols: {
      openvpn: extractChoices(servers, "openvpn"),
      wireguard: extractChoices(servers, "wireguard")
    },
    rows: { openvpn: extractRows(servers, "openvpn"), wireguard: extractRows(servers, "wireguard") }
  };
}

function safeProviderFilename(provider: string): string {
  return `${provider.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`;
}

export class ServerCatalog {
  private readonly cacheDirectory: string;
  private readonly memoryCache = new Map<string, { version: string; catalog: ProviderCatalog }>();

  constructor(dataPath: string) {
    this.cacheDirectory = path.join(dataPath, "server-catalog");
  }

  private loadCached(provider: string): ProviderCatalog | null {
    const cachePath = path.join(this.cacheDirectory, safeProviderFilename(provider));
    try {
      const stat = fs.statSync(cachePath);
      if (stat.size > 16 * 1024 * 1024) return null;
      const version = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      const memory = this.memoryCache.get(provider);
      if (memory?.version === version) return memory.catalog;
      const catalog = JSON.parse(fs.readFileSync(cachePath, "utf8")) as ProviderCatalog;
      if (!catalog || !["openvpn", "wireguard"].every((protocol) =>
        serverFilterKeys.every((field) => Array.isArray(catalog.protocols?.[protocol as VpnProtocol]?.[field]) &&
          catalog.protocols[protocol as VpnProtocol][field].every((value) => typeof value === "string")))) return null;
      if (catalog.timestamp !== null && (!Number.isSafeInteger(catalog.timestamp) || Math.abs(catalog.timestamp) > 8_640_000_000_000)) return null;
      if (catalog.provenance && (!/^[a-f0-9]{40}$/.test(catalog.provenance.revision) || !/^[a-f0-9]{64}$/.test(catalog.provenance.sha256) || !Number.isFinite(Date.parse(catalog.provenance.retrievedAt)))) return null;
      if (catalog.rows && !["openvpn", "wireguard"].every((protocol) => {
        const rows = catalog.rows?.[protocol as VpnProtocol];
        return Array.isArray(rows) && rows.length <= 100_000 && rows.every((row) => row && typeof row === "object" &&
          serverFilterKeys.every((field) => row[field] === undefined || (Array.isArray(row[field]) && row[field]!.every((value) => typeof value === "string" && value.length <= 500))));
      })) return null;
      this.memoryCache.set(provider, { version, catalog });
      return catalog;
    } catch {
      return null;
    }
  }

  getProvider(provider: string): { catalog: ProviderCatalog; source: "refreshed" | "bundled"; sourceRevision: string } | null {
    const cached = this.loadCached(provider);
    if (cached) return { catalog: cached, source: "refreshed", sourceRevision: cached.provenance?.revision ?? "Unknown revision (legacy cache)" };
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

  validateSelection(provider: string, protocol: VpnProtocol, selection: ServerSelection): string[] {
    if (!Object.values(selection).some((value) => value?.trim())) return [];
    const rows = this.getProvider(provider)?.catalog.rows?.[protocol];
    if (!rows) return ["Server relationships are unavailable. Refresh the provider catalog before selecting server filters."];
    return rows.some((row) => matches(row, selection)) ? [] : ["The selected server filters do not match any server together. Choose a compatible country, city and hostname."];
  }

  query(provider: string, protocol: VpnProtocol, field: ServerFilterKey, query: string, limit = 50, selection: ServerSelection = {}): {
    values: string[];
    source: "refreshed" | "bundled";
    sourceRevision: string;
    updatedAt: string | null;
    sourceUrl: string | null;
    retrievedAt: string | null;
    bundledAt: string | null;
    sourceSha256: string | null;
    runtimeComparison: "unavailable";
  } | null {
    const loaded = this.getProvider(provider);
    if (!loaded) return null;
    const needle = query.trim().toLocaleLowerCase("en");
    const rows = loaded.catalog.rows?.[protocol];
    const otherFilters = { ...selection, [field]: "" };
    const choices = rows && Object.values(otherFilters).some((value) => value?.trim())
      ? [...new Set(rows.filter((row) => matches(row, otherFilters)).flatMap((row) => row[field] ?? []))].sort((a, b) => a.localeCompare(b))
      : loaded.catalog.protocols[protocol][field];
    const values = choices
      .filter((value) => !needle || value.toLocaleLowerCase("en").includes(needle))
      .slice(0, Math.min(Math.max(limit, 1), 100));
    return {
      values,
      source: loaded.source,
      sourceRevision: loaded.sourceRevision,
      sourceUrl: /^[a-f0-9]{40}$/.test(loaded.sourceRevision) ? `${sourceRepository}/blob/${loaded.sourceRevision}/pkg/servers/${encodeURIComponent(provider)}.json` : null,
      retrievedAt: loaded.catalog.provenance?.retrievedAt ?? null,
      bundledAt: loaded.source === "bundled" ? bundled.generatedAt : null,
      sourceSha256: loaded.catalog.provenance?.sha256 ?? null,
      runtimeComparison: "unavailable",
      updatedAt: loaded.catalog.timestamp ? new Date(loaded.catalog.timestamp * 1000).toISOString() : null
    };
  }

  async refresh(provider: string): Promise<{ sourceRevision: string; updatedAt: string | null }> {
    const signal = AbortSignal.timeout(20_000);
    const metadata = await fetch("https://api.github.com/repos/qdm12/gluetun-servers/commits/main", {
      redirect: "error", signal, headers: { accept: "application/json", "user-agent": "Tuniku server catalog" }
    });
    if (!metadata.ok) { await metadata.body?.cancel(); throw new Error(`Official catalog revision returned HTTP ${metadata.status}.`); }
    const revision = JSON.parse(new TextDecoder().decode(await readBoundedBody(metadata, 256 * 1024))).sha;
    if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Official catalog revision is invalid; previous catalog retained.");
    const url = `https://raw.githubusercontent.com/qdm12/gluetun-servers/${revision}/pkg/servers/${encodeURIComponent(provider)}.json`;
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Tuniku server catalog" },
      redirect: "error", signal
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Official Gluetun server catalog returned HTTP ${response.status}.`); }
    const bytes = await readBoundedBody(response, 16 * 1024 * 1024);
    const compact = compactProvider(JSON.parse(new TextDecoder().decode(bytes)));
    compact.provenance = { revision, retrievedAt: new Date().toISOString(), sha256: createHash("sha256").update(bytes).digest("hex") };
    fs.mkdirSync(this.cacheDirectory, { recursive: true, mode: 0o700 });
    const target = path.join(this.cacheDirectory, safeProviderFilename(provider));
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(compact)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
    return {
      sourceRevision: revision,
      updatedAt: compact.timestamp ? new Date(compact.timestamp * 1000).toISOString() : null
    };
  }
}
