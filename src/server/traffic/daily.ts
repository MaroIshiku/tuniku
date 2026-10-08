export function trafficDay(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Time-proportional estimates across local midnight; actual intra-interval distribution is unknown. */
export function allocateTrafficDays(start: number, end: number, received: number, sent: number, cutoff: Date): Array<{ day: string; received: number; sent: number }> {
  if (end <= start) return [];
  const duration = end - start;
  const boundary = new Date(cutoff); boundary.setHours(0, 0, 0, 0);
  let cursor = Math.max(start, boundary.getTime());
  const rows: Array<{ day: string; received: number; sent: number }> = [];
  const cumulative = (bytes: number, time: number) => time === end ? bytes : Math.floor(bytes * ((time - start) / duration));
  // The caller restricts future timestamps; cap work even for malformed persisted baselines.
  while (cursor < end && rows.length < 92) {
    const midnight = new Date(cursor); midnight.setHours(24, 0, 0, 0);
    const next = Math.min(end, midnight.getTime());
    rows.push({ day: trafficDay(new Date(cursor)), received: cumulative(received, next) - cumulative(received, cursor), sent: cumulative(sent, next) - cumulative(sent, cursor) });
    cursor = next;
  }
  if (cursor < end) throw new Error("Traffic interval exceeds the bounded retention window.");
  return rows;
}
