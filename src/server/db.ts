import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type { CapabilityMap, InstanceRecord, LocalPortLabel, SessionUser, TrafficCounterSnapshot, TrafficSummary } from "./types.js";

function now(): string {
  return new Date().toISOString();
}

function localDay(value = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapInstance(row: any): InstanceRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    baseUrl: row.base_url,
    authMode: row.auth_mode,
    tlsVerify: row.tls_verify === 1,
    requestTimeoutSeconds: row.request_timeout_seconds,
    hasStoredCredential: Boolean(row.has_stored_credential),
    capabilityCache: row.capability_cache_json ? JSON.parse(row.capability_cache_json) as CapabilityMap : null,
    lastConnectedAt: row.last_connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapPort(row: any): LocalPortLabel {
  return {
    id: row.id,
    instanceId: row.instance_id,
    label: row.label,
    hostAddress: row.host_address,
    hostPort: row.host_port,
    containerPort: row.container_port,
    protocol: row.protocol,
    sourceType: "manual",
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class TunikuDatabase {
  readonly raw: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.raw = new Database(databasePath);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const version = this.raw.pragma("user_version", { simple: true }) as number;
    if (version < 1) {
      this.raw.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          email TEXT,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role = 'admin'),
          created_at TEXT NOT NULL,
          last_login_at TEXT
        );
        CREATE TABLE sessions (
          id_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrf_token TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE gluetun_instances (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          auth_mode TEXT NOT NULL CHECK (auth_mode IN ('none', 'api_key', 'basic')),
          tls_verify INTEGER NOT NULL DEFAULT 1,
          request_timeout_seconds INTEGER NOT NULL DEFAULT 15,
          capability_cache_json TEXT,
          last_connected_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE stored_secrets (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL REFERENCES gluetun_instances(id) ON DELETE CASCADE,
          secret_type TEXT NOT NULL,
          encrypted_payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(instance_id, secret_type)
        );
        CREATE TABLE local_port_labels (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL REFERENCES gluetun_instances(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          host_address TEXT,
          host_port INTEGER,
          container_port INTEGER NOT NULL,
          protocol TEXT NOT NULL CHECK (protocol IN ('tcp', 'udp')),
          source_type TEXT NOT NULL DEFAULT 'manual',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE compose_drafts (
          id TEXT PRIMARY KEY,
          instance_id TEXT REFERENCES gluetun_instances(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          task_type TEXT NOT NULL,
          non_secret_input_json TEXT NOT NULL,
          generated_output_redacted TEXT NOT NULL,
          contains_secret_values INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          instance_id TEXT REFERENCES gluetun_instances(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          result TEXT NOT NULL,
          redacted_metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX audit_created_idx ON audit_events(created_at DESC);
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      this.raw.exec(`
        ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
        ALTER TABLE sessions ADD COLUMN reauthenticated_at TEXT;
        UPDATE sessions
        SET last_seen_at = created_at,
            reauthenticated_at = created_at;
        PRAGMA user_version = 2;
      `);
    }
    if (version < 3) {
      this.raw.exec(`
        ALTER TABLE audit_events ADD COLUMN request_id TEXT;
        UPDATE audit_events SET request_id = 'legacy' WHERE request_id IS NULL;
        PRAGMA user_version = 3;
      `);
    }
    if (version < 4) {
      this.raw.exec(`
        CREATE TABLE traffic_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          container_id TEXT NOT NULL,
          received_bytes INTEGER NOT NULL CHECK (received_bytes >= 0),
          sent_bytes INTEGER NOT NULL CHECK (sent_bytes >= 0),
          observed_at TEXT NOT NULL,
          download_bytes_per_second REAL NOT NULL DEFAULT 0,
          upload_bytes_per_second REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE traffic_daily (
          day TEXT PRIMARY KEY,
          downloaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK (downloaded_bytes >= 0),
          uploaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK (uploaded_bytes >= 0)
        );
        PRAGMA user_version = 4;
      `);
    }
  }

  close(): void {
    this.raw.close();
  }

  isReady(): boolean {
    return (this.raw.prepare("SELECT 1 AS ready").get() as { ready: number }).ready === 1;
  }

  adminCount(): number {
    return (this.raw.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin'").get() as { count: number }).count;
  }

  createFirstAdmin(input: {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    passwordHash: string;
  }): SessionUser {
    const transaction = this.raw.transaction(() => {
      if (this.adminCount() > 0) throw new Error("Setup is already complete.");
      this.raw.prepare(
        "INSERT INTO users (id,username,display_name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,'admin',?)"
      ).run(input.id, input.username, input.displayName, input.email, input.passwordHash, now());
    });
    transaction();
    return { id: input.id, username: input.username, displayName: input.displayName, email: input.email, role: "admin" };
  }

  findUserByUsername(username: string): (SessionUser & { passwordHash: string }) | null {
    const row = this.raw.prepare(
      "SELECT id,username,display_name,email,role,password_hash FROM users WHERE username=? COLLATE NOCASE"
    ).get(username) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      role: "admin",
      passwordHash: row.password_hash
    };
  }

  touchLogin(userId: string): void {
    this.raw.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(now(), userId);
  }

  createSession(idHash: string, userId: string, csrfToken: string, expiresAt: string): void {
    const timestamp = now();
    this.raw.prepare(
      `INSERT INTO sessions
       (id_hash,user_id,csrf_token,expires_at,created_at,last_seen_at,reauthenticated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(idHash, userId, csrfToken, expiresAt, timestamp, timestamp, timestamp);
  }

  getSession(idHash: string, idleCutoff: string): {
    user: SessionUser;
    csrfToken: string;
    expiresAt: string;
    createdAt: string;
    lastSeenAt: string;
    reauthenticatedAt: string;
  } | null {
    const row = this.raw.prepare(`
      SELECT s.csrf_token,s.expires_at,s.created_at,s.last_seen_at,s.reauthenticated_at,
             u.id,u.username,u.display_name,u.email,u.role
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id_hash=? AND s.expires_at>? AND s.last_seen_at>?
    `).get(idHash, now(), idleCutoff) as any;
    if (!row) return null;
    return {
      user: { id: row.id, username: row.username, displayName: row.display_name, email: row.email, role: "admin" },
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      reauthenticatedAt: row.reauthenticated_at
    };
  }

  touchSession(idHash: string): void {
    this.raw.prepare("UPDATE sessions SET last_seen_at=? WHERE id_hash=?").run(now(), idHash);
  }

  markSessionReauthenticated(idHash: string): string {
    const timestamp = now();
    this.raw.prepare("UPDATE sessions SET reauthenticated_at=?,last_seen_at=? WHERE id_hash=?")
      .run(timestamp, timestamp, idHash);
    return timestamp;
  }

  sessionSummary(userId: string, currentIdHash: string): {
    current: { createdAt: string; lastSeenAt: string; expiresAt: string; reauthenticatedAt: string };
    otherCount: number;
  } | null {
    const current = this.raw.prepare(`
      SELECT created_at AS createdAt,last_seen_at AS lastSeenAt,expires_at AS expiresAt,
             reauthenticated_at AS reauthenticatedAt
      FROM sessions WHERE id_hash=? AND user_id=?
    `).get(currentIdHash, userId) as any;
    if (!current) return null;
    const otherCount = (this.raw.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND id_hash<>?"
    ).get(userId, currentIdHash) as { count: number }).count;
    return { current, otherCount };
  }

  deleteOtherSessions(userId: string, currentIdHash: string): number {
    return this.raw.prepare("DELETE FROM sessions WHERE user_id=? AND id_hash<>?")
      .run(userId, currentIdHash).changes;
  }

  deleteSession(idHash: string): void {
    this.raw.prepare("DELETE FROM sessions WHERE id_hash=?").run(idHash);
  }

  pruneSessions(idleCutoff = new Date(Date.now() - 30 * 60_000).toISOString()): void {
    this.raw.prepare("DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<=?").run(now(), idleCutoff);
  }

  listInstances(): InstanceRecord[] {
    return (this.raw.prepare(`
      SELECT i.*, EXISTS(
        SELECT 1 FROM stored_secrets s WHERE s.instance_id=i.id AND s.secret_type='gluetun_credential'
      ) AS has_stored_credential
      FROM gluetun_instances i ORDER BY i.created_at LIMIT 1
    `).all() as any[]).map(mapInstance);
  }

  getInstance(id: string): InstanceRecord | null {
    const row = this.raw.prepare(`
      SELECT i.*, EXISTS(
        SELECT 1 FROM stored_secrets s WHERE s.instance_id=i.id AND s.secret_type='gluetun_credential'
      ) AS has_stored_credential
      FROM gluetun_instances i WHERE i.id=?
    `).get(id);
    return row ? mapInstance(row) : null;
  }

  upsertInstance(input: {
    id: string;
    displayName: string;
    baseUrl: string;
    authMode: string;
    tlsVerify: boolean;
    requestTimeoutSeconds: number;
    encryptedCredential?: string | null;
  }): InstanceRecord {
    const existing = this.getInstance(input.id);
    const timestamp = now();
    if (existing) {
      this.raw.prepare(`
        UPDATE gluetun_instances
        SET display_name=?,base_url=?,auth_mode=?,tls_verify=?,request_timeout_seconds=?,updated_at=?
        WHERE id=?
      `).run(input.displayName, input.baseUrl, input.authMode, Number(input.tlsVerify), input.requestTimeoutSeconds, timestamp, input.id);
    } else {
      this.raw.prepare(`
        INSERT INTO gluetun_instances
        (id,display_name,base_url,auth_mode,tls_verify,request_timeout_seconds,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(input.id, input.displayName, input.baseUrl, input.authMode, Number(input.tlsVerify), input.requestTimeoutSeconds, timestamp, timestamp);
    }
    if (input.encryptedCredential === null) {
      this.clearCredential(input.id);
    } else if (input.encryptedCredential !== undefined) {
      this.raw.prepare(`
        INSERT INTO stored_secrets (id,instance_id,secret_type,encrypted_payload,created_at,updated_at)
        VALUES (?,?,'gluetun_credential',?,?,?)
        ON CONFLICT(instance_id,secret_type)
        DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at
      `).run(crypto.randomUUID(), input.id, input.encryptedCredential, timestamp, timestamp);
    }
    return this.getInstance(input.id)!;
  }

  storedCredential(id: string): string | null {
    const row = this.raw.prepare(
      "SELECT encrypted_payload FROM stored_secrets WHERE instance_id=? AND secret_type='gluetun_credential'"
    ).get(id) as any;
    return row?.encrypted_payload ?? null;
  }

  clearCredential(id: string): void {
    this.raw.prepare("DELETE FROM stored_secrets WHERE instance_id=? AND secret_type='gluetun_credential'").run(id);
  }

  updateCapabilities(id: string, capabilities: CapabilityMap): void {
    this.raw.prepare(
      "UPDATE gluetun_instances SET capability_cache_json=?,last_connected_at=?,updated_at=? WHERE id=?"
    ).run(JSON.stringify(capabilities), now(), now(), id);
  }

  recordTraffic(input: TrafficCounterSnapshot): TrafficSummary {
    if (
      !input.containerId ||
      !Number.isSafeInteger(input.receivedBytes) || input.receivedBytes < 0 ||
      !Number.isSafeInteger(input.sentBytes) || input.sentBytes < 0 ||
      !Number.isFinite(Date.parse(input.observedAt))
    ) throw new Error("Invalid Docker traffic counters.");
    const previous = this.raw.prepare("SELECT * FROM traffic_state WHERE singleton=1").get() as any;
    const elapsedSeconds = previous ? (Date.parse(input.observedAt) - Date.parse(previous.observed_at)) / 1000 : 0;
    const comparable = previous && previous.container_id === input.containerId && elapsedSeconds > 0;
    const downloadedDelta = comparable && input.receivedBytes >= previous.received_bytes
      ? input.receivedBytes - previous.received_bytes
      : 0;
    const uploadedDelta = comparable && input.sentBytes >= previous.sent_bytes
      ? input.sentBytes - previous.sent_bytes
      : 0;
    const downloadRate = elapsedSeconds > 0 ? downloadedDelta / elapsedSeconds : 0;
    const uploadRate = elapsedSeconds > 0 ? uploadedDelta / elapsedSeconds : 0;
    const day = localDay(new Date(input.observedAt));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    this.raw.transaction(() => {
      this.raw.prepare(`
        INSERT INTO traffic_state
          (singleton,container_id,received_bytes,sent_bytes,observed_at,download_bytes_per_second,upload_bytes_per_second)
        VALUES (1,?,?,?,?,?,?)
        ON CONFLICT(singleton) DO UPDATE SET
          container_id=excluded.container_id,
          received_bytes=excluded.received_bytes,
          sent_bytes=excluded.sent_bytes,
          observed_at=excluded.observed_at,
          download_bytes_per_second=excluded.download_bytes_per_second,
          upload_bytes_per_second=excluded.upload_bytes_per_second
      `).run(input.containerId, input.receivedBytes, input.sentBytes, input.observedAt, downloadRate, uploadRate);
      this.raw.prepare(`
        INSERT INTO traffic_daily (day,downloaded_bytes,uploaded_bytes) VALUES (?,?,?)
        ON CONFLICT(day) DO UPDATE SET
          downloaded_bytes=traffic_daily.downloaded_bytes+excluded.downloaded_bytes,
          uploaded_bytes=traffic_daily.uploaded_bytes+excluded.uploaded_bytes
      `).run(day, downloadedDelta, uploadedDelta);
      this.raw.prepare("DELETE FROM traffic_daily WHERE day<?").run(localDay(cutoff));
    })();
    return this.trafficSummary();
  }

  trafficSummary(): TrafficSummary {
    const state = this.raw.prepare("SELECT * FROM traffic_state WHERE singleton=1").get() as any;
    const today = this.raw.prepare("SELECT downloaded_bytes,uploaded_bytes FROM traffic_daily WHERE day=?")
      .get(localDay()) as any;
    const total = this.raw.prepare(`
      SELECT COALESCE(SUM(downloaded_bytes),0) AS downloaded_bytes,
             COALESCE(SUM(uploaded_bytes),0) AS uploaded_bytes
      FROM traffic_daily
    `).get() as any;
    return {
      available: Boolean(state),
      source: "docker_stats",
      observedAt: state?.observed_at ?? null,
      downloadBytesPerSecond: Number(state?.download_bytes_per_second) || 0,
      uploadBytesPerSecond: Number(state?.upload_bytes_per_second) || 0,
      sessionDownloadedBytes: Number(state?.received_bytes) || 0,
      sessionUploadedBytes: Number(state?.sent_bytes) || 0,
      todayDownloadedBytes: Number(today?.downloaded_bytes) || 0,
      todayUploadedBytes: Number(today?.uploaded_bytes) || 0,
      trackedDownloadedBytes: Number(total?.downloaded_bytes) || 0,
      trackedUploadedBytes: Number(total?.uploaded_bytes) || 0
    };
  }

  listPorts(instanceId: string): LocalPortLabel[] {
    return (this.raw.prepare(
      "SELECT * FROM local_port_labels WHERE instance_id=? ORDER BY COALESCE(host_port,container_port),label"
    ).all(instanceId) as any[]).map(mapPort);
  }

  savePort(input: Omit<LocalPortLabel, "createdAt" | "updatedAt" | "sourceType">): LocalPortLabel {
    const timestamp = now();
    const existing = this.raw.prepare("SELECT id FROM local_port_labels WHERE id=?").get(input.id);
    if (existing) {
      this.raw.prepare(`
        UPDATE local_port_labels SET label=?,host_address=?,host_port=?,container_port=?,protocol=?,notes=?,updated_at=?
        WHERE id=? AND instance_id=?
      `).run(input.label, input.hostAddress, input.hostPort, input.containerPort, input.protocol, input.notes, timestamp, input.id, input.instanceId);
    } else {
      this.raw.prepare(`
        INSERT INTO local_port_labels
        (id,instance_id,label,host_address,host_port,container_port,protocol,source_type,notes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'manual',?,?,?)
      `).run(input.id, input.instanceId, input.label, input.hostAddress, input.hostPort, input.containerPort, input.protocol, input.notes, timestamp, timestamp);
    }
    return mapPort(this.raw.prepare("SELECT * FROM local_port_labels WHERE id=?").get(input.id));
  }

  deletePort(id: string, instanceId: string): boolean {
    return this.raw.prepare("DELETE FROM local_port_labels WHERE id=? AND instance_id=?").run(id, instanceId).changes > 0;
  }

  saveDraft(input: {
    id: string;
    instanceId: string | null;
    title: string;
    taskType: string;
    nonSecretInput: unknown;
    redactedOutput: string;
    containsSecretValues: boolean;
  }): void {
    const timestamp = now();
    this.raw.prepare(`
      INSERT INTO compose_drafts
      (id,instance_id,title,task_type,non_secret_input_json,generated_output_redacted,contains_secret_values,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      input.id,
      input.instanceId,
      input.title,
      input.taskType,
      JSON.stringify(input.nonSecretInput),
      input.redactedOutput,
      Number(input.containsSecretValues),
      timestamp,
      timestamp
    );
  }

  listDrafts(): unknown[] {
    return this.raw.prepare(`
      SELECT id,instance_id AS instanceId,title,task_type AS taskType,non_secret_input_json AS input,
             generated_output_redacted AS output,contains_secret_values AS containsSecretValues,
             created_at AS createdAt,updated_at AS updatedAt
      FROM compose_drafts ORDER BY updated_at DESC
    `).all().map((row: any) => ({
      ...row,
      input: JSON.parse(row.input),
      containsSecretValues: Boolean(row.containsSecretValues)
    }));
  }

  deleteDraft(id: string): boolean {
    return this.raw.prepare("DELETE FROM compose_drafts WHERE id=?").run(id).changes > 0;
  }

  clearDrafts(): number {
    return this.raw.prepare("DELETE FROM compose_drafts").run().changes;
  }

  audit(input: { id: string; requestId: string; userId: string | null; instanceId: string | null; type: string; result: string; metadata: unknown }): void {
    this.raw.prepare(`
      INSERT INTO audit_events
      (id,request_id,user_id,instance_id,event_type,result,redacted_metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(input.id, input.requestId, input.userId, input.instanceId, input.type, input.result, JSON.stringify(input.metadata), now());
  }

  recentAudit(limit = 20): unknown[] {
    return this.raw.prepare(`
      SELECT request_id AS requestId,event_type AS eventType,result,
             redacted_metadata_json AS metadata,created_at AS createdAt
      FROM audit_events ORDER BY created_at DESC LIMIT ?
    `).all(limit).map((row: any) => ({ ...row, metadata: JSON.parse(row.metadata) }));
  }
}
