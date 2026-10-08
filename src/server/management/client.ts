import { Agent, fetch } from "undici";
import { readBoundedBody } from "../http.js";
import { safeLookup, validateUpstreamUrl } from "../security.js";

export class ManagerClient {
  private readonly agent: Agent;
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly allowLoopback: boolean) { this.agent = new Agent({ connect: { lookup: safeLookup(allowLoopback) } }); }
  async request(action: "status" | "adopt" | "plan" | "apply" | "diagnostics" | "settings" | "export" | "prune" | "recovery-review" | "recovery-complete" | "cleanup-review" | "cleanup", body?: unknown): Promise<any> {
    const base = await validateUpstreamUrl(this.baseUrl, this.allowLoopback);
    const response = await fetch(`${base}/${action}`, { dispatcher: this.agent, method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(30_000) });
    const bytes = await readBoundedBody(response, 1024 * 1024);
    let payload: any;
    try { payload = JSON.parse(bytes.toString()); } catch { throw new Error("The managed helper returned an invalid response."); }
    if (!response.ok) throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "The managed helper could not complete the operation.");
    return payload;
  }
  async close(): Promise<void> { await this.agent.close(); }
}
