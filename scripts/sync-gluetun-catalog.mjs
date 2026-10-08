import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const sourceDirectory = process.argv[2];
const sourceCommit = process.argv[3];
if (!sourceDirectory || !sourceCommit) {
  throw new Error("Usage: node scripts/sync-gluetun-catalog.mjs <gluetun-servers/pkg/servers> <commit>");
}

const manifest = JSON.parse(fs.readFileSync(path.join(sourceDirectory, "manifest.json"), "utf8"));
const keys = {
  countries: "country",
  regions: "region",
  cities: "city",
  hostnames: "hostname",
  names: "server_name",
  categories: "categories",
  isps: "isp"
};
const providers = {};

function extractChoices(servers) {
  const choices = {};
  for (const [target, source] of Object.entries(keys)) {
    const values = servers.flatMap((server) => {
      const value = server[source];
      return Array.isArray(value) ? value : value ? [value] : [];
    });
    choices[target] = [...new Set(values.map(String))].sort((left, right) => left.localeCompare(right));
  }
  return choices;
}

function extractRows(servers) {
  return servers.map((server) => Object.fromEntries(Object.entries(keys).flatMap(([target, source]) => {
    const raw = server[source];
    const values = (Array.isArray(raw) ? raw : [raw]).filter((value) => typeof value === "string" && value.length > 0 && value.length <= 500);
    return values.length ? [[target, values]] : [];
  })));
}

for (const provider of Object.keys(manifest).filter((key) => key !== "version").sort()) {
  const document = JSON.parse(fs.readFileSync(path.join(sourceDirectory, `${provider}.json`), "utf8"));
  const servers = Array.isArray(document.servers) ? document.servers : [];
  providers[provider] = {
    timestamp: document.timestamp ?? null,
    protocols: {
      openvpn: extractChoices(servers.filter((server) => server.vpn === "openvpn")),
      wireguard: extractChoices(servers.filter((server) => server.vpn === "wireguard"))
    },
    rows: {
      openvpn: extractRows(servers.filter((server) => server.vpn === "openvpn")),
      wireguard: extractRows(servers.filter((server) => server.vpn === "wireguard"))
    }
  };
}

const output = {
  schemaVersion: 1,
  source: {
    repository: "https://github.com/qdm12/gluetun-servers",
    commit: sourceCommit
  },
  generatedAt: new Date().toISOString(),
  providers
};
const outputPath = path.resolve("src/server/compose/server-catalog.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
process.stdout.write(`Wrote ${Object.keys(providers).length} provider catalogs to ${outputPath}.\n`);
