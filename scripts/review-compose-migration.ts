import fs from "node:fs";
import { reviewComposeMigration } from "../src/server/compose/migrationReview.js";
const files = process.argv.slice(2);
if (files.length !== 2) { process.stderr.write("Usage: node --import tsx scripts/review-compose-migration.ts CURRENT.yml PROPOSED.yml\n"); process.exitCode = 2; }
else {
  try {
    const sources = files.map(file => { const metadata = fs.statSync(file); if (!metadata.isFile() || metadata.size > 1024 * 1024) throw new Error(); return fs.readFileSync(file, "utf8"); });
    const report = reviewComposeMigration(sources[0]!, sources[1]!);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "READY_FOR_OWNER_REVIEW") process.exitCode = 1;
  } catch { process.stderr.write("The selected Compose files could not be reviewed. Use readable files of at most 1 MiB each. No changes were applied.\n"); process.exitCode = 2; }
}
