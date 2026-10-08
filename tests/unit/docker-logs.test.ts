import { expect, it } from "vitest";
import { logQuery } from "../../src/server/docker/logOptions.js";

it("emits only bounded fixed Docker log options and the requested time range", () => {
  expect(logQuery()).toBe("stdout=1&stderr=1&tail=200&timestamps=1");
  expect(logQuery({ tail: 1000, since: 100, until: 200 }, 300)).toBe("stdout=1&stderr=1&tail=1000&timestamps=1&since=100&until=200");
});
it("rejects unbounded lines, malformed/future timestamps and reversed intervals", () => {
  for (const options of [{ tail: 0 }, { tail: 1001 }, { tail: Infinity }, { since: -1 }, { since: 301 }, { since: 1.5 }, { since: 200, until: 100 }, { until: NaN }]) expect(() => logQuery(options, 300)).toThrow();
});
