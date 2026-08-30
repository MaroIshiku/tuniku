import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config.js";
import { TunikuDatabase } from "./db.js";
import { GluetunStateService } from "./gluetun/state.js";
import { registerApiRoutes } from "./routes/api.js";

export async function buildApp(appConfig: AppConfig): Promise<FastifyInstance> {
  const trustProxy = appConfig.trustedProxyCount > 0
    ? (_address: string, hop: number) => hop < appConfig.trustedProxyCount
    : false;
  const app = Fastify({
    logger: {
      level: appConfig.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.x-api-key",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "*.password",
          "*.apiKey",
          "*.setupSecret",
          "*.wireguardPrivateKey"
        ],
        censor: "[REDACTED]"
      }
    },
    trustProxy,
    bodyLimit: 1_100_000
  });
  const db = new TunikuDatabase(appConfig.databasePath);
  const state = new GluetunStateService(db, appConfig);
  const startedAt = new Date().toISOString();

  await app.register(cookie, { secret: appConfig.sessionSecret, hook: "onRequest" });
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.addHook("preSerialization", async (request, reply, payload) => {
    if (
      !request.url.startsWith("/api/") ||
      reply.statusCode < 400 ||
      !payload ||
      typeof payload !== "object" ||
      !("error" in payload)
    ) return payload;
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== "object") return payload;
    return {
      ...(payload as Record<string, unknown>),
      error: { ...(error as Record<string, unknown>), requestId: request.id }
    };
  });

  app.get("/health", async () => ({
    status: db.isReady() ? "ok" : "degraded",
    database: db.isReady() ? "ready" : "unavailable"
  }));
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    const ready = db.isReady();
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", database: ready });
  });

  registerApiRoutes(app, { db, appConfig, state, startedAt });

  const clientRoot = path.resolve("dist/client");
  if (fs.existsSync(clientRoot)) {
    await app.register(fastifyStatic, { root: clientRoot, wildcard: false });
    app.get("/*", async (request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "not_found", message: "API route not found." } });
      return reply.sendFile("index.html");
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "not_found", message: "API route not found." } });
    return reply.code(404).send({ error: { code: "client_not_built", message: "Build the frontend before serving this route." } });
  });

  app.setErrorHandler(async (error, request, reply) => {
    app.log.error({ err: error }, "Request failed");
    const known = error instanceof Error ? error : new Error("Unknown request failure.");
    const possibleStatus = "statusCode" in known ? Number((known as Error & { statusCode?: number }).statusCode) : 0;
    const status = possibleStatus >= 400 && possibleStatus < 500 ? possibleStatus : 500;
    return reply.code(status).send({
      error: {
        code: status >= 500 ? "internal_error" : "request_error",
        message: status >= 500 ? "The request could not be completed." : known.message,
        requestId: request.id
      }
    });
  });

  app.addHook("onReady", async () => {
    db.pruneSessions();
    state.start();
  });
  app.addHook("onClose", async () => {
    state.stop();
    db.close();
  });
  return app;
}
