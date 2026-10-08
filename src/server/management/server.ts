import fs from "node:fs";
import Fastify from "fastify";
import { z } from "zod";
import { timingSafeEqualText } from "../security.js";
import { composeInputSchema } from "../compose/input.js";
import type { ComposeGenerationInput } from "../compose/generator.js";
import { ServerCatalog } from "../compose/serverCatalog.js";
import { ManagedError, ManagedStackEngine, ManagedStore } from "./engine.js";
import { SocketManagedDocker } from "./docker.js";
import { managedRecoveryIds } from "./inventory.js";

export async function buildManager(input: { dataPath: string; keyFile: string; socketPath: string; projects: string[]; bindRoots: string[] }) {
  const metadata = fs.statSync(input.keyFile);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("The manager key must be a private mode-0600 file.");
  const key = fs.readFileSync(input.keyFile, "utf8").trim();
  if (key.length < 32 || input.projects.length === 0 || input.projects.some((project) => !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project))) throw new Error("Set a strong manager key and explicit Compose project allowlist.");
  const bindRoots = input.bindRoots.map((root) => root.replace(/\/+$/, ""));
  if (bindRoots.some((root) => !root.startsWith("/") || ["", "/", "/etc", "/proc", "/sys", "/dev", "/var/run", "/run"].includes(root) || /(?:^|\/)\.\.(?:\/|$)/.test(root))) throw new Error("Managed bind roots must name explicit data directories.");
  const docker = new SocketManagedDocker(input.socketPath, 90_000, input.projects);
  const engine = new ManagedStackEngine(docker, new ManagedStore(input.dataPath, key), input.projects, bindRoots, new ServerCatalog(input.dataPath));
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "GET" && request.url === "/health") return;
    if (!timingSafeEqualText(request.headers.authorization ?? "", `Bearer ${key}`)) return reply.code(401).send({ error: { code: "unauthorized", message: "Manager authentication is required." } });
  });
  app.get("/health", () => ({ status: "ok" }));
  app.get("/status", async () => {
    const operations = engine.operations();
    const recovery = managedRecoveryIds(operations);
    return { storage: engine.storageStatus(), prerequisites: { projects: input.projects, bindRootsConfigured: input.bindRoots.length > 0, adoptionOnly: true, restartAlwaysSupported: false }, candidates: (await docker.candidates(input.projects)).map(candidate => ({ ...candidate, recovery: recovery.has(candidate.id) })), projects: engine.projects(), operations };
  });
  app.post("/diagnostics", async (request) => {
    const body = z.object({ projectId: z.string().uuid() }).strict().parse(request.body);
    return { diagnostics: await engine.diagnostics(body.projectId) };
  });
  app.post("/adopt", async (request) => {
    const body = z.object({ vpnId: z.string().regex(/^[a-f0-9]{64}$/), clientIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20), confirmed: z.literal(true) }).strict().parse(request.body);
    return { project: await engine.adopt(body.vpnId, body.clientIds, body.confirmed) };
  });
  app.post("/plan", async (request) => {
    const body = z.object({ projectId: z.string().uuid(), input: composeInputSchema }).strict().parse(request.body);
    return { plan: await engine.plan(body.projectId, body.input as ComposeGenerationInput) };
  });
  app.post("/apply", async (request, reply) => {
    const body = z.object({ planId: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(request.body);
    const operation = await engine.beginApply(body.planId, body.confirmed);
    return reply.code(202).send({ operation });
  });
  for (const action of ["settings", "export", "prune", "recovery-review", "recovery-complete", "cleanup-review", "cleanup"] as const) {
    app.post(`/${action}`, async request => {
      if (action === "prune") { z.object({ confirmed: z.literal(true) }).strict().parse(request.body); return { removed: engine.pruneExpiredPlans(), storage: engine.storageStatus() }; }
      if (action === "settings") { const body = z.object({ projectId: z.string().uuid() }).strict().parse(request.body); return { settings: await engine.settings(body.projectId) }; }
      if (action === "export") { const body = z.object({ projectId: z.string().uuid(), source: z.string().max(200_000) }).strict().parse(request.body); return { export: await engine.exportConfiguration(body.projectId, body.source) }; }
      if (action === "recovery-review" || action === "cleanup-review") { const body = z.object({ operationId: z.string().uuid() }).strict().parse(request.body); return { review: action === "recovery-review" ? await engine.reviewRecovery(body.operationId) : await engine.reviewCleanup(body.operationId) }; }
      const body = z.object({ operationId: z.string().uuid(), fingerprint: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(request.body);
      return action === "recovery-complete" ? engine.completeRecovery(body.operationId, body.fingerprint, body.confirmed) : engine.cleanup(body.operationId, body.fingerprint, body.confirmed);
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof z.ZodError ? "The manager request is invalid." : error instanceof ManagedError ? error.message : "The managed operation failed. Preserve the manager state and inspect its recovery status.";
    return reply.code(error instanceof z.ZodError ? 400 : 409).send({ error: { code: "managed_operation_failed", message } });
  });
  app.addHook("onClose", () => engine.close());
  return app;
}
