export function serviceWebUrl(host: string, port: number, scheme: "http" | "https"): string {
  const plain = host.trim().replace(/^\[|\]$/g, "");
  if (!plain || /[\s/@?#\\]/.test(plain) || !Number.isInteger(port) || port < 1 || port > 65535 || !["http", "https"].includes(scheme)) throw new Error("Enter a hostname or IP without a scheme, path or port, and a valid host port.");
  try {
    const url = new URL(`${scheme}://${plain.includes(":") ? `[${plain}]` : plain}:${port}/`);
    if (url.username || url.password || url.pathname !== "/" || !url.hostname) throw new Error();
    return url.href;
  } catch { throw new Error("Enter a valid hostname or IPv4/IPv6 address without a scheme, path or port."); }
}

export function canOpenServiceDirectly(url: string, tunikuOrigin: string): boolean {
  const target = new URL(url), current = new URL(tunikuOrigin);
  // Host-only cookies span ports. A different port on the same hostname must
  // not receive the Tuniku session through an automatic open action.
  const host = (value: string) => value.toLowerCase().replace(/\.$/, "");
  return ["http:", "https:"].includes(target.protocol) && !target.username && !target.password && host(target.hostname) !== host(current.hostname);
}
