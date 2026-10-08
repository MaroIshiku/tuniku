/** Docker interface totals are container/network accounting, not VPN payload usage. */
export function aggregateNetworkCounters(stats: any): { receivedBytes: number; sentBytes: number } {
  const networks = stats?.networks && typeof stats.networks === "object" ? Object.values(stats.networks) : stats?.network && typeof stats.network === "object" ? [stats.network] : [];
  if (!networks.length) throw new Error("No Docker network counters were returned.");
  let receivedBytes = 0, sentBytes = 0;
  for (const network of networks as any[]) {
    if (![network?.rx_bytes, network?.tx_bytes].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error("Docker network counters are missing or invalid.");
    receivedBytes += network.rx_bytes; sentBytes += network.tx_bytes;
    if (!Number.isSafeInteger(receivedBytes) || !Number.isSafeInteger(sentBytes)) throw new Error("Docker network totals exceed the supported counter range.");
  }
  return { receivedBytes, sentBytes };
}
