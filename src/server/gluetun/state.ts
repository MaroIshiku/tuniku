import type { TunikuDatabase } from "../db.js";
import type { AppConfig } from "../config.js";
import type { InstanceRecord, OverviewSnapshot, TrafficSummary, UpstreamCredential } from "../types.js";
import { decryptCredential } from "../security.js";
import { GluetunAdapter } from "./adapter.js";
import { DockerObserver } from "../docker/observer.js";

export class GluetunStateService {
  private readonly cache = new Map<string, OverviewSnapshot>();
  private readonly ephemeralCredentials = new Map<string, UpstreamCredential>();
  private timer: NodeJS.Timeout | null = null;
  private trafficTimer: NodeJS.Timeout | null = null;
  private trafficPolling = false;
  private trafficIdentity: string | null = null;
  private trafficError: string | null = null;
  private readonly pending = new Map<string, Promise<OverviewSnapshot>>();
  private readonly generations = new Map<string, number>();
  private trafficPending: Promise<void> | null = null;

  invalidate(instanceId: string): void {
    this.cache.delete(instanceId);
    this.pending.delete(instanceId);
    this.generations.set(instanceId, (this.generations.get(instanceId) ?? 0) + 1);
  }

  constructor(
    private readonly db: TunikuDatabase,
    private readonly appConfig: AppConfig
  ) {
    this.trafficError = appConfig.dockerProxyUrl
      ? "Waiting for the first Docker traffic sample."
      : "Automatic traffic collection is not configured. Deploy the complete current Tuniku Compose to add the internal Docker observer.";
  }

  setEphemeralCredential(instanceId: string, credential: UpstreamCredential | null): void {
    if (credential && Object.keys(credential).length > 0) this.ephemeralCredentials.set(instanceId, credential);
    else this.ephemeralCredentials.delete(instanceId);
  }

  credentialFor(instance: InstanceRecord): UpstreamCredential | null {
    const ephemeral = this.ephemeralCredentials.get(instance.id);
    if (ephemeral) return ephemeral;
    const encrypted = this.db.storedCredential(instance.id);
    if (!encrypted || !this.appConfig.encryptionKey) return null;
    try {
      return decryptCredential(encrypted, this.appConfig.encryptionKey);
    } catch {
      return null;
    }
  }

  accessState(instance: InstanceRecord): "not_required" | "memory_only" | "stored_readable" | "stored_unreadable" | "required" {
    if (instance.authMode === "none") return "not_required";
    if (this.ephemeralCredentials.has(instance.id)) return "memory_only";
    const encrypted = this.db.storedCredential(instance.id);
    if (!encrypted) return "required";
    try {
      decryptCredential(encrypted, this.appConfig.encryptionKey);
      return "stored_readable";
    } catch { return "stored_unreadable"; }
  }

  adapterFor(instance: InstanceRecord): GluetunAdapter {
    return new GluetunAdapter(instance, this.credentialFor(instance), this.appConfig.allowLoopbackUpstream);
  }

  async refresh(instance: InstanceRecord): Promise<OverviewSnapshot> {
    const pending = this.pending.get(instance.id);
    if (pending) return pending;
    const generation = this.generations.get(instance.id) ?? 0;
    const work = this.fetchSnapshot(instance, generation);
    this.pending.set(instance.id, work);
    try { return await work; }
    finally { if (this.pending.get(instance.id) === work) this.pending.delete(instance.id); }
  }

  private async fetchSnapshot(instance: InstanceRecord, generation: number): Promise<OverviewSnapshot> {
    const adapter = this.adapterFor(instance);
    try {
      const snapshot = await adapter.overview(this.cache.get(instance.id) ?? null);
      if (generation === (this.generations.get(instance.id) ?? 0)) {
        this.cache.set(instance.id, snapshot);
        if (snapshot.connected) this.db.updateCapabilities(instance.id, snapshot.capabilities);
      }
      return snapshot;
    } finally {
      adapter.close();
    }
  }

  current(instanceId: string): OverviewSnapshot | null {
    const snapshot = this.cache.get(instanceId);
    if (!snapshot) return null;
    const stale = Date.now() - new Date(snapshot.lastUpdatedAt).getTime() > 45_000;
    return { ...snapshot, stale: snapshot.stale || stale };
  }

  trafficSummary(): TrafficSummary {
    const summary = this.db.trafficSummary();
    const instance = this.db.listInstances()[0];
    const associated = instance && this.trafficIdentity === `${instance.id}:${instance.baseUrl}`;
    const stale = !summary.observedAt || Date.now() - Date.parse(summary.observedAt) > 45_000;
    const sampleError = summary.sampleQuality === "gap" ? "A sampling gap was detected. Totals include the observed delta, but no live rate is estimated across the gap." : summary.sampleQuality === "reset" ? "Network counters reset. Waiting for a comparable sample." : summary.sampleQuality !== "continuous" ? "Waiting for two comparable Docker counter samples." : null;
    return { ...summary, available: Boolean(summary.available && associated), downloadBytesPerSecond: stale || this.trafficError || !associated || sampleError ? 0 : summary.downloadBytesPerSecond,
      uploadBytesPerSecond: stale || this.trafficError || !associated || sampleError ? 0 : summary.uploadBytesPerSecond,
      error: this.trafficError || (!associated ? "Traffic is waiting for a verified Control API and Docker association." : stale ? "Waiting for current Docker traffic counters." : sampleError) };
  }

  start(): void {
    if (this.timer) return;
    const poll = async () => {
      const instance = this.db.listInstances()[0];
      if (!instance) return;
      try {
        await this.refresh(instance);
      } catch {
        // The last known state stays available and is marked stale by the API.
      }
    };
    this.timer = setInterval(() => void poll(), 10_000);
    this.timer.unref();
    void poll();
    if (this.appConfig.dockerProxyUrl) {
      const pollTraffic = async () => {
        if (this.trafficPolling || !this.appConfig.dockerProxyUrl) return;
        this.trafficPolling = true;
        const observer = new DockerObserver(this.appConfig.dockerProxyUrl, this.appConfig.allowLoopbackUpstream);
        try {
          const instance = this.db.listInstances()[0];
          if (!instance) throw new Error("Configure a Control API connection before attributing Docker traffic.");
          const snapshot = await observer.observeTraffic(instance.baseUrl);
          if (this.db.getInstance(instance.id)?.baseUrl !== instance.baseUrl) throw new Error("The Control API connection changed during traffic collection.");
          this.db.recordTraffic(snapshot);
          this.trafficIdentity = `${instance.id}:${instance.baseUrl}`;
          this.trafficError = null;
        } catch (error) {
          this.trafficIdentity = null;
          this.trafficError = error instanceof Error ? error.message : "Docker traffic counters are unavailable.";
          // Traffic accounting is optional and never affects Tuniku or Gluetun availability.
        } finally {
          observer.close();
          this.trafficPolling = false;
        }
      };
      const sample = () => { if (!this.trafficPolling) this.trafficPending = pollTraffic(); };
      this.trafficTimer = setInterval(sample, 10_000);
      this.trafficTimer.unref();
      sample();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.trafficTimer) clearInterval(this.trafficTimer);
    this.timer = null;
    this.trafficTimer = null;
    await Promise.allSettled([...this.pending.values(), ...(this.trafficPending ? [this.trafficPending] : [])]);
  }
}
