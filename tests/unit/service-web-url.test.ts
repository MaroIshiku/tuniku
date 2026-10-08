import { expect, it } from "vitest";
import { canOpenServiceDirectly, serviceWebUrl } from "../../src/client/lib/serviceWebUrl.js";

it("formats reviewed IPv6 HTTP and HTTPS URLs and rejects credentials, paths and invalid ports", () => {
  expect(serviceWebUrl("2001:db8::1", 8080, "http")).toBe("http://[2001:db8::1]:8080/");
  expect(serviceWebUrl("[2001:db8::1]", 8443, "https")).toBe("https://[2001:db8::1]:8443/");
  for (const host of ["", "user@host", "http://host", "host/path", "host?x", "host#x", "host:80", "bad address", "host\\path"]) expect(() => serviceWebUrl(host, 8080, "http")).toThrow();
  for (const port of [0, 65536, 1.5, NaN]) expect(() => serviceWebUrl("host", port, "http")).toThrow();
});

it("blocks same-hostname links across ports and protocols because cookies are not scoped to a port", () => {
  for (const url of ["http://nas.example:8080/", "https://NAS.EXAMPLE:8443/", "http://nas.example.:8080/"]) expect(canOpenServiceDirectly(url, "http://nas.example:3000")).toBe(false);
  expect(canOpenServiceDirectly("http://[::1]:8080/", "http://[0:0:0:0:0:0:0:1]:3000/")).toBe(false);
  expect(canOpenServiceDirectly("http://127.1:8080/", "http://127.0.0.1:3000/")).toBe(false);
  expect(canOpenServiceDirectly("http://service.example:8080/", "http://nas.example:3000/")).toBe(true);
  expect(canOpenServiceDirectly("http://user@service.example:8080/", "http://nas.example:3000/")).toBe(false);
});
