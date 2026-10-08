export interface DockerLogOptions { tail?: number | undefined; since?: number | undefined; until?: number | undefined }
export function logQuery(options: DockerLogOptions = {}, now = Math.floor(Date.now() / 1000)): string {
  const tail = options.tail ?? 200;
  if (!Number.isInteger(tail) || tail < 1 || tail > 1000) throw new Error("Log line limit must be between 1 and 1000.");
  for (const value of [options.since, options.until]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > now)) throw new Error("Log timestamps must be valid past Unix seconds.");
  if (options.since !== undefined && options.until !== undefined && options.until < options.since) throw new Error("The log end time must follow its start time.");
  const query = new URLSearchParams({ stdout: "1", stderr: "1", tail: String(tail), timestamps: "1" });
  if (options.since !== undefined) query.set("since", String(options.since));
  if (options.until !== undefined) query.set("until", String(options.until));
  return query.toString();
}
