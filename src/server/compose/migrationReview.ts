import YAML from "yaml";
import { validateCompose } from "./generator.js";

const protectedFields = ["container_name", "volumes", "networks", "network_mode", "labels", "user", "secrets", "configs", "devices", "cap_add", "privileged"];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, JSON.parse(canonical(entry))])));
  return JSON.stringify(value ?? null);
}
/** Complete-file, secret-free structural comparison. This never applies a migration. */
export function reviewComposeMigration(currentSource: string, proposedSource: string) {
  const currentCheck = validateCompose(currentSource), proposedCheck = validateCompose(proposedSource);
  if (!currentCheck.valid || !proposedCheck.valid) return { status: "INVALID_INPUT", appliesChanges: false, requiresOwnerReview: true, changes: [], warnings: ["Both inputs must be valid complete Compose files. Fix syntax, structure and references before migration review."] };
  const current = YAML.parse(currentSource), proposed = YAML.parse(proposedSource);
  const changes: Array<{ service: string | null; field: string; protected: boolean }> = [];
  for (const field of ["name", "volumes", "networks", "secrets", "configs"]) if (canonical(current[field]) !== canonical(proposed[field])) changes.push({ service: null, field, protected: true });
  for (const service of new Set([...Object.keys(current.services), ...Object.keys(proposed.services)])) {
    const before = current.services[service], after = proposed.services[service];
    if (!before || !after) { changes.push({ service, field: before ? "service_removed" : "service_added", protected: true }); continue; }
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) if (canonical(before[field]) !== canonical(after[field])) changes.push({ service, field, protected: protectedFields.includes(field) });
  }
  return { status: changes.some(change => change.protected) ? "PROTECTED_SETTINGS_CHANGED" : "READY_FOR_OWNER_REVIEW", appliesChanges: false, requiresOwnerReview: true, changes,
    warnings: [...new Set([...currentCheck.warnings, ...proposedCheck.warnings, "Environment values, host paths, file contents and credentials are omitted from this report. Review the exact diff locally without sharing secret-bearing output.", "No host files, permissions, live identities, backups or data compatibility were verified. Preserve complete deployment files and matching data/key backups before any migration."])] };
}
