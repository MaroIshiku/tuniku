import { bindingsOverlap } from "../compose/ports.js";
import { storageDiagnostics } from "../storageDiagnostics.js";
import { FieldValidationError } from "../validation.js";
import { DockerObservationCache } from "../docker/observationCache.js";
import { logQuery } from "../docker/logOptions.js";
import { composeInputSchema } from "../compose/input.js";
import { ManagerClient } from "../management/client.js";
import crypto from "node:crypto";
import net from "node:net";
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
  generateCompose,
  inspectCompose,
  redactedDraftInput,
  validateCompose,
  type ComposeGenerationInput
} from "../compose/generator.js";
import { DockerObserver } from "../docker/observer.js";
import { gluetunProviderProfiles } from "../compose/providers.js";
import { ServerCatalog, serverFilterKeys } from "../compose/serverCatalog.js";

const setupLimiter = new SlidingWindowRateLimiter(8, 15 * 60_000);
const loginNetworkLimiter = new SlidingWindowRateLimiter(20, 15 * 60_000);
const loginAccountLimiter = new SlidingWindowRateLimiter(8, 15 * 60_000);
const connectionLimiter = new SlidingWindowRateLimiter(20, 60_000);
const managerLimiter = new SlidingWindowRateLimiter(20, 60_000);
const controlLimiter = new SlidingWindowRateLimiter(20, 60_000);
const generateLimiter = new SlidingWindowRateLimiter(30, 60_000);
const catalogRefreshLimiter = new SlidingWindowRateLimiter(5, 15 * 60_000);
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
  return { ...result, idHash };
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
    return body.username && body.password
      ? { username: body.username, password: body.password }
      : null;
  }
  return null;
}

async function validateConnectionUrl(value: string, allowLoopback: boolean): Promise<string> {
  try { return await validateUpstreamUrl(value, allowLoopback); }
  catch { throw new FieldValidationError("baseUrl", "Use an allowed HTTP or HTTPS Control Server URL without credentials, query or fragment. Check the hostname and upstream network policy."); }
}

