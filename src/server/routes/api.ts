import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { TunikuDatabase } from "../db.js";
import {
  encryptCredential,
  hashPassword,
  randomToken,
  redactText,
  redactValue,
  sha256,
  SlidingWindowRateLimiter,
  validateAdminInput,
  validateUpstreamUrl,
  verifyPassword
} from "../security.js";
import type { SessionUser, UpstreamCredential } from "../types.js";
import { GluetunAdapter, GluetunError, type MutationName } from "../gluetun/adapter.js";
import type { GluetunStateService } from "../gluetun/state.js";
import {
  composeTasks,
  generateCompose,
  inspectCompose,
  redactedDraftInput,
  validateCompose,
  type ComposeGenerationInput
} from "../compose/generator.js";
import { DockerObserver } from "../docker/observer.js";
import { gluetunProviderProfiles } from "../compose/providers.js";

const setupLimiter = new SlidingWindowRateLimiter(8, 15 * 60_000);
const loginNetworkLimiter = new SlidingWindowRateLimiter(20, 15 * 60_000);
const loginAccountLimiter = new SlidingWindowRateLimiter(8, 15 * 60_000);
const connectionLimiter = new SlidingWindowRateLimiter(20, 60_000);
const controlLimiter = new SlidingWindowRateLimiter(20, 60_000);
const generateLimiter = new SlidingWindowRateLimiter(30, 60_000);
const SESSION_COOKIE = "tuniku_session";
const SESSION_ABSOLUTE_MS = 24 * 60 * 60_000;
const SESSION_IDLE_MS = 30 * 60_000;
const RECENT_AUTH_MS = 10 * 60_000;

type Session = {
  user: SessionUser;
  csrfToken: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
  reauthenticatedAt: string;
  idHash: string;
};

function clientKey(request: FastifyRequest, suffix: string): string {
  return `${request.ip}:${suffix}`;
}

function sessionFromRequest(request: FastifyRequest, db: TunikuDatabase): Session | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const idHash = sha256(unsigned.value);
  const idleCutoff = new Date(Date.now() - SESSION_IDLE_MS).toISOString();
  const result = db.getSession(idHash, idleCutoff);
  if (!result) {
    db.deleteSession(idHash);
    return null;
  }
  db.touchSession(idHash);
  return { ...result, lastSeenAt: new Date().toISOString(), idHash };
}

function setSessionCookie(reply: FastifyReply, token: string, appConfig: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: appConfig.secureCookies,
    signed: true,
    maxAge: 60 * 60 * 24
  });
}

function createSession(db: TunikuDatabase, user: SessionUser): { token: string; csrfToken: string } {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS).toISOString();
  db.createSession(sha256(token), user.id, csrfToken, expiresAt);
  return { token, csrfToken };
}

function requireSession(request: FastifyRequest, reply: FastifyReply, db: TunikuDatabase): Session | null {
  const session = sessionFromRequest(request, db);
  if (!session) {
    void reply.code(401).send({ error: { code: "authentication_required", message: "Sign in to continue." } });
    return null;
  }
  return session;
}

function requireCsrf(request: FastifyRequest, reply: FastifyReply, session: Session): boolean {
  const header = request.headers["x-csrf-token"];
  if (typeof header !== "string" || header !== session.csrfToken) {
    void reply.code(403).send({ error: { code: "csrf_invalid", message: "The request security token is invalid." } });
    return false;
  }
  return true;
}

function requireRecentAuthentication(request: FastifyRequest, reply: FastifyReply, session: Session): boolean {
  if (Date.parse(session.reauthenticatedAt) <= Date.now() - RECENT_AUTH_MS) {
    void reply.code(403).send({
      error: {
        code: "recent_authentication_required",
        message: "Confirm your password before changing active sessions."
      }
    });
    return false;
  }
  return true;
}

