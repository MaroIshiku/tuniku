import YAML from "yaml";
import { validateCompose } from "../compose/generator.js";
import { reviewComposeMigration } from "../compose/migrationReview.js";
import { redactValue } from "../security.js";
import { containerEnvironment, settingsFromEnvironment, settingsFields } from "./settings.js";
import type { ManagedContainer } from "./engine.js";

/** Complete-file export only. Never writes a deployment file or returns stored credentials. */
export function exportManagedCompose(source: string, containers: ManagedContainer[]) {
  if (!validateCompose(source).valid) throw new Error("Supply a valid complete original Compose file.");
  const document = YAML.parse(source) as Record<string, any>;
  const original = structuredClone(document);
  const assignments: string[] = [];
  const mappings = containers.map(container => {
    const service = container.Config.Labels?.["com.docker.compose.service"];
    const matches = Object.keys(document.services).filter(name => service ? name === service : document.services[name].container_name === container.Name.replace(/^\//, ""));
    if (matches.length !== 1) throw new Error("Each adopted container must match one original service by Compose service label or explicit container name.");
    return matches[0]!;
  });
  if (new Set(mappings).size !== containers.length) throw new Error("Compose service identities are ambiguous.");
  for (const [index, container] of containers.entries()) {
    const service = document.services[mappings[index]!]!;
    // Preserve the entire original document, including storage and extension fields.
    const env = containerEnvironment(container);
    const publicSettings = settingsFromEnvironment(env, true);
    const safeKeys = new Set(Object.keys(publicSettings).filter(field => field in settingsFields).map(field => settingsFields[field]!));
    for (const key of Object.keys(publicSettings.providerOptions ?? {})) safeKeys.add(key);
    service.environment = Object.fromEntries(Object.entries(env).map(([key, value]) => {
      if (safeKeys.has(key)) return [key, value.replaceAll("$", "$$")];
      const variable = `TUNIKU_RUNTIME_${index}_${key}`;
      assignments.push(variable);
      return [key, `\${${variable}:?Supply the exact runtime value locally}`];
    }));
    if (index === 0) {
      service.ports = Object.entries(container.HostConfig.PortBindings ?? {}).flatMap(([target, bindings]) => (bindings as any[]).map(binding => ({ target: Number(target.split("/")[0]), published: String(binding.HostPort), protocol: target.split("/")[1], ...(binding.HostIp ? { host_ip: binding.HostIp } : {}) })));
      service.labels = Array.isArray(service.labels) ? [...service.labels.filter((label: string) => !label.startsWith("com.ishiku.tuniku.role=")), "com.ishiku.tuniku.role=gluetun"] : { ...(service.labels ?? {}), "com.ishiku.tuniku.role": "gluetun" };
    }
  }
  const proposed = YAML.stringify(document);
  if (!validateCompose(proposed).valid) throw new Error("The preserved Compose document needs manual review before export.");
  const review = reviewComposeMigration(YAML.stringify(original), proposed);
  return { document: redactValue(document), changes: review.changes, requiredLocalVariables: assignments, imageIdentities: containers.map((container, index) => ({ service: mappings[index], imageId: container.Image })), deploymentReady: false,
    warnings: ["This is a review document. Redacted credentials and runtime variables must be supplied locally; external env_file values may conflict and need review.", "Original image references, volumes, networks, labels, commands and extension fields are retained. Verify that image references resolve to the recorded runtime image IDs.", "Tuniku owns confirmed Docker changes; the owner maintains Host Compose/Env files. Do not run an external update before reconciling this complete document, backing up data and keys, and checking drift again. No host file is read or written."] };
}