function errorResponse(error: unknown): { status: number; body: unknown } {
  if (error instanceof FieldValidationError) {
    return { status: 400, body: { error: { code: "validation_error", message: error.message, details: [{ path: error.path, message: error.message }] } } };
  }
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
  const serverCatalog = new ServerCatalog(appConfig.dataPath);
  const dockerCache = new DockerObservationCache();
  app.addHook("onClose", () => dockerCache.close());
  const observeMetadata = (instance: { id: string; baseUrl: string } | null, force = false) => dockerCache.get(
    JSON.stringify([instance?.id ?? null, instance?.baseUrl ?? null]),
    async () => {
      const observer = new DockerObserver(appConfig.dockerProxyUrl!, appConfig.allowLoopbackUpstream);
      try { return await observer.observeGluetun(instance?.baseUrl, false); }
      finally { observer.close(); }
    }, force
  );
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
        setupSecret: z.string().max(4096),
        displayName: z.string().max(100),
        username: z.string().max(64),
        email: z.string().max(254).optional().default(""),
        password: z.string().max(4096),
        passwordConfirm: z.string().max(4096)
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
      const user = db.findUserByUsername(body.username.trim());
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

  app.post("/api/v1/auth/activity", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    // Bound writes without letting ordinary status reads extend a session.
    if (Date.parse(session.lastSeenAt) <= Date.now() - 1_000) db.touchSession(session.idHash);
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
      const baseUrl = await validateConnectionUrl(body.baseUrl, appConfig.allowLoopbackUpstream);
      const credential = credentialFromBody(body, body.authMode);
      const existing = db.getInstance(id);
      const sameConnection = existing?.baseUrl === baseUrl && existing.authMode === body.authMode;
      const currentCredential = sameConnection && existing ? state.credentialFor(existing) : null;
      // Credentials are scoped to their destination and authentication mode.
      let encryptedCredential: string | null | undefined = sameConnection ? undefined : null;
      if (body.authMode === "none") encryptedCredential = null;
      else if (!body.saveCredential) encryptedCredential = null;
      else if (body.saveCredential) {
        if (!credential && (!existing?.hasStoredCredential || !sameConnection)) {
          throw new FieldValidationError(body.authMode === "api_key" ? "apiKey" : "password", "Enter the selected Gluetun credential before saving it.");
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
      state.setEphemeralCredential(id, body.saveCredential || body.authMode === "none" ? null : credential ?? currentCredential);
      state.invalidate(id);
      dockerCache.invalidate();
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
        configuration: instanceSchema.optional(),
        apiKey: z.string().max(4096).optional(),
        username: z.string().max(256).optional(),
        password: z.string().max(4096).optional()
      }).parse(request.body ?? {});
      const existing = db.getInstance(id);
      if (!existing && !body.configuration) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
      const candidate = body.configuration;
      const baseUrl = candidate ? await validateConnectionUrl(candidate.baseUrl, appConfig.allowLoopbackUpstream) : existing!.baseUrl;
      const instance = candidate ? {
        id, displayName: candidate.displayName, baseUrl, authMode: candidate.authMode,
        tlsVerify: candidate.tlsVerify, requestTimeoutSeconds: candidate.requestTimeoutSeconds,
        hasStoredCredential: false, capabilityCache: null, lastConnectedAt: null,
        createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: existing?.updatedAt ?? new Date().toISOString()
      } : existing!;
      const transient = credentialFromBody(candidate ?? body, instance.authMode);
      const sameConnection = existing?.baseUrl === baseUrl && existing.authMode === instance.authMode;
      const adapter = new GluetunAdapter(instance, transient ?? (sameConnection ? state.credentialFor(existing!) : null), appConfig.allowLoopbackUpstream);
      try {
        const capabilities = await adapter.probe();
        const states = Object.values(capabilities);
        const reachable = states.some((capability) => capability.state !== "unreachable");
        const authenticationAccepted = states.some((capability) => capability.state === "available") && !states.some((capability) => capability.state === "unauthorized");
        if (authenticationAccepted && !candidate) db.updateCapabilities(id, capabilities);
        audit(request, { userId: session.user.id, instanceId: existing ? id : null, type: "connection_test", result: authenticationAccepted ? "success" : "failed", metadata: { capabilities, reachable, authenticationAccepted, preview: Boolean(candidate) } });
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
    state.invalidate(id);
    dockerCache.invalidate();
    audit(request, { userId: session.user.id, instanceId: id, type: "credential_deleted", result: "success", metadata: {} });
    return { ok: true };
  });

  app.get("/api/v1/instances/:instanceId/overview", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const id = (request.params as any).instanceId as string;
    const instance = db.getInstance(id);
    if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
    const cached = state.current(id);
    const refresh = z.object({ refresh: z.enum(["true", "false"]).default("false") }).parse(request.query);
    return { overview: refresh.refresh === "true" ? await state.refresh(instance) : cached ?? await state.refresh(instance) };
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
          state.invalidate(instance.id);
          dockerCache.invalidate();
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
        state.invalidate(instance.id);
        dockerCache.invalidate();
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
    const manualPorts = db.listPorts(instanceId);
    if (!appConfig.dockerProxyUrl) {
      return { ports: manualPorts, detection: { available: false, error: "Automatic Docker port detection is not configured." } };
    }
    const query = z.object({ force: z.enum(["true", "false"]).optional() }).strict().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: { code: "invalid_query", message: "Choose a valid port refresh query." } });
    try {
      const instance = db.getInstance(instanceId);
      if (!instance) return reply.code(404).send({ error: { code: "not_found", message: "The instance does not exist." } });
      const observation = await observeMetadata(instance, query.data.force === "true");
      const timestamp = observation.observedAt!;
      const detectedPorts = (observation.association?.state === "matched" ? observation.ports : [])
        .filter((detected) => detected.hostPort !== null)
        .map((detected) => ({
          id: `docker-${detected.hostAddress || "any"}-${detected.hostPort || "none"}-${detected.containerPort}-${detected.protocol}`,
          instanceId,
          label: detected.hostPort ? `Published port ${detected.hostPort}` : `Exposed port ${detected.containerPort}`,
          hostAddress: detected.hostAddress,
          hostPort: detected.hostPort,
          containerPort: detected.containerPort,
          protocol: detected.protocol,
          sourceType: "docker" as const,
          notes: "Detected from the Gluetun Docker configuration.",
          createdAt: timestamp,
          updatedAt: timestamp
        }));
      return {
        ports: [...detectedPorts, ...manualPorts],
        detection: {
          observedAt: observation.observedAt,
          available: Boolean(observation.container) && observation.association?.state === "matched",
          error: observation.association?.state === "unverified" ? observation.association.message : observation.container ? null : observation.issues[0] || "No Gluetun container was found."
        }
      };
    } catch (error) {
      return {
        ports: manualPorts,
        detection: { available: false, error: error instanceof Error ? error.message : "Automatic Docker port detection is unavailable." }
      };
    }
  });

  const portSchema = z.object({
    label: z.string().trim().min(1).max(100),
    hostAddress: z.string().trim().max(100).refine((value) => Boolean(net.isIP(value)), "Enter a valid IPv4 or IPv6 host address.").nullable().optional().default(null),
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
      if (!db.getInstance(instanceId)) return reply.code(404).send({ error: { code: "not_found", message: "Gluetun instance not found." } });
      const body = portSchema.parse(request.body);
      const collisions = body.hostPort ? db.listPorts(instanceId).filter((port) => port.hostPort && bindingsOverlap({ address: port.hostAddress ?? "", first: port.hostPort, last: port.hostPort, protocol: port.protocol }, { address: body.hostAddress ?? "", first: body.hostPort!, last: body.hostPort!, protocol: body.protocol })) : [];
      if (collisions.length) throw new FieldValidationError("hostPort", "A local port note overlaps this host address, port and protocol. Review the existing note or choose a different mapping.");
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
      if (!db.listPorts(instanceId).some((port) => port.id === id)) return reply.code(404).send({ error: { code: "not_found", message: "Port label not found." } });
      const body = portSchema.parse(request.body);
      const collisions = body.hostPort
        ? db.listPorts(instanceId).filter((port) => port.id !== id && port.hostPort && bindingsOverlap({ address: port.hostAddress ?? "", first: port.hostPort, last: port.hostPort, protocol: port.protocol }, { address: body.hostAddress ?? "", first: body.hostPort!, last: body.hostPort!, protocol: body.protocol }))
        : [];
      if (collisions.length) throw new FieldValidationError("hostPort", "A local port note overlaps this host address, port and protocol. Review the existing note or choose a different mapping.");
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
    return { providers: gluetunProviderProfiles, gluetunVersion: "latest", gluetunImage: "qmcgaw/gluetun:latest" };
  });

  app.get("/api/v1/management", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    if (!appConfig.managerUrl) return { enabled: false, candidates: [], projects: [], operations: [] };
    const client = new ManagerClient(appConfig.managerUrl, appConfig.managerKey, appConfig.allowLoopbackUpstream);
    try { return { enabled: true, ...redactValue(await client.request("status")) as Record<string, unknown> }; }
    catch { return reply.code(503).send({ error: { code: "manager_unavailable", message: "Managed changes are unavailable. Check the optional helper deployment, its project allowlist and Docker socket access." } }); }
    finally { await client.close(); }
  });
  for (const action of ["adopt", "plan", "apply", "diagnostics", "settings", "export", "prune", "recovery-review", "recovery-complete", "cleanup-review", "cleanup"] as const) {
    app.post(`/api/v1/management/${action}`, async (request, reply) => {
      const session = requireSession(request, reply, db);
      if (!session || !requireCsrf(request, reply, session)) return;
      if (!managerLimiter.consume(`${session.user.id}:${action}`)) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many managed changes. Wait before retrying." } });
      if (!appConfig.managerUrl) return reply.code(409).send({ error: { code: "manager_disabled", message: "Enable the optional managed deployment before applying changes." } });
      const body = action === "prune" ? z.object({ confirmed: z.literal(true) }).strict().parse(request.body)
        : action === "export" ? z.object({ projectId: z.string().uuid(), source: z.string().max(200_000) }).strict().parse(request.body)
        : action === "recovery-review" || action === "cleanup-review" ? z.object({ operationId: z.string().uuid() }).strict().parse(request.body)
        : action === "recovery-complete" || action === "cleanup" ? z.object({ operationId: z.string().uuid(), fingerprint: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(request.body)
        : action === "diagnostics" || action === "settings" ? z.object({ projectId: z.string().uuid() }).strict().parse(request.body) : action === "adopt"
        ? z.object({ vpnId: z.string().regex(/^[a-f0-9]{64}$/), clientIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20), confirmed: z.literal(true) }).strict().parse(request.body)
        : action === "plan" ? z.object({ projectId: z.string().uuid(), input: composeInputSchema }).strict().parse(request.body)
        : z.object({ planId: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(request.body);
      const client = new ManagerClient(appConfig.managerUrl, appConfig.managerKey, appConfig.allowLoopbackUpstream);
      const identity = "projectId" in body ? { projectId: body.projectId } : "planId" in body ? { planId: body.planId } : "vpnId" in body ? { vpnId: body.vpnId } : "operationId" in body ? { operationId: body.operationId } : {};
      if ((action === "apply" || action === "cleanup")) dockerCache.invalidate();
      try {
        const result = await client.request(action, body);
        audit(request, { userId: session.user.id, instanceId: null, type: `managed_${action}`, result: "success", metadata: { action, ...identity, ...(result.operation?.id ? { operationId: result.operation.id } : {}) } });
        return reply.code(action === "apply" ? 202 : 200).send(redactValue(result));
      } catch (error) {
        audit(request, { userId: session.user.id, instanceId: null, type: `managed_${action}`, result: "failed", metadata: { action, ...identity } });
        return reply.code(409).send({ error: { code: "managed_change_failed", message: error instanceof Error ? redactText(error.message) : "The managed operation failed." } });
      } finally { if ((action === "apply" || action === "cleanup")) dockerCache.invalidate(); await client.close(); }
    });
  }

  app.get("/api/v1/compose/providers/:providerId/server-options", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const providerId = z.string().max(80).parse((request.params as any).providerId);
    const profile = gluetunProviderProfiles.find((candidate) => candidate.id === providerId);
    if (!profile || profile.id === "custom") return reply.code(404).send({ error: { code: "provider_not_found", message: "The Gluetun provider is not available." } });
    const query = z.object({
      vpnType: z.enum(["openvpn", "wireguard"]),
      field: z.enum(serverFilterKeys),
      q: z.string().max(500).default(""),
      countries: z.string().max(500).optional(), regions: z.string().max(500).optional(), cities: z.string().max(500).optional(),
      hostnames: z.string().max(2000).optional(), names: z.string().max(2000).optional(), categories: z.string().max(500).optional(), isps: z.string().max(500).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }).parse(request.query);
    if (!profile.protocols.includes(query.vpnType) || !profile.serverFilters.includes(query.field)) {
      return reply.code(400).send({ error: { code: "unsupported_server_filter", message: "This filter is not supported for the selected provider and protocol." } });
    }
    const result = serverCatalog.query(profile.id, query.vpnType, query.field, query.q, query.limit, query);
    return result ? { options: result } : reply.code(404).send({ error: { code: "server_catalog_unavailable", message: "No server catalog is available for this provider." } });
  });

  app.post("/api/v1/compose/providers/:providerId/server-options/refresh", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    if (!catalogRefreshLimiter.consume(`${session.user.id}:catalog`)) return reply.code(429).send({ error: { code: "rate_limited", message: "Too many server catalog refresh requests." } });
    const providerId = z.string().max(80).parse((request.params as any).providerId);
    const profile = gluetunProviderProfiles.find((candidate) => candidate.id === providerId);
    if (!profile || profile.id === "custom") return reply.code(404).send({ error: { code: "provider_not_found", message: "The Gluetun provider is not available." } });
    try {
      const refreshed = await serverCatalog.refresh(profile.id);
      audit(request, { userId: session.user.id, instanceId: null, type: "server_catalog_refreshed", result: "success", metadata: { provider: profile.id, updatedAt: refreshed.updatedAt } });
      return { refreshed };
    } catch (error) {
      audit(request, { userId: session.user.id, instanceId: null, type: "server_catalog_refreshed", result: "failed", metadata: { provider: profile.id } });
      return reply.code(502).send({ error: { code: "server_catalog_refresh_failed", message: error instanceof Error ? error.message : "The official Gluetun server catalog could not be refreshed." } });
    }
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
      const result = generateCompose(input, serverCatalog);
      if (taskType === "publish_app_port") {
        const check: import("../compose/generator.js").ComposeValidationCheck = { id: "selected_ports", label: "Selected Docker port configuration", status: "not_run", detail: "No matching Docker observation is available. Other containers and host processes have not been checked; this proposal does not prove the host port is free." };
        result.validation.checks.splice(3, 0, check);
        const instance = body.instanceId ? db.getInstance(body.instanceId) : null;
        if (body.instanceId && !instance) return reply.code(404).send({ error: { code: "not_found", message: "The selected connection no longer exists. Choose it again before generating." } });
        if (result.validation.valid && instance && appConfig.dockerProxyUrl) {
          try {
            const observation = await observeMetadata(instance, true);
            if (observation.association?.state === "matched" && db.getInstance(instance.id)?.baseUrl === instance.baseUrl) {
              const proposed = { address: input.hostAddress ?? "", first: input.hostPort!, last: input.hostPort!, protocol: input.protocol ?? "tcp", target: input.containerPort! };
              const conflicts = observation.ports.some(port => port.hostPort && port.containerPort !== proposed.target && bindingsOverlap(proposed, { address: port.hostAddress ?? "", first: port.hostPort, last: port.hostPort, protocol: port.protocol }));
              if (conflicts) throw new FieldValidationError("hostPort", "The selected Gluetun Docker configuration already maps this host address, port and protocol to a different container port. Choose another host port or review the existing mapping.");
              check.status = "passed";
              check.detail = `No conflicting mapping in the selected Gluetun configuration observed at ${observation.observedAt ?? "an unavailable time"}. Docker state: ${observation.container?.state ?? "unknown"}. Other containers and host processes were not checked; this is not a host-listener or free-port guarantee.`;
            }
          } catch (failure) {
            if (failure instanceof FieldValidationError) throw failure;
            check.detail = "Docker port inspection failed. Other containers and host processes have not been checked. Review host port occupancy manually before applying.";
          }
        }
      }
      if (body.saveDraft) {
        const redacted = generateCompose({ ...input, includeSecrets: false }, serverCatalog);
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
    const query = z.object({ summary: z.enum(["true", "false"]).optional(), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) }).strict().parse(request.query);
    if (query.summary === "true") {
      const rows = db.draftSummaries(query.offset);
      return { drafts: redactValue(rows.slice(0, 50)), hasMore: rows.length > 50 };
    }
    return { drafts: db.listDrafts().map((value) => {
      const draft = value as Record<string, unknown>;
      return { ...draft, input: redactValue(draft.input), output: redactText(String(draft.output ?? "")), title: redactText(String(draft.title ?? "")) };
    }) };
  });

  app.get("/api/v1/compose/drafts/:draftId", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const id = z.string().uuid().parse((request.params as { draftId: string }).draftId);
    const draft = db.getDraft(id);
    if (!draft) return reply.code(404).send({ error: { code: "draft_not_found", message: "This draft no longer exists. Refresh the saved drafts list." } });
    try {
      const values = JSON.parse(String(draft.rawInput));
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error();
      for (const field of ["hostPort", "containerPort", "wireguardEndpointPort"]) {
        if (typeof values[field] === "string" && /^\d+$/.test(values[field])) values[field] = Number(values[field]);
      }
      const parsed = composeInputSchema.strip().safeParse({ ...values, taskType: draft.taskType, includeSecrets: false });
      if (!parsed.success) throw new Error();
      const { rawInput: _rawInput, ...summary } = draft;
      return { draft: { ...redactValue(summary) as Record<string, unknown>, input: { ...redactedDraftInput(parsed.data as ComposeGenerationInput), includeSecrets: false } } };
    } catch {
      return reply.code(409).send({ error: { code: "draft_unsupported", message: "This draft has unreadable or unsupported settings. Keep the original record and start a new draft." } });
    }
  });

  app.post("/api/v1/compose/drafts", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    return reply.code(405).send({ error: { code: "use_generate", message: "Save drafts through the Compose generation endpoint." } });
  });

  app.delete("/api/v1/compose/drafts/:draftId", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    return db.raw.transaction(() => {
      const deleted = db.deleteDraft((request.params as any).draftId as string);
      audit(request, { userId: session.user.id, instanceId: null, type: "draft_deleted", result: deleted ? "success" : "not_found", metadata: { count: Number(deleted) } });
      return { deleted };
    }).immediate();
  });

  app.delete("/api/v1/compose/drafts", async (request, reply) => {
    const session = requireSession(request, reply, db);
    if (!session || !requireCsrf(request, reply, session)) return;
    return db.raw.transaction(() => {
      const deleted = db.clearDrafts();
      audit(request, { userId: session.user.id, instanceId: null, type: "drafts_cleared", result: "success", metadata: { count: deleted } });
      return { deleted };
    }).immediate();
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
      database: { status: db.isReady() ? "ready" : "unavailable", migrationVersion: 4, journalMode: db.raw.pragma("journal_mode", { simple: true }), storage: storageDiagnostics(appConfig.databasePath) },
      transport: { mode: appConfig.secureCookies ? "https_proxy" : "local_http", observedProtocol: request.protocol, trustedProxyCount: appConfig.trustedProxyCount },
      setup: { completed: db.adminCount() > 0 },
      gluetun: {
        configured: Boolean(instance),
        accessState: instance ? state.accessState(instance) : "not_configured",
        lastConnectedAt: instance?.lastConnectedAt ?? null,
        capabilities: instance?.capabilityCache ?? null
      },
      dockerObservation: { enabled: Boolean(appConfig.dockerProxyUrl), status: appConfig.dockerProxyUrl ? "configured" : "not_configured" }
    };
  });

  app.get("/api/v1/admin/docker-observation", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    if (!appConfig.dockerProxyUrl) {
      return { observation: { available: false, container: null, ports: [], environment: [], networks: [], logs: null, logsError: "Read-only Docker observation is not configured.", issues: ["Configure a restricted Docker Socket Proxy to inspect Gluetun status and logs."], reason: "not_configured" } };
    }
    const observer = new DockerObserver(appConfig.dockerProxyUrl, appConfig.allowLoopbackUpstream);
    try {
      const options = z.object({ tail: z.coerce.number().int().min(1).max(1000).optional(), since: z.coerce.number().int().nonnegative().optional(), until: z.coerce.number().int().nonnegative().optional(), includeLogs: z.enum(["true", "false"]).optional(), force: z.enum(["true", "false"]).optional() }).strict().safeParse(request.query);
      if (!options.success) return reply.code(400).send({ error: { code: "invalid_log_query", message: "Choose a valid log range and a line limit between 1 and 1000." } });
      try { logQuery(options.data); } catch { return reply.code(400).send({ error: { code: "invalid_log_query", message: "Choose a valid past log time range." } }); }
      const instance = db.listInstances()[0] ?? null;
      if (options.data.includeLogs === "false") return { observation: await observeMetadata(instance, options.data.force === "true") };
      const observation = await observer.observeGluetun(instance?.baseUrl, true, options.data);
      return { observation: { ...observation, observedAt: new Date().toISOString() } };
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

  app.get("/api/v1/admin/traffic", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    return {
      traffic: state.trafficSummary(),
      privacy: "Aggregate byte counters only. Tuniku does not record destinations, URLs, DNS queries, or packet contents."
    };
  });

  app.get("/api/v1/admin/debug-details", async (request, reply) => {
    if (!requireSession(request, reply, db)) return;
    const instance = db.listInstances()[0] ?? null;
    return redactValue({
      app: { version: appConfig.build.version, buildDate: appConfig.build.date, gitSha: appConfig.build.gitSha },
      runtime: process.version,
      databaseMigration: 4,
      dataDirectory: appConfig.dataPath,
      logLevel: appConfig.logLevel,
      setupCompleted: db.adminCount() > 0,
      gluetunOrigin: instance ? new URL(instance.baseUrl).origin : null,
      accessState: instance ? state.accessState(instance) : "not_configured",
      capabilities: instance?.capabilityCache ?? null
    });
  });
}