function credentialFromBody(body: any, authMode: string): UpstreamCredential | null {
  if (authMode === "api_key") return body.apiKey ? { apiKey: body.apiKey } : null;
  if (authMode === "basic") {
    return body.username !== undefined && body.password !== undefined
      ? { username: body.username, password: body.password }
      : null;
  }
  return null;
}

function errorResponse(error: unknown): { status: number; body: unknown } {
  if (error instanceof GluetunError) {
    return { status: error.statusCode, body: { error: { code: `gluetun_${error.code}`, message: error.message } } };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "validation_error",
          message: "The request is invalid.",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
        }
      }
    };
  }
  return {
    status: 400,
    body: { error: { code: "request_failed", message: error instanceof Error ? error.message : "The request failed." } }
  };
}

const instanceSchema = z.object({
  displayName: z.string().trim().min(1).max(80).default("Gluetun"),
  baseUrl: z.string().trim().min(1).max(500),
  authMode: z.enum(["none", "api_key", "basic"]),
  tlsVerify: z.boolean().default(true),
  requestTimeoutSeconds: z.number().int().min(2).max(60).default(15),
  apiKey: z.string().max(4096).optional(),
  username: z.string().max(256).optional(),
  password: z.string().max(4096).optional(),
  saveCredential: z.boolean().default(false)
});

const composeInputSchema = z.object({
  taskType: z.enum(composeTasks),
  provider: z.string().max(80).optional(),
  vpnType: z.enum(["wireguard", "openvpn"]).optional(),
  countries: z.string().max(500).optional(),
  regions: z.string().max(500).optional(),
  cities: z.string().max(500).optional(),
  authMode: z.enum(["none", "api_key", "basic"]).optional(),
  apiKey: z.string().max(4096).optional(),
  basicUsername: z.string().max(256).optional(),
  basicPassword: z.string().max(4096).optional(),
  wireguardPrivateKey: z.string().max(4096).optional(),
  wireguardAddresses: z.string().max(1024).optional(),
  wireguardPresharedKey: z.string().max(4096).optional(),
  wireguardPublicKey: z.string().max(4096).optional(),
  wireguardEndpointIp: z.string().max(64).optional(),
  wireguardEndpointPort: z.number().int().min(1).max(65_535).optional(),
  openvpnUser: z.string().max(4096).optional(),
  openvpnPassword: z.string().max(4096).optional(),
  openvpnCertificate: z.string().max(65_536).optional(),
  openvpnKey: z.string().max(65_536).optional(),
  openvpnEncryptedKey: z.string().max(65_536).optional(),
  openvpnKeyPassphrase: z.string().max(4096).optional(),
  customOpenvpnConfigPath: z.string().max(1024).optional(),
  appName: z.string().max(120).optional(),
  appImage: z.string().max(500).optional(),
  hostAddress: z.string().max(255).optional(),
  hostPort: z.number().int().min(1).max(65_535).optional(),
  containerPort: z.number().int().min(1).max(65_535).optional(),
  protocol: z.enum(["tcp", "udp"]).optional(),
  pastedCompose: z.string().max(1_048_576).optional(),
  includeSecrets: z.boolean().optional()
}).strict();

