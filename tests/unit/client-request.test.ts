import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/client/lib/api.js";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function awaitingAbort(_path: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (init?.signal?.aborted) rejectAbort();
    else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
  });
}
it("bounds network waits and leaves timed-out mutations explicitly uncertain without retry", async () => {
  vi.useFakeTimers(); const fetch = vi.fn(awaitingAbort); vi.stubGlobal("fetch", fetch);
  const result = api.control("synthetic", "vpn/start", { confirmed: true });
  const rejected = expect(result).rejects.toMatchObject({ code: "request_timeout", status: 0, message: expect.stringContaining("Check the current state") });
  await vi.advanceTimersByTimeAsync(45_000); await rejected;
  expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it("honors caller cancellation and already-aborted signals without confusing it with timeout", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", awaitingAbort);
  const controller = new AbortController(); const result = api.overview("synthetic", false, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" }); controller.abort(); await rejected;
  await expect(api.traffic(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});
it("covers slow response bodies and clears timeout state on normal HTTP outcomes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async (path: unknown, init?: RequestInit) => ({ ok: true, json: () => awaitingAbort(path, init) }));
  const result = api.traffic(); const rejected = expect(result).rejects.toBeInstanceOf(ApiError);
  await vi.advanceTimersByTimeAsync(45_000); await rejected; expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Not signed in", code: "unauthorized", requestId: "synthetic-request" } }), { status: 401 }));
  await expect(api.traffic()).rejects.toMatchObject({ status: 401, code: "unauthorized", requestId: "synthetic-request" }); expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ traffic: { available: false } })));
  expect(await api.traffic()).toEqual({ traffic: { available: false } }); expect(vi.getTimerCount()).toBe(0);
});
