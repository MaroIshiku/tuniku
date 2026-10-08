import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverUpstreams } from "../src/server/maintenance/upstreamDiscovery.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const reviews = JSON.parse(fs.readFileSync(path.join(root, "src/server/compose/providerSchemaReview.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "src/server/compose/server-catalog.json"), "utf8"));
const override = JSON.parse(fs.readFileSync(path.join(root, ".ishiku/overrides/gluetun-latest.json"), "utf8"));
const report = await discoverUpstreams({ reviews: reviews.providers, bundledCommit: catalog.source.commit, exceptionReviewDate: override.review_date });
const directory = path.join(root, ".ishiku/reports"); fs.mkdirSync(directory, { recursive: true });
const destination = path.join(directory, "tuniku-upstream-discovery.json");
fs.writeFileSync(`${destination}.tmp`, JSON.stringify(report, null, 2) + "\n"); fs.renameSync(`${destination}.tmp`, destination);
const summary = `Tuniku upstream discovery: ${report.status}; ${report.sources.filter(source => source.state === "changed").length} changed sources; ${report.unavailable} unavailable. Gluetun latest runtime compatibility: ${report.runtimeCompatibility}. Exception review ${report.exception.reviewDate}: ${report.exception.state}.\n`;
process.stdout.write(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (!report.unavailable && report.exception.state !== "overdue" && process.env.GITHUB_OUTPUT) {
  const latest = report.sources.find(source => source.source === "gluetun-latest" && source.state === "observed");
  const architectures = latest?.detail.architectures as Record<string, string> | undefined;
  if (!architectures || ![architectures.amd64, architectures.arm64].every(value => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value))) throw new Error("No validated candidate architecture outputs.");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `gluetun_amd64_digest=${architectures.amd64}\ngluetun_arm64_digest=${architectures.arm64}\n`);
}
if (report.unavailable || report.exception.state === "overdue") process.exitCode = 1;