export function registerApiRoutes(
  app: FastifyInstance,
  dependencies: {
    db: TunikuDatabase;
    appConfig: AppConfig;
    state: GluetunStateService;
    startedAt: string;
  }
): void {
  const { db, appConfig, state, startedAt } = dependencies;
  const audit = (
    request: FastifyRequest,
    input: Omit<Parameters<TunikuDatabase["audit"]>[0], "id" | "requestId">
  ): void => db.audit({ id: crypto.randomUUID(), requestId: request.id, ...input });

  app.get("/api/v1/bootstrap", async (request) => {
    const adminExists = db.adminCount() > 0;
    const missingConfiguration = [
      ...(!appConfig.registrationSecret && !adminExists ? ["ISHIKU_SETUP_SECRET"] : [])
    ];
    const session = sessionFromRequest(request, db);
    return {
      setup: {
        state: missingConfiguration.length ? "unconfigured" : adminExists ? "completed" : "ready_to_register",
        missingConfiguration
      },
      session: session ? { user: session.user, csrfToken: session.csrfToken } : null,
      app: {
        name: "Tuniku",
        subtitle: "Gluetun Web Interface",
        version: appConfig.build.version
      }
    };
  });

  app.post("/api/v1/auth/register-first-admin", async (request, reply) => {
    try {
      if (!setupLimiter.consume(clientKey(request, "setup"))) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many setup attempts. Try again later." } });
      if (db.adminCount() > 0) return reply.code(409).send({ error: { code: "setup_complete", message: "First-run registration is closed." } });
      if (!appConfig.registrationSecret) {
        return reply.code(503).send({ error: { code: "setup_unconfigured", message: "The setup secret is not configured." } });
      }
      const body = z.object({
        setupSecret: z.string(),
        displayName: z.string(),
        username: z.string(),
        email: z.string().optional().default(""),
        password: z.string(),
        passwordConfirm: z.string()
      }).parse(request.body);
      const errors = validateAdminInput({ ...body, configuredSecret: appConfig.registrationSecret });
      if (errors.length) {
        audit(request, { userId: null, instanceId: null, type: "setup_attempt", result: "rejected", metadata: { reason: errors[0] } });
        return reply.code(400).send({ error: { code: "setup_validation", message: errors[0], details: errors } });
      }
      const user = db.createFirstAdmin({
        id: crypto.randomUUID(),
        username: body.username.trim(),
        displayName: body.displayName.trim(),
        email: body.email.trim() || null,
        passwordHash: await hashPassword(body.password)
      });
      const session = createSession(db, user);
      setSessionCookie(reply, session.token, appConfig);
      setupLimiter.clear(clientKey(request, "setup"));
      audit(request, { userId: user.id, instanceId: null, type: "first_admin_created", result: "success", metadata: {} });
      return { user, csrfToken: session.csrfToken };
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    try {
      const body = z.object({ username: z.string().min(1).max(64), password: z.string().max(4096) }).parse(request.body);
      const accountKey = body.username.trim().toLowerCase();
      if (
        !loginNetworkLimiter.consume(clientKey(request, "login")) ||
        !loginAccountLimiter.consume(accountKey)
      ) {
        return reply.code(429).send({ error: { code: "rate_limited", message: "Too many sign-in attempts. Try again later." } });
      }
      const user = db.findUserByUsername(body.username);
      if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
        audit(request, { userId: user?.id ?? null, instanceId: null, type: "login", result: "rejected", metadata: {} });
        return reply.code(401).send({ error: { code: "invalid_credentials", message: "Username or password is incorrect." } });
      }
      const session = createSession(db, user);
      setSessionCookie(reply, session.token, appConfig);
      db.touchLogin(user.id);
      loginNetworkLimiter.clear(clientKey(request, "login"));
      loginAccountLimiter.clear(accountKey);
      audit(request, { userId: user.id, instanceId: null, type: "login", result: "success", metadata: {} });
      const { passwordHash: _passwordHash, ...publicUser } = user;
      return { user: publicUser, csrfToken: session.csrfToken };
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    db.deleteSession(session.idHash);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    audit(request, { userId: session.user.id, instanceId: null, type: "logout", result: "success", metadata: {} });
    return { ok: true };
  });

  app.get("/api/v1/auth/session", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session) return;
    return { user: session.user, csrfToken: session.csrfToken };
  });

  app.get("/api/v1/auth/sessions", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session) return;
    return { sessions: db.sessionSummary(session.user.id, session.idHash) };
  });

  app.post("/api/v1/auth/reauthenticate", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    const body = z.object({ password: z.string().max(4096) }).parse(request.body);
    const accountKey = `reauth:${session.user.username.toLowerCase()}`;
    if (!loginAccountLimiter.consume(accountKey)) {
      return reply.code(429).send({ error: { code: "rate_limited", message: "Too many password confirmation attempts. Try again later." } });
    }
    const user = db.findUserByUsername(session.user.username);
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      audit(request, { userId: session.user.id, instanceId: null, type: "reauthentication", result: "rejected", metadata: {} });
      return reply.code(401).send({ error: { code: "invalid_credentials", message: "Username or password is incorrect." } });
    }
    loginAccountLimiter.clear(accountKey);
    const reauthenticatedAt = db.markSessionReauthenticated(session.idHash);
    audit(request, { userId: session.user.id, instanceId: null, type: "reauthentication", result: "success", metadata: {} });
    return { ok: true, reauthenticatedAt };
  });

  app.delete("/api/v1/auth/sessions/others", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (
      !session ||
      !requireCsrf(request, reply, session) ||
      !requireRecentAuthentication(request, reply, session)
    ) return;
    const revoked = db.deleteOtherSessions(session.user.id, session.idHash);
    audit(request, {
      userId: session.user.id,
      instanceId: null,
      type: "session_revocation",
      result: "success",
      metadata: { revoked }
    });
    return { revoked };
  });

  app.get("/api/v1/instances", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    return { instances: db.listInstances() };
  });

  app.get("/api/v1/instances/:instanceId", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const id = (request.params as any).instanceId as string;
    const instance = db.getInstance(id);
    return instance ? { instance } : reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
  });

  app.put("/api/v1/instances/:instanceId", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    try {
      const id = z.string().uuid().parse((request.params as any).instanceId);
      const body = instanceSchema.parse(request.body);
      const baseUrl = await validateUpstreamUrl(body.baseUrl, appConfig.allowLoopbackUpstream);
      const credential = credentialFromBody(body, body.authMode);
      const existing = db.getInstance(id);
      let encryptedCredential: string | null | undefined;
      if (body.saveCredential) {
        if (!credential && (!existing?.hasStoredCredential || existing.authMode !== body.authMode)) {
          throw new Error("Enter the selected Gluetun credential before saving it.");
        }
        if (credential) {
          encryptedCredential = encryptCredential(credential, appConfig.encryptionKey);
        }
      }
      const instance = db.upsertInstance({
        id,
        displayName: body.displayName,
        baseUrl,
        authMode: body.authMode,
        tlsVerify: body.tlsVerify,
        requestTimeoutSeconds: body.requestTimeoutSeconds,
        ...(encryptedCredential === undefined ? {} : { encryptedCredential })
      });
      state.setEphemeralCredential(id, body.saveCredential ? null : credential);
      audit(request, {
        userId: session.user.id,
        instanceId: id,
        type: "instance_saved",
        result: "success",
        metadata: { baseUrl: new URL(baseUrl).origin, authMode: body.authMode, credentialPersisted: body.saveCredential }
      });
      return { instance };
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.post("/api/v1/instances/:instanceId/test", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!connectionLimiter.consume(clientKey(request, "connection"))) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many connection tests." } });
    try {
      const id = z.string().uuid().parse((request.params as any).instanceId);
      const body = z.object({
        apiKey: z.string().max(4096).optional(),
        username: z.string().max(256).optional(),
        password: z.string().max(4096).optional()
      }).parse(request.body ?? {});
      const instance = db.getInstance(id);
      if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
      const transient = credentialFromBody(body, instance.authMode);
      const adapter = new GluetunAdapter(instance, transient ?? state.credentialFor(instance), appConfig.allowLoopbackUpstream);
      try {
        const capabilities = await adapter.probe();
        const states = Object.values(capabilities);
        const reachable = states.some((capability) => capability.state !== "unreachable");
        const authenticationAccepted = reachable && !states.some((capability) => capability.state === "unauthorized");
        if (authenticationAccepted) db.updateCapabilities(id, capabilities);
        audit(request, { userId: session.user.id, instanceId: id, type: "connection_test", result: authenticationAccepted ? "success" : "failed", metadata: { capabilities, reachable, authenticationAccepted } });
        return { reachable, authenticationAccepted, capabilities, version: null };
      } finally {
        adapter.close();
      }
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.delete("/api/v1/instances/:instanceId/stored-credential", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    const id = (request.params as any).instanceId as string;
    db.clearCredential(id);
    state.setEphemeralCredential(id, null);
    audit(request, { userId: session.user.id, instanceId: id, type: "credential_deleted", result: "success", metadata: {} });
    return { ok: true };
  });

  app.get("/api/v1/instances/:instanceId/overview", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const id = (request.params as any).instanceId as string;
    const instance = db.getInstance(id);
    if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
    const cached = state.current(id);
    return { overview: cached ?? await state.refresh(instance) };
  });

  app.get("/api/v1/instances/:instanceId/capabilities", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const instance = db.getInstance((request.params as any).instanceId as string);
    if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
    return { capabilities: instance.capabilityCache ?? (await state.refresh(instance)).capabilities };
  });

  const readEndpoints: Array<{ suffix: string; capability: any }> = [
    { suffix: "vpn", capability: "vpn" },
    { suffix: "public-ip", capability: "publicIp" },
    { suffix: "dns", capability: "dns" },
    { suffix: "updater", capability: "updater" },
    { suffix: "port-forwarding", capability: "portForwarding" },
    { suffix: "settings-redacted", capability: "vpnSettings" }
  ];
  for (const endpoint of readEndpoints) {
    app.get(`/api/v1/instances/:instanceId/${endpoint.suffix}`, async (request, reply) => {
      if (!requireSession(request, reply, db)) return;
      const instance = db.getInstance((request.params as any).instanceId as string);
      if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
      const adapter = state.adapterFor(instance);
      try {
        return { value: await adapter.read(endpoint.capability) };
      } catch (error) {
        const response = errorResponse(error);
        return reply.code(response.status).send(response.body);
      } finally {
        adapter.close();
      }
    });
  }

  const mutationEndpoints: Array<{ path: string; operation: MutationName; status?: string; confirmation: boolean }> = [
    { path: "vpn/start", operation: "vpn", status: "running", confirmation: true },
    { path: "vpn/stop", operation: "vpn", status: "stopped", confirmation: true },
    { path: "dns/start", operation: "dns", status: "running", confirmation: true },
    { path: "dns/stop", operation: "dns", status: "stopped", confirmation: true },
    { path: "updater/start", operation: "updater", status: "running", confirmation: false }
  ];
  for (const endpoint of mutationEndpoints) {
    app.post(`/api/v1/instances/:instanceId/${endpoint.path}`, async (request, reply) => {
      const session = requireSession(request, reply, db);
      if (!session || !requireCsrf(request, reply, session)) return;
      if (!controlLimiter.consume(`${session.user.id}:${endpoint.operation}`)) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many control requests." } });
      try {
        const body = z.object({ confirmed: z.boolean().optional().default(false) }).parse(request.body ?? {});
        if (endpoint.confirmation && !body.confirmed) throw new Error("Explicit confirmation is required.");
        const instance = db.getInstance((request.params as any).instanceId as string);
        if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
        const adapter = state.adapterFor(instance);
        try {
          const capabilityName = endpoint.operation === "portForwarding" ? "portForwarding" : endpoint.operation;
          const capabilities = instance.capabilityCache ?? await adapter.probe();
          if (capabilities[capabilityName].state !== "available") throw new GluetunError("unsupported", "The connected Gluetun instance does not expose this capability.", 409);
          const result = await adapter.mutate(endpoint.operation, { status: endpoint.status });
          audit(request, { userId: session.user.id, instanceId: instance.id, type: endpoint.path.replace("/", "_"), result: "success", metadata: { requestedStatus: endpoint.status } });
          const overview = await state.refresh(instance);
          return { result, overview };
        } finally {
          adapter.close();
        }
      } catch (error) {
        audit(request, { userId: session.user.id, instanceId: (request.params as any).instanceId, type: endpoint.path.replace("/", "_"), result: "failed", metadata: { error: error instanceof Error ? error.message : "unknown" } });
        const response = errorResponse(error);
        return reply.code(response.status).send(response.body);
      }
    });
  }

  app.put("/api/v1/instances/:instanceId/port-forwarding", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    try {
      const body = z.object({ ports: z.array(z.number().int().min(1).max(65_535)).max(10), confirmed: z.literal(true) }).parse(request.body);
      const instance = db.getInstance((request.params as any).instanceId as string);
      if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
      const adapter = state.adapterFor(instance);
      try {
        const capabilities = instance.capabilityCache ?? await adapter.probe();
        if (capabilities.portForwarding.state !== "available") throw new GluetunError("unsupported", "Runtime port forwarding is unavailable.", 409);
        const result = await adapter.mutate("portForwarding", { ports: body.ports });
        audit(request, { userId: session.user.id, instanceId: instance.id, type: "port_forwarding_change", result: "success", metadata: { ports: body.ports } });
        return { result, overview: await state.refresh(instance) };
      } finally {
        adapter.close();
      }
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.get("/api/v1/instances/:instanceId/ports", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const instanceId = (request.params as any).instanceId as string;
    return { ports: db.listPorts(instanceId) };
  });

  const portSchema = z.object({
    label: z.string().trim().min(1).max(100),
    hostAddress: z.string().trim().max(100).nullable().optional().default(null),
    hostPort: z.number().int().min(1).max(65_535).nullable().optional().default(null),
    containerPort: z.number().int().min(1).max(65_535),
    protocol: z.enum(["tcp", "udp"]),
    notes: z.string().trim().max(1000).nullable().optional().default(null)
  });

  app.post("/api/v1/instances/:instanceId/port-labels", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    try {
      const instanceId = (request.params as any).instanceId as string;
      const body = portSchema.parse(request.body);
      const collisions = body.hostPort ? db.listPorts(instanceId).filter((port) => port.hostPort === body.hostPort && port.protocol === body.protocol) : [];
      if (collisions.length) throw new Error("A local port label already uses this host port and protocol.");
      const port = db.savePort({ id: crypto.randomUUID(), instanceId, ...body });
      audit(request, { userId: session.user.id, instanceId, type: "port_label_created", result: "success", metadata: { label: port.label, hostPort: port.hostPort, containerPort: port.containerPort, protocol: port.protocol } });
      return reply.code(201).send({ port });
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.put("/api/v1/instances/:instanceId/port-labels/:labelId", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    try {
      const instanceId = (request.params as any).instanceId as string;
      const id = z.string().uuid().parse((request.params as any).labelId);
      const body = portSchema.parse(request.body);
      const collisions = body.hostPort
        ? db.listPorts(instanceId).filter((port) => port.id !== id && port.hostPort === body.hostPort && port.protocol === body.protocol)
        : [];
      if (collisions.length) throw new Error("A local port label already uses this host port and protocol.");
      const port = db.savePort({ id, instanceId, ...body });
      audit(request, { userId: session.user.id, instanceId, type: "port_label_updated", result: "success", metadata: { label: port.label } });
      return { port };
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.delete("/api/v1/instances/:instanceId/port-labels/:labelId", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    const instanceId = (request.params as any).instanceId as string;
    const deleted = db.deletePort((request.params as any).labelId as string, instanceId);
    if (!deleted) return reply.code(404).send({ error: { code: "not_found", message: "Port label not found." } });
    audit(request, { userId: session.user.id, instanceId, type: "port_label_deleted", result: "success", metadata: {} });
    return { ok: true };
  });

  app.post("/api/v1/compose/inspect", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    try {
      const body = z.object({ content: z.string().max(1_048_576) }).parse(request.body);
      return inspectCompose(body.content);
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.get("/api/v1/compose/providers", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    return { providers: gluetunProviderProfiles, gluetunVersion: "v3.41.3" };
  });

  app.post("/api/v1/compose/validate", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const body = z.object({ content: z.string().max(1_048_576) }).parse(request.body);
    return validateCompose(body.content);
  });

  app.post("/api/v1/compose/redact", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const body = z.object({ content: z.string().max(1_048_576) }).parse(request.body);
    return { redacted: redactText(body.content) };
  });

  app.post("/api/v1/compose/generate", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!generateLimiter.consume(`${session.user.id}:compose`)) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many generation requests." } });
    try {
      const body = z.object({
        instanceId: z.string().uuid().nullable().optional(),
        saveDraft: z.boolean().default(false),
        title: z.string().trim().max(120).default("Compose draft"),
        input: composeInputSchema
      }).parse(request.body);
      const taskType = body.input.taskType;
      const input = body.input as ComposeGenerationInput;
      const result = generateCompose(input);
      if (body.saveDraft) {
        const redacted = generateCompose({ ...input, includeSecrets: false });
        db.saveDraft({
          id: crypto.randomUUID(),
          instanceId: body.instanceId ?? null,
          title: body.title,
          taskType,
          nonSecretInput: redactedDraftInput(input),
          redactedOutput: JSON.stringify(redacted),
          containsSecretValues: result.containsSecretValues
        });
      }
      audit(request, { userId: session.user.id, instanceId: body.instanceId ?? null, type: "compose_generated", result: result.validation.valid ? "success" : "warning", metadata: { taskType, containsSecretValues: result.containsSecretValues } });
      return { result };
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send(response.body);
    }
  });

  app.get("/api/v1/compose/drafts", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    return { drafts: db.listDrafts() };
  });

  app.post("/api/v1/compose/drafts", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    return reply.code(405).send({ error: { code: "use_generate", message: "Save drafts through the Compose generation endpoint." } });
  });

  app.delete("/api/v1/compose/drafts/:draftId", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    return { deleted: db.deleteDraft((request.params as any).draftId as string) };
  });

  app.delete("/api/v1/compose/drafts", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    return { deleted: db.clearDrafts() };
  });

  app.get("/api/v1/activity", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    return { events: db.recentAudit(20) };
  });

  app.get("/api/v1/admin/logs", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    return { logs: db.recentAudit(100) };
  });

  app.get("/api/v1/admin/diagnostics", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const instance = db.listInstances()[0] ?? null;
    return {
      tuniku: { status: "running", uptimeSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) },
      database: { status: db.isReady() ? "ready" : "unavailable", migrationVersion: 1 },
      setup: { completed: db.adminCount() > 0 },
      gluetun: {
        configured: Boolean(instance),
        lastConnectedAt: instance?.lastConnectedAt ?? null,
        capabilities: instance?.capabilityCache ?? null
      },
      dockerObservation: { enabled: Boolean(appConfig.dockerProxyUrl), status: appConfig.dockerProxyUrl ? "configured" : "not_configured" }
    };
  });

  app.get("/api/v1/admin/docker-observation", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    if (!appConfig.dockerProxyUrl) {
      return { observation: { available: false, container: null, ports: [], environment: [], networks: [], reason: "not_configured" } };
    }
    const observer = new DockerObserver(appConfig.dockerProxyUrl, appConfig.allowLoopbackUpstream);
    try {
      return { observation: await observer.observeGluetun() };
    } catch (error) {
      return reply.code(502).send({
        error: {
          code: "docker_observation_unavailable",
          message: error instanceof Error ? error.message : "Read-only Docker observation is unavailable."
        }
      });
    } finally {
      observer.close();
    }
  });

  app.get("/api/v1/admin/debug-details", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const instance = db.listInstances()[0] ?? null;
    return redactValue({
      app: { version: appConfig.build.version, buildDate: appConfig.build.date, gitSha: appConfig.build.gitSha },
      runtime: process.version,
      databaseMigration: 1,
      dataDirectory: appConfig.dataPath,
      logLevel: appConfig.logLevel,
      setupCompleted: db.adminCount() > 0,
      gluetunOrigin: instance ? new URL(instance.baseUrl).origin : null,
      capabilities: instance?.capabilityCache ?? null
    });
  });
}
