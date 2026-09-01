import type { TunikuDatabase } from "../db.js";
import type { AppConfig } from "../config.js";
import type { InstanceRecord, OverviewSnapshot, UpstreamCredential } from "../types.js";
import { decryptCredential } from "../security.js";
import { GluetunAdapter } from "./adapter.js";
import { DockerObserver } from "../docker/observer.js";

export class GluetunStateService {
  private readonly cache = new Map<string, OverviewSnapshot>();
  private readonly ephemeralCredentials = new Map<string, UpstreamCredential>();
  private timer: NodeJS.Timeout | null = null;
  private trafficTimer: NodeJS.Timeout | null = null;
  private trafficPolling = false;

  constructor(
    private readonly db: TunikuDatabase,
    private readonly appConfig: AppConfig
  ) {}

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

  adapterFor(instance: InstanceRecord): GluetunAdapter {
    return new GluetunAdapter(instance, this.credentialFor(instance), this.appConfig.allowLoopbackUpstream);
  }

  async refresh(instance: InstanceRecord): Promise<OverviewSnapshot> {
    const adapter = this.adapterFor(instance);
    try {
      const snapshot = await adapter.overview(this.cache.get(instance.id) ?? null);
      this.cache.set(instance.id, snapshot);
      if (snapshot.connected) this.db.updateCapabilities(instance.id, snapshot.capabilities);
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
          this.db.recordTraffic(await observer.observeTraffic());
        } catch {
          // Traffic accounting is optional and never affects Tuniku or Gluetun availability.
        } finally {
          observer.close();
          this.trafficPolling = false;
        }
      };
      this.trafficTimer = setInterval(() => void pollTraffic(), 10_000);
      this.trafficTimer.unref();
      void pollTraffic();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.trafficTimer) clearInterval(this.trafficTimer);
    this.timer = null;
    this.trafficTimer = null;
  }
}
