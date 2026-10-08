/** Validate syntax only. Never open operator host paths or reflect their contents. */
export function validateStorage(name: string, service: Record<string, unknown>, errors: string[], warnings: string[]): void {
  const unsafe = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  const unresolved = (value: string) => /\$(?:\{|[A-Za-z_])/.test(value);
  const fileEntries = service.env_file === undefined ? [] : Array.isArray(service.env_file) ? service.env_file : [service.env_file];
  for (const entry of fileEntries) {
    const file = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as Record<string, unknown>).path : undefined;
    if (typeof file !== "string") continue;
    if (unsafe(file)) errors.push(`Service ${name} env_file contains an invalid path.`);
    if (file.startsWith("~") || /(?:^|\/)\.\.(?:\/|$)/.test(file)) warnings.push(`Service ${name} env_file requires explicit deployment-directory review; home expansion and parent paths are not verified.`);
  }
  if (!Array.isArray(service.volumes)) return;
  const targets = new Set<string>();
  for (const entry of service.volumes) {
    let source: unknown, target: unknown, bind = false;
    if (typeof entry === "string") {
      const parts = entry.split(":");
      if (parts.length > 3) { errors.push(`Service ${name} has an ambiguous short volume mapping; use long form.`); continue; }
      target = parts.length === 1 ? parts[0] : parts[1];
      source = parts.length > 1 ? parts[0] : undefined;
      bind = typeof source === "string" && /^[./~]/.test(source);
    } else if (entry && typeof entry === "object") {
      const mapping = entry as Record<string, unknown>;
      source = mapping.source; target = mapping.target; bind = mapping.type === "bind";
      if (bind && (typeof source !== "string" || !source.trim())) errors.push(`Service ${name} bind mounts require a source path.`);
      if (mapping.read_only !== undefined && typeof mapping.read_only !== "boolean") errors.push(`Service ${name} volume read_only must be a boolean.`);
      if (mapping.bind && typeof mapping.bind === "object") {
        const create = (mapping.bind as Record<string, unknown>).create_host_path;
        if (create !== undefined && typeof create !== "boolean") errors.push(`Service ${name} bind create_host_path must be a boolean.`);
      }
    }
    if (typeof target !== "string" || !target.trim() || unsafe(target)) { errors.push(`Service ${name} volume targets require a valid container path.`); continue; }
    if (unresolved(target)) warnings.push(`Service ${name} has an interpolated volume target; resolve and review it locally.`);
    else {
      if (!target.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(target)) errors.push(`Service ${name} volume targets must be absolute container paths without parent traversal.`);
      const normalized = target.replace(/\/+/g, "/").replace(/\/$/, "");
      if (targets.has(normalized)) errors.push(`Service ${name} has duplicate volume targets; choose one source per container path.`);
      targets.add(normalized);
    }
    if (typeof source === "string" && unsafe(source)) errors.push(`Service ${name} volume source contains an invalid path.`);
    if (bind) warnings.push(`Service ${name} bind paths, existence, symlinks and owner permissions require local review in the deployment directory. Tuniku has not read them; preserve existing application data and use read-only mounts for credential files.`);
    if (typeof source === "string" && (unresolved(source) || source.startsWith("~") || /(?:^|\/)\.\.(?:\/|$)/.test(source))) warnings.push(`Service ${name} volume source needs deployment-time path resolution before applying.`);
  }
}
