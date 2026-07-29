import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: "list",
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: false,
    timeout: 30_000
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
});
