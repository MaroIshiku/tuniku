import { buildManager } from "./server.js";
const list = (value: string | undefined) => (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
const app = await buildManager({ dataPath: process.env.TUNIKU_MANAGER_DATA_PATH ?? "/managed", keyFile: process.env.TUNIKU_MANAGER_KEY_FILE ?? "/run/secrets/tuniku_manager_key", socketPath: process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock", projects: list(process.env.TUNIKU_MANAGER_PROJECTS), bindRoots: list(process.env.TUNIKU_MANAGER_BIND_ROOTS) });
await app.listen({ host: "0.0.0.0", port: 2376 });
process.on("SIGTERM", () => void app.close());
process.on("SIGINT", () => void app.close());
