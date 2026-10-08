import { expect, it } from "vitest";
import { matchDockerEndpoint } from "../../src/server/docker/association.js";

const inspected = { ControlServer: { port: 8000 }, NetworkSettings: { Networks: { tuniku: { IPAddress: "172.20.0.3", GlobalIPv6Address: "fd00::3" } } }, HostConfig: { PortBindings: { "8000/tcp": [{ HostIp: "192.168.1.2", HostPort: "65002" }] } } };
it("matches direct IPv4/IPv6 addresses and explicit host bindings by Control Server port", () => {
  expect(matchDockerEndpoint(new URL("http://gluetun:8000"), ["172.20.0.3", "fd00::3"], inspected).state).toBe("matched");
  expect(matchDockerEndpoint(new URL("http://[fd00:0:0:0:0:0:0:3]:8000"), ["fd00:0:0:0:0:0:0:3"], inspected).state).toBe("matched");
  expect(matchDockerEndpoint(new URL("http://nas:65002"), ["192.168.1.2"], inspected).state).toBe("matched");
});
it("never attributes other addresses, ports, proxies, mixed DNS targets or wildcard host mappings", () => {
  for (const [url, addresses] of [["http://gluetun:8001", ["172.20.0.3"]], ["http://other:8000", ["172.20.0.4"]], ["https://gluetun:8000", ["172.20.0.3"]], ["http://gluetun:8000/proxy", ["172.20.0.3"]], ["http://gluetun:8000", ["172.20.0.3", "172.20.0.4"]]] as Array<[string,string[]]>) expect(matchDockerEndpoint(new URL(url), addresses, inspected).state).toBe("unverified");
  expect(matchDockerEndpoint(new URL("http://nas:65002"), ["192.168.1.2"], { ...inspected, HostConfig: { PortBindings: { "8000/tcp": [{ HostIp: "0.0.0.0", HostPort: "65002" }] } } }).state).toBe("unverified");
  expect(matchDockerEndpoint(new URL("http://gluetun:8000"), ["172.20.0.3"], { ...inspected, ControlServer: undefined }).state).toBe("unverified");
});
