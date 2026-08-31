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

for (const provider of Object.keys(manifest).filter((key) => key !== "version").sort()) {
  const document = JSON.parse(fs.readFileSync(path.join(sourceDirectory, `${provider}.json`), "utf8"));
  const servers = Array.isArray(document.servers) ? document.servers : [];
  providers[provider] = {
    timestamp: document.timestamp ?? null,
    protocols: {
      openvpn: extractChoices(servers.filter((server) => server.vpn === "openvpn")),
      wireguard: extractChoices(servers.filter((server) => server.vpn === "wireguard"))
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
console.log(`Wrote ${Object.keys(providers).length} provider catalogs to ${outputPath}.`);
