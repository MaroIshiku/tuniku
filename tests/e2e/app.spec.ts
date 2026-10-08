import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/management/settings", route => route.fulfill({ json: { settings: { input: { provider: "protonvpn", vpnType: "wireguard", providerOptions: {} }, clearableKeys: [], publishedPorts: {}, configurationSource: "environment" } } }));
});

test("first-run setup, Gluetun connection, control, ports, and Compose generation", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up admin" })).toBeVisible();
  await page.getByLabel("Setup secret").fill("tuniku-e2e-setup-secret");
  await page.getByLabel("Display name").fill("Tuniku Admin");
  await page.getByLabel("Admin username").fill("admin");
  await page.getByLabel("Admin password", { exact: true }).fill("a unique e2e admin password");
  await page.getByLabel("Repeat password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Create admin account" }).click();

  await expect(page.getByRole("heading", { name: "Set up Gluetun" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("first-run-gluetun-choice.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Create Gluetun configuration" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect existing Gluetun" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("first-run-gluetun-choice-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Create Gluetun configuration" }).click();
  await expect(page.getByRole("heading", { name: "Compose Assistant" })).toBeVisible();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  await expect(page.getByText("ProtonVPN · WireGuard")).toBeVisible();
  await page.getByLabel("WireGuard private key").fill("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=");
  await page.getByLabel("API key").fill("e2e-control-api-key");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator(".validation-chip", { hasText: "Configuration syntax checks passed" })).toBeVisible();
  const evidence = page.getByRole("article", { name: "Validation evidence" });
  await expect(evidence).toContainText("YAML syntax: Passed");
  await expect(evidence).toContainText("Provider inputs: Passed");
  await expect(evidence).toContainText("Docker Compose config: Not run");
  await expect(evidence).toContainText("VPN and application runtime: Not run");
  await expect(page.locator(".code-block", { hasText: "gluetun:" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Overview", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect existing Gluetun" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(await page.getByRole("dialog").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.getByLabel("Control Server base URL").fill("http://127.0.0.1:8199");
  await page.getByLabel("Authentication mode").selectOption("none");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Reachable · Authentication accepted")).toBeVisible();
  expect((await (await page.request.get("/api/v1/instances")).json()).instances).toHaveLength(0);
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("heading", { name: "VPN is stopped" })).toBeVisible();
  await expect(page.getByText("Berlin, Germany")).toBeVisible();
  await expect(page.getByText("Traffic counters unavailable")).toBeVisible();
  await page.route("**/api/v1/admin/traffic", (route) => route.fulfill({ json: { traffic: { available: true, observedAt: "2000-01-01T00:00:00Z", downloadBytesPerSecond: 0, uploadBytesPerSecond: 0, todayDownloadedBytes: 1024, todayUploadedBytes: 512, trackedDownloadedBytes: 2048, trackedUploadedBytes: 1024, error: "Synthetic stale counters." } } }));
  await page.route("**/api/v1/instances/*/ports*", (route) => route.fulfill({ status: 502, json: { error: { message: "Synthetic port inspection failure." } } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Synthetic stale counters.")).toBeVisible();
  await expect(page.locator(".traffic-card strong")).toHaveText("Traffic counters unavailable");
  await expect(page.getByText("Port refresh failed.", { exact: false })).toContainText("Synthetic port inspection failure.");
  await expect(page.getByText("Port refresh failed.", { exact: false })).toContainText("Displayed mappings may be outdated.");
  await page.unroute("**/api/v1/admin/traffic");
  await page.unroute("**/api/v1/instances/*/ports*");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Synthetic stale counters.")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("desktop-overview.png"), fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 });
  const ipCard = await page.locator(".ip-status-card").boundingBox();
  const dnsCard = await page.locator(".status-card").nth(1).boundingBox();
  expect(ipCard && dnsCard && ipCard.width > dnsCard.width * 1.5).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("wide-overview.png"), fullPage: false });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: "VPN", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "VPN Control" })).toBeVisible();
  await page.getByRole("button", { name: "Start VPN" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start VPN" }).click();
  await expect(page.getByRole("heading", { name: "VPN is running" })).toBeVisible();
  await page.getByRole("button", { name: "Stop DNS", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Stop DNS", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start DNS", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Start DNS", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start DNS", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop DNS", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Run updater", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run updater", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Ports", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "VPN provider port forwarding" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Docker-published ports" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Local port notes" })).toBeVisible();
  await expect(page.getByText("Documentation stored in Tuniku only. These entries do not change Docker, Gluetun, or Compose.")).toBeVisible();
  await expect(page.getByText("Automatic port detection unavailable")).toBeVisible();
  await expect(page.getByText("No Docker ports published on Gluetun")).toHaveCount(0);
  await page.getByRole("button", { name: "Add port note" }).first().click();
  await expect(page.getByText("This note does not publish or open a port. Apply runtime changes in your Compose configuration.")).toBeVisible();
  await page.getByLabel("Label").fill("Example Web UI");
  await page.getByLabel("Host port").fill("8080");
  await page.getByLabel("Container port").fill("8080");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Example Web UI")).toBeVisible();
  await expect(page.getByText("Documentation only")).toBeVisible();
  await page.evaluate(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async () => { navigator.clipboard.writeText = original; throw new Error("Synthetic clipboard denial."); };
  });
  await page.getByRole("button", { name: "Copy Example Web UI", exact: true }).click();
  await expect(page.locator(".toast", { hasText: "Synthetic clipboard denial." })).toBeVisible();
  const portsAccessibility = await new AxeBuilder({ page }).include(".app-main").analyze();
  expect(portsAccessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (viewport.width === 390) {
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-mode", "dark");
        document.documentElement.setAttribute("data-resolved-mode", "dark");
        document.documentElement.style.colorScheme = "dark";
      });
      await page.screenshot({ path: testInfo.outputPath("port-sources-mobile-dark.png"), fullPage: false });
      await page.evaluate(() => {
        const heading = document.getElementById("manual-ports-heading");
        if (heading) window.scrollTo(0, heading.getBoundingClientRect().top + window.scrollY - 88);
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: testInfo.outputPath("port-notes-mobile-dark.png"), fullPage: false });
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-mode", "system");
        document.documentElement.setAttribute("data-resolved-mode", "light");
        document.documentElement.style.colorScheme = "light";
      });
    }
    if (viewport.width === 1920) await page.screenshot({ path: testInfo.outputPath("port-sources-wide.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Compose Assistant" })).toBeVisible();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  await page.getByLabel("WireGuard private key").fill("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=");
  await page.getByLabel("API key").fill("e2e-control-api-key");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.getByRole("heading", { name: "3. Copy-paste snippet" })).toBeVisible();
  await expect(page.locator(".validation-chip", { hasText: "Configuration syntax checks passed" })).toBeVisible();
  const composeText = await page.locator(".snippet-card .code-block").textContent();
  expect(composeText).toContain("VPN_SERVICE_PROVIDER: protonvpn");
  expect(composeText).toContain("image: qmcgaw/gluetun:latest");
  expect(composeText).toContain("gluetun_data:/gluetun");
  expect(composeText).toContain("[REDACTED]");
  expect(composeText).toContain("external: true");
  expect(composeText).not.toContain("network_mode:");
  expect(composeText).not.toContain("services:\n  tuniku:");
  expect(composeText).not.toContain("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=");
  expect(composeText).not.toContain("${");
  await page.getByLabel("API key", { exact: true }).fill("changed-synthetic-control-key");
  await expect(page.locator(".snippet-card")).toHaveCount(0);
  await page.getByLabel("Include secret values in this response").check();
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator(".snippet-card .code-block")).toContainText("changed-synthetic-control-key");
  await expect(page.getByLabel("Include secret values in this response")).not.toBeChecked();
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator(".snippet-card .code-block")).not.toContainText("changed-synthetic-control-key");
  await expect(page.locator(".snippet-card .code-block")).toContainText("[REDACTED]");
  const accessibility = await new AxeBuilder({ page }).include(".app-main").analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (viewport.width === 390) {
      await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 });
      await page.locator(".result-redaction").scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-mode", "dark");
        document.documentElement.setAttribute("data-resolved-mode", "dark");
        document.documentElement.style.colorScheme = "dark";
      });
      await page.screenshot({ path: testInfo.outputPath("compose-assistant-generated-mobile-dark.png"), fullPage: false });
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-mode", "system");
        document.documentElement.setAttribute("data-resolved-mode", "light");
        document.documentElement.style.colorScheme = "light";
      });
    }
  }
  await page.screenshot({ path: testInfo.outputPath("compose-assistant-generated-wide.png"), fullPage: false });
  await expect(page.getByText("Complete Gluetun add-on Compose.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Next: configure application ports" }).click();
  await expect(page.getByLabel("Paste Compose YAML (optional)")).toHaveValue(/qmcgaw\/gluetun:latest/);
  if (!(await page.getByRole("button", { name: "New Gluetun setup", exact: true }).isVisible())) await page.getByText("Expert tasks", { exact: true }).click();
  await page.getByRole("button", { name: "New Gluetun setup", exact: true }).click();
  await page.getByLabel("VPN service provider").selectOption("private internet access");
  await expect(page.getByLabel("Server countries")).toHaveCount(0);
  await expect(page.getByLabel("Server cities")).toHaveCount(0);
  await expect(page.getByLabel("Server regions")).toBeVisible();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  await page.getByRole("combobox", { name: "VPN type", exact: true }).selectOption("wireguard");
  await expect(page.getByLabel("WireGuard private key")).toHaveValue("");
  if (!(await page.getByRole("button", { name: "Publish an app port", exact: true }).isVisible())) await page.getByText("Expert tasks", { exact: true }).click();
  await page.getByRole("button", { name: "Publish an app port", exact: true }).click();
  await page.getByLabel("Host port", { exact: true }).fill("5800");
  await page.getByLabel("Container port", { exact: true }).fill("5800");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator(".snippet-card .code-block")).toContainText("5800:5800/tcp");
  await expect(page.locator(".snippet-card .code-block")).not.toContainText("VPN_SERVICE_PROVIDER");
  await expect(page.getByText("Compose fragment.", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "Protocol", exact: true }).selectOption("udp");
  await page.getByLabel("Paste Compose YAML (optional)").fill("services:\n  gluetun:\n    image: qmcgaw/gluetun:latest\n  other:\n    image: example/app:latest\n    ports: [\"5800:5800/tcp\"]\n");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator(".snippet-card .code-block")).toContainText("5800:5800/udp");
});

test("mobile navigation and settings sheet remain usable", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lavender" })).toBeVisible();
  for (const theme of ["Mint", "Sky", "Amber", "Rose", "Graphite", "Lavender"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
  }
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
  const undersized = await page.locator("button:visible, input:not([type=checkbox]):visible, select:visible, textarea:visible").evaluateAll((elements) =>
    elements
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { tag: element.tagName, text: element.textContent?.trim(), width: box.width, height: box.height };
      })
      .filter((box) => box.width < 44 || box.height < 44)
  );
  expect(undersized).toEqual([]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath("mobile-settings.png"), fullPage: false });
  await page.getByRole("heading", { name: "Gluetun diagnostics" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Refresh diagnostics" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-gluetun-diagnostics.png"), fullPage: false });
  await context.close();
});

test("all themes and modes retain accessible responsive overview layouts", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".ip-status-card")).toBeVisible();
  const viewports = [{ width: 390, height: 844 }, { width: 412, height: 915 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }];
  for (const theme of ["lavender", "mint", "sky", "amber", "rose", "graphite"]) {
    for (const mode of ["light", "dark"]) {
      await page.evaluate(({ theme, mode }) => {
        document.documentElement.setAttribute("data-theme", theme);
        document.documentElement.setAttribute("data-mode", mode);
        document.documentElement.setAttribute("data-resolved-mode", mode);
        document.documentElement.style.colorScheme = mode;
      }, { theme, mode });
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`overview-${theme}-${mode}-${viewport.width}.png`), fullPage: true, animations: "disabled" });
        if (viewport.width === 390 || viewport.width === 1920) {
          const accessibility = await new AxeBuilder({ page }).analyze();
          expect(accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
        }
      }
    }
  }
});

test("port notes can be edited and removed, and failed sign-out does not pretend to revoke the session", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Ports", exact: true }).first().click();
  await page.getByRole("button", { name: "Edit Example Web UI", exact: true }).click();
  await page.getByLabel("Label", { exact: true }).fill("Updated synthetic note");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Updated synthetic note", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Updated synthetic note", exact: true }).click();
  await expect(page.getByText("Updated synthetic note", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.route("**/api/v1/auth/logout", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "synthetic_failure", message: "Synthetic offline error" } }) }));
  const confirmation = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Sign out", exact: true }) });
  await confirmation.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Sign-out could not be completed. Your session is still active; please try again.")).toBeVisible();
  await expect(confirmation).toBeVisible();
  await page.unroute("**/api/v1/auth/logout");
  await confirmation.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("managed preview requires renewed confirmation after edits and shows the operation outcome", async ({ page }) => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  let applied = false;
  await page.route("**/api/v1/management", (route) => route.fulfill({ json: { enabled: true, candidates: [], projects: [{ id: projectId, vpnId: "a".repeat(64), clientIds: [], composeProject: "synthetic-vpn" }], operations: applied ? [{ id: projectId, projectId, planId: projectId, status: "succeeded", step: "VPN healthy; applications recreated.", startedAt: new Date().toISOString(), error: null }] : [] } }));
  await page.route("**/api/v1/management/plan", (route) => route.fulfill({ json: { plan: { id: projectId, projectId, expiresAt: new Date(Date.now() + 300_000).toISOString(), environmentKeys: ["SERVER_COUNTRIES"], portsChanged: false, portsBefore: {}, portsAfter: {}, services: [{ name: "synthetic-gluetun", image: "qmcgaw/gluetun:latest", running: true }], interruptionRequired: true, warnings: ["The VPN and its applications will restart."] } } }));
  await page.route("**/api/v1/management/apply", (route) => {
    expect(route.request().postDataJSON()).toEqual({ planId: projectId, confirmed: true });
    applied = true;
    return route.fulfill({ status: 202, json: { operation: { id: projectId, status: "applying" } } });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByRole("button", { name: "Manage an existing stack", exact: true }).click();
  await page.getByRole("combobox", { name: "Managed VPN stack", exact: true }).selectOption(projectId);
  await page.getByRole("button", { name: "Review change plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review affected services" })).toBeVisible();
  const apply = page.getByRole("button", { name: "Apply confirmed change", exact: true });
  await expect(apply).toBeDisabled();
  await page.getByLabel("I confirm these changes and the expected service interruption.", { exact: true }).check();
  await expect(apply).toBeEnabled();
  await page.getByLabel("VPN service provider").selectOption("mullvad");
  await expect(page.getByRole("heading", { name: "Review affected services" })).toHaveCount(0);
  expect(applied).toBe(false);
  await page.getByRole("button", { name: "Review change plan", exact: true }).click();
  await expect(apply).toBeDisabled();
  for (const width of [390, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  const accessibility = await new AxeBuilder({ page }).include('[aria-labelledby="managed-stack-title"]').analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  await page.getByLabel("I confirm these changes and the expected service interruption.", { exact: true }).check();
  await apply.click();
  await expect(page.getByText("VPN healthy; applications recreated.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review affected services" })).toHaveCount(0);
});

test("local HTTP works on an ordinary host without a secure browser context", async ({ playwright }) => {
  const browser = await playwright.chromium.launch({ args: ["--host-resolver-rules=MAP tuniku.local.test 127.0.0.1", "--no-proxy-server"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const response = await page.goto("http://tuniku.local.test:4173/");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["strict-transport-security"]).toBeUndefined();
    expect(response?.headers()["content-security-policy"]).not.toContain("upgrade-insecure-requests");
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("a unique e2e admin password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".ip-status-card")).toBeVisible();
    const cookie = (await context.cookies()).find((value) => value.name === "tuniku_session");
    expect(cookie).toMatchObject({ secure: false, httpOnly: true, sameSite: "Lax" });
    await page.reload();
    await expect(page.locator(".ip-status-card")).toBeVisible();
    await page.evaluate(() => {
      const original = document.execCommand.bind(document);
      (window as any).httpCopies = 0;
      document.execCommand = (command, ...args) => {
        if (command === "copy") (window as any).httpCopies++;
        return original(command, ...args);
      };
    });
    await page.getByRole("button", { name: /Copy.*IP/i }).click();
    expect(await page.evaluate(() => (window as any).httpCopies)).toBe(1);
    await expect(page.locator(".toast")).toContainText("Copied");
    await page.evaluate(() => { document.execCommand = () => false; });
    await page.getByRole("button", { name: /Copy.*IP/i }).click();
    await expect(page.getByText("Copy is unavailable in this browser. Select and copy the text manually.", { exact: true })).toBeVisible();
    await page.evaluate(() => { document.execCommand = () => { throw new Error("Synthetic HTTP copy exception."); }; });
    await page.getByRole("button", { name: /Copy.*IP/i }).click();
    await expect(page.getByText("Synthetic HTTP copy exception.", { exact: true })).toBeVisible();
    expect(await page.locator('textarea[readonly]').count()).toBe(0);
  } finally { await context.close(); await browser.close(); }
});

test("WireGuard import validates before replacing fields and clears secret source after confirmation", async ({ page }) => {
  const privateKey = Buffer.alloc(32, 4).toString("base64");
  const source = `[Interface]\nPrivateKey = ${privateKey}\nAddress = 10.0.0.2/32\nDNS = 10.0.0.1\n[Peer]\nPublicKey = ${Buffer.alloc(32, 5).toString("base64")}\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 203.0.113.1:51820\n`;
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByText("Import WireGuard configuration", { exact: true }).click();
  const pasted = page.getByLabel("WireGuard configuration to import");
  await pasted.fill(source + "PostUp = echo synthetic-hook-secret\n");
  await page.getByLabel("I reviewed the import limits and will keep Gluetun's DNS settings.").check();
  await page.getByRole("button", { name: "Import reviewed configuration", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("does not support hooks");
  await expect(page.getByLabel("VPN service provider")).toHaveValue("");
  await pasted.fill(source);
  await expect(page.getByRole("button", { name: "Import reviewed configuration", exact: true })).toBeDisabled();
  await page.getByLabel("I reviewed the import limits and will keep Gluetun's DNS settings.").check();
  await page.getByRole("button", { name: "Import reviewed configuration", exact: true }).click();
  await expect(pasted).toHaveValue("");
  await expect(page.getByLabel("VPN service provider")).toHaveValue("custom");
  await expect(page.getByLabel("WireGuard private key", { exact: true })).toHaveValue(privateKey);
  await expect(page.getByLabel("Endpoint IP", { exact: true })).toHaveValue("203.0.113.1");
  await expect(page.getByRole("status").filter({ hasText: "WireGuard values imported" })).toContainText("DNS addresses are not applied");
  await page.getByLabel("API key", { exact: true }).fill("synthetic-import-control-key");
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click();
  await expect(page.locator(".snippet-card .code-block")).toContainText("WIREGUARD_ENDPOINT_IP");
  await expect(page.locator(".snippet-card .code-block")).not.toContainText(privateKey);
  for (const width of [390, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  const accessibility = await new AxeBuilder({ page }).include(".assistant-form").analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
});

test("overview diagnostics open directly and logs support bounded refresh, filtering and redacted export", async ({ page }, testInfo) => {
  let fail = false;
  const queries: URL[] = [];
  const observation = { available: true, storage: { state: "temporary", writable: null, message: "Gluetun data uses a temporary mount. Stop writers, back up the data and approve a persistent-storage migration. Tuniku has not copied or changed files." }, container: { id: "abcdef123456", name: "vpnunit", state: "exited", displayState: "Failed", health: "unhealthy", exitCode: 1, restartCount: 3, error: "" }, association: { state: "matched", message: "The saved Control API address and port match the selected Docker container." }, issues: ["The VPN provider rejected the configured credentials."], logs: "2026-10-07T10:00:00Z INFO Starting VPN\n2026-10-07T10:00:01Z ERROR OPENVPN_PASSWORD=[REDACTED]\n2026-10-07T10:00:02Z INFO retrying", logsError: null };
  await page.route("**/api/v1/admin/docker-observation*", async (route) => {
    queries.push(new URL(route.request().url()));
    await route.fulfill({ status: fail ? 502 : 200, contentType: "application/json", body: JSON.stringify(fail ? { error: { code: "docker_unavailable", message: "Synthetic Docker unavailable" } } : { observation }) });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Sign in" }).click();
  const summary = page.locator('section[aria-labelledby="docker-diagnostics-heading"]');
  await expect(summary.getByText("vpnunit · Failed")).toBeVisible();
  await expect(summary.getByText("unhealthy", { exact: true })).toBeVisible();
  expect(queries.some((url) => url.searchParams.get("includeLogs") === "false")).toBe(true);
  await page.getByRole("button", { name: "Open diagnostics and logs" }).click();
  await expect(page.getByRole("heading", { name: "Gluetun diagnostics", exact: true })).toBeFocused();
  await expect(page.getByText(/Gluetun data uses a temporary mount/)).toBeVisible();
  await page.getByLabel("Log time range").selectOption("900");
  await page.getByLabel("Maximum log lines").selectOption("500");
  await page.getByRole("button", { name: "Refresh diagnostics", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh diagnostics", exact: true })).toBeEnabled();
  const loaded = queries.findLast((url) => url.searchParams.get("tail") === "500");
  expect(loaded).toBeDefined();
  expect(Number(loaded!.searchParams.get("since"))).toBeGreaterThan(Math.floor(Date.now() / 1000) - 930);
  await page.getByLabel("Filter displayed logs").fill("error");
  await expect(page.locator(".diagnostics-log")).toContainText("[REDACTED]");
  await expect(page.locator(".diagnostics-log")).not.toContainText("Starting VPN");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export filtered redacted logs" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("gluetun-redacted-logs.txt");
  const stream = await download.createReadStream();
  let content = ""; for await (const chunk of stream!) content += chunk.toString();
  expect(content).toContain("OPENVPN_PASSWORD=[REDACTED]"); expect(content).not.toContain("Starting VPN");
  fail = true;
  await page.getByRole("button", { name: "Refresh diagnostics", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Previous diagnostic details and logs may be outdated");
  await expect(page.locator(".diagnostics-log")).toContainText("[REDACTED]");
  await expect(page.getByRole("button", { name: "Export filtered redacted logs" })).toBeDisabled();
  for (const width of [390, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.locator(".sheet")).toHaveCSS("opacity", "1");
    await expect(page.locator(".sheet-backdrop")).toHaveCSS("opacity", "1");
    expect(await page.locator(".sheet-content").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`diagnostics-logs-${width}.png`), fullPage: false, animations: "disabled" });
  }
  const accessibility = await new AxeBuilder({ page }).include(".gluetun-diagnostics").analyze();
  expect(accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact || ""))).toEqual([]);
});


test("PWA caches only its bounded static shell and keeps API access online-only", async ({ page, context }) => {
  await page.goto("/manifest.webmanifest");
  await page.evaluate(async () => {
    await (await caches.open("another-app-cache")).put("/unrelated-marker", new Response("synthetic other app"));
    await (await caches.open("tuniku-shell-obsolete")).put("/obsolete-marker", new Response("old shell"));
  });
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const cacheState = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = await caches.open("tuniku-shell-v2");
    return { names, paths: (await shell.keys()).map((request) => new URL(request.url).pathname) };
  });
  expect(cacheState.names).toContain("another-app-cache"); expect(cacheState.names).not.toContain("tuniku-shell-obsolete");
  expect(cacheState.paths).toContain("/"); expect(cacheState.paths).toContain("/manifest.webmanifest");
  expect(cacheState.paths.some((path) => path.startsWith("/api/") || /\.(?:js|css)$/.test(path))).toBe(false);
  await context.setOffline(true);
  try {
    const offline = await page.evaluate(async () => {
      const manifest = await fetch("/manifest.webmanifest").then((response) => response.ok).catch(() => false);
      const api = await fetch("/api/v1/bootstrap").then(() => true).catch(() => false);
      return { manifest, api };
    });
    expect(offline).toEqual({ manifest: true, api: false });
  } finally { await context.setOffline(false); }
});


test("adopted application diagnostics expose stale namespaces without applying a change", async ({ page }, testInfo) => {
  const projectId = "22222222-2222-4222-8222-222222222222";
  let inspections = 0, mutations = 0;
  await page.route("**/api/v1/management", (route) => route.fulfill({ json: { enabled: true, candidates: [], projects: [{ id: projectId, vpnId: "a".repeat(64), clientIds: ["b".repeat(64)], composeProject: "synthetic-vpn" }], operations: [] } }));
  await page.route("**/api/v1/management/diagnostics", (route) => { inspections++; return route.fulfill({ json: { diagnostics: { projectId, observedAt: new Date().toISOString(), stale: false, vpn: { id: "a".repeat(64), name: "vpn", availability: "available", state: "running", health: "healthy", exitCode: 0, namespace: "vpn", issue: null }, applications: [{ id: "b".repeat(64), name: "jdownloader", availability: "available", state: "stopped", health: null, exitCode: 1, namespace: "different", issue: "This application references a different or outdated VPN namespace. Review and recreate its network association before applying a managed change." }] } } }); });
  await page.route("**/api/v1/management/apply", (route) => { mutations++; return route.fulfill({ status: 409 }); });
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await page.getByRole("button", { name: "Manage an existing stack", exact: true }).click();
  await page.getByRole("combobox", { name: "Managed VPN stack" }).selectOption(projectId);
  await page.getByRole("button", { name: "Inspect managed applications" }).click();
  await expect(page.getByRole("heading", { name: "Managed application diagnostics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "jdownloader", exact: true })).toBeVisible();
  await expect(page.getByText("This application references a different or outdated VPN namespace.", { exact: false })).toBeVisible();
  expect(inspections).toBe(1); expect(mutations).toBe(0);
  for (const width of [390, 768, 1920]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`managed-diagnostics-${width}.png`), fullPage: true, animations: "disabled" }); }
  const accessibility = await new AxeBuilder({ page }).include('section[aria-labelledby="managed-stack-title"]').analyze();
  expect(accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact || ""))).toEqual([]);
});

test("refresh failures retain marked last-known values while successful sources remain visible", async ({ page }) => {
  let fail = false;
  await page.route("**/api/v1/admin/docker-observation*", (route) => route.fulfill({ status: fail ? 502 : 200, json: fail ? { error: { message: "The Docker observer helper cannot be resolved. Check its deployment." } } : { observation: { available: true, container: null, issues: ["No Gluetun container was found."], logsError: null } } }));
  const traffic = { available: true, source: "docker_stats", sampleQuality: "continuous", sampleIntervalSeconds: 10, observedAt: new Date().toISOString(), downloadBytesPerSecond: 1024, uploadBytesPerSecond: 512, todayDownloadedBytes: 100, todayUploadedBytes: 50, trackedDownloadedBytes: 200, trackedUploadedBytes: 100, error: null };
  await page.route("**/api/v1/instances/*/ports*", (route) => route.fulfill({ json: { ports: [{ id: "synthetic-docker-port", sourceType: "docker", hostPort: 5800, containerPort: 5800, protocol: "tcp", hostAddress: "127.0.0.1", label: "Synthetic published mapping" }], detection: { available: true, error: null } } }));
  await page.route("**/api/v1/admin/traffic", (route) => route.fulfill({ status: fail ? 502 : 200, json: fail ? { error: { message: "Synthetic traffic failure" } } : { traffic } }));
  await page.route("**/api/v1/instances/*/overview*", (route) => fail ? route.fulfill({ status: 502, json: { error: { message: "Synthetic API failure" } } }) : route.continue());
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".traffic-card")).toContainText("1 KiB/s");
  fail = true; await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Control API refresh failed.", { exact: false })).toBeVisible();
  await expect(page.locator(".traffic-card")).toContainText("Traffic refresh failed.");
  await expect(page.locator(".traffic-card")).not.toContainText("1 KiB/s");
  await expect(page.locator(".traffic-card")).toContainText("200 B");
  await expect(page.getByText("Last known reachable", { exact: false })).toBeVisible();
  await expect(page.getByText("Docker diagnostics refresh failed.", { exact: false })).toContainText("observer helper cannot be resolved");
  await expect(page.locator(".port-status-card")).toContainText("5800");
  fail = false; await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".traffic-card")).toContainText("1 KiB/s");
  await expect(page.getByText("Control API refresh failed.", { exact: false })).toHaveCount(0);
});


test("daily history uses recorded server-local days and remains readable without current counters", async ({ page }, testInfo) => {
  await page.route("**/api/v1/admin/traffic", (route) => route.fulfill({ json: { traffic: {
    available: false, error: "Synthetic counters are unavailable.", todayDownloadedBytes: 0, todayUploadedBytes: 0, trackedDownloadedBytes: 0, trackedUploadedBytes: 0,
    history: { timeZone: "Europe/Berlin", days: [{ day: "2026-10-07", downloadedBytes: 1024, uploadedBytes: 512 }, { day: "2026-10-05", downloadedBytes: 100, uploadedBytes: 0 }] }
  } } }));
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Daily traffic history" })).toBeVisible();
  await page.getByText("Show recorded days (2)", { exact: true }).focus(); await page.keyboard.press("Enter");
  const history = page.locator(".traffic-history");
  await expect(history.getByRole("row")).toHaveCount(3);
  await expect(history.getByRole("row", { name: "2026-10-07 1 KiB 512 B" })).toBeVisible();
  await expect(history.getByText("2026-10-06")).toHaveCount(0);
  await expect(page.getByText("Today and the preceding 89 days", { exact: false })).toContainText("Europe/Berlin");
  for (const width of [390, 768, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`daily-history-${width}.png`), fullPage: true });
  }
  const axe = await new AxeBuilder({ page }).include(".traffic-history").analyze();
  expect(axe.violations.filter((issue) => ["serious", "critical"].includes(issue.impact || ""))).toEqual([]);
});

test("background polling separates metadata intervals and manual refresh requests a fresh observation", async ({ page }) => {
  let ports = 0, metadata = 0, traffic = 0;
  await page.route("**/api/v1/instances/*/ports*", (route) => { ports++; return route.continue(); });
  await page.route("**/api/v1/admin/docker-observation*", (route) => { metadata++; return route.continue(); });
  await page.route("**/api/v1/admin/traffic", (route) => { traffic++; return route.continue(); });
  await page.clock.install();
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect.poll(() => ports).toBeGreaterThan(0);
  await expect.poll(() => metadata).toBeGreaterThan(0);
  await expect.poll(() => traffic).toBeGreaterThan(0);
  const initial = { ports, metadata, traffic };
  await page.clock.fastForward(11_000);
  await expect.poll(() => traffic).toBeGreaterThan(initial.traffic);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  expect(ports).toBe(initial.ports); expect(metadata).toBe(initial.metadata);
  await page.clock.fastForward(31_000);
  await expect.poll(() => metadata).toBeGreaterThan(initial.metadata);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  const manual = { ports, metadata };
  const freshPorts = page.waitForRequest((request) => request.url().includes("/ports?force=true"));
  const freshMetadata = page.waitForRequest((request) => request.url().includes("/docker-observation?") && request.url().includes("force=true"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await Promise.all([freshPorts, freshMetadata]);
  await expect.poll(() => ports).toBeGreaterThan(manual.ports); await expect.poll(() => metadata).toBeGreaterThan(manual.metadata);
});

test("saving a connection aborts an older overview and prevents its late values from returning", async ({ page }) => {
  let hold = false, held = false, release!: () => void;
  const delayed = new Promise<void>((done) => { release = done; });
  const aborted: string[] = [];
  page.on("requestfailed", (request) => { if (request.url().includes("/overview")) aborted.push(request.url()); });
  await page.route("**/api/v1/instances/*/overview*", async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    if (hold) { hold = false; held = true; payload.overview.publicIp.city = "Old delayed location"; await delayed; }
    else payload.overview.publicIp.city = "Current connection location";
    await route.fulfill({ json: payload }).catch(() => {});
  });
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Current connection location", { exact: false })).toBeVisible();
  hold = true; await page.getByRole("button", { name: "Refresh", exact: true }).click(); await expect.poll(() => held).toBe(true);
  await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
  await page.getByRole("dialog").getByLabel("Display name").fill("Updated synthetic VPN");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => aborted.length).toBeGreaterThan(0);
  await expect(page.getByText("Current connection location", { exact: false })).toBeVisible();
  release(); await expect(page.getByText("Old delayed location", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
});

test("server search debounces typing and ignores an aborted older suggestion response", async ({ page }) => {
  let release!: () => void, held = false, newSearches = 0;
  const delayed = new Promise<void>((done) => { release = done; });
  await page.route("**/api/v1/compose/providers/*/server-options*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const field = query.get("field"), term = query.get("q");
    let values: string[] = [];
    if (field === "countries" && term === "old") { held = true; await delayed; values = ["Old suggestion"]; }
    if (field === "countries" && term === "new") { newSearches++; values = ["Current suggestion"]; }
    await route.fulfill({ json: { options: { values, source: "bundled", sourceRevision: "synthetic", updatedAt: null } } }).catch(() => {});
  });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  const countries = page.getByRole("combobox", { name: /^Server countries/ });
  await countries.fill("old"); await page.clock.fastForward(300); await expect.poll(() => held).toBe(true);
  await countries.fill("new"); await page.clock.fastForward(249); expect(newSearches).toBe(0);
  await page.clock.fastForward(2); await expect.poll(() => newSearches).toBe(1);
  const listId = await countries.getAttribute("list");
  await expect(page.locator(`datalist[id="${listId}"] option`)).toHaveAttribute("value", "Current suggestion");
  release(); await expect(page.locator(`datalist[id="${listId}"] option`)).toHaveAttribute("value", "Current suggestion");
});

test("broader server filters clear old geographic choices and show compatible catalog suggestions", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByLabel("VPN service provider").selectOption("mullvad");
  const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
  await page.getByLabel("WireGuard private key").fill(key);
  await page.getByRole("combobox", { name: /^Server countries/ }).fill("UK");
  const cities = page.getByRole("combobox", { name: /^Server cities/ });
  const hostnames = page.getByRole("combobox", { name: /^Server hostnames/ });
  await cities.fill("London"); await hostnames.fill("synthetic-old-host");
  await page.getByRole("combobox", { name: /^Server countries/ }).fill("");
  await page.getByRole("combobox", { name: /^Server countries/ }).pressSequentially("Sweden");
  await expect(cities).toHaveValue(""); await expect(hostnames).toHaveValue("");
  await expect(page.getByText(/Cleared narrower server selections/)).toBeVisible();
  await expect(page.getByLabel("WireGuard private key")).toHaveValue(key);
  const listId = await cities.getAttribute("list");
  await expect(page.locator(`datalist[id="${listId}"] option[value="Stockholm"]`)).toHaveCount(1);
  await expect(page.locator(`datalist[id="${listId}"] option[value="London"]`)).toHaveCount(0);
  await cities.fill("Stockholm"); await hostnames.fill("synthetic-current-host");
  await cities.fill("Gothenburg"); await expect(hostnames).toHaveValue("");
});

test("saved drafts reopen safe settings and navigation retains inputs without browser persistence", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
  const secret = "synthetic-draft-api-key-never-persist";
  await page.getByLabel("WireGuard private key", { exact: true }).fill(key); await page.getByLabel("API key", { exact: true }).fill(secret);
  await page.getByLabel("Save a redacted draft", { exact: true }).check();
  const title = ("Saved VPN settings " + "with a longer readable title ".repeat(3)).trim();
  await page.getByLabel("Draft title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click();
  if (!(await page.getByRole("button", { name: `Open draft: ${title}`, exact: true }).isVisible())) await page.getByText("Saved export drafts", { exact: true }).click();
  await expect(page.getByRole("button", { name: `Open draft: ${title}`, exact: true })).toBeVisible();
  const list = await (await page.request.get("/api/v1/compose/drafts?summary=true")).json();
  const saved = list.drafts.find((draft: { title: string }) => draft.title === title);
  const draft = await (await page.request.get(`/api/v1/compose/drafts/${saved.id}`)).json();
  expect(JSON.stringify(draft)).not.toContain(secret); expect(JSON.stringify(draft)).not.toContain(key);
  await page.getByRole("button", { name: "Overview", exact: true }).first().click();
  await expect(page.getByLabel("WireGuard private key", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await expect(page.getByLabel("WireGuard private key", { exact: true })).toHaveValue(key);
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(secret);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toContain(secret); expect(storage).not.toContain(key);
  if (!(await page.getByRole("button", { name: `Open draft: ${title}`, exact: true }).isVisible())) await page.getByText("Saved export drafts", { exact: true }).click();
  await page.getByRole("button", { name: `Open draft: ${title}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Replace current inputs?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(secret);
  if (!(await page.getByRole("button", { name: `Open draft: ${title}`, exact: true }).isVisible())) await page.getByText("Saved export drafts", { exact: true }).click();
  await page.getByRole("button", { name: `Open draft: ${title}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open draft", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("WireGuard private key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Include secret values in this response", { exact: true })).not.toBeChecked();
  await expect(page.locator(".result-panel")).toHaveCount(0);
  await expect(page.getByText("Saving creates a new redacted draft.", { exact: false })).toBeVisible();
  await page.getByLabel("WireGuard private key", { exact: true }).fill(key); await page.getByLabel("API key", { exact: true }).fill(secret);
  await page.getByLabel("Save a redacted draft", { exact: true }).check(); await page.getByLabel("Draft title", { exact: true }).fill("Edited VPN settings");
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open draft: Edited VPN settings", exact: true })).toBeVisible();
  const later = await (await page.request.get("/api/v1/compose/drafts?summary=true")).json(); expect(later.drafts).toHaveLength(list.drafts.length + 1);
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 });
  for (const width of [390, 412, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 412 ? 915 : 1080 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.locator(".saved-drafts").screenshot({ path: testInfo.outputPath(`saved-drafts-${width}.png`) });
  }
  const axe = await new AxeBuilder({ page }).include(".saved-drafts").analyze();
  expect(axe.violations.filter((issue) => ["serious", "critical"].includes(issue.impact || ""))).toEqual([]);
  const dialog = page.waitForEvent("dialog");
  const reload = page.reload({ waitUntil: "commit", timeout: 3000 }).catch((error: Error) => { expect(error.message).toMatch(/Timeout|ERR_ABORTED|cancel/i); });
  const warning = await dialog; expect(warning.type()).toBe("beforeunload"); await warning.dismiss(); await reload;
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue(secret);
});

test("saved draft rows retain readable layouts and contrast in every theme and mode", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByText("Saved export drafts", { exact: true }).click();
  await expect(page.locator(".draft-row")).toHaveCount(2);
  for (const theme of ["Lavender", "Mint", "Sky", "Amber", "Rose", "Graphite"]) for (const mode of ["Light", "Dark"]) {
    await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: theme, exact: true }).click();
    await settings.getByRole("button", { name: mode, exact: true }).click();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode.toLowerCase());
    for (const [width, height] of [[390, 844], [412, 915], [768, 1024], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width: width!, height: height! });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.locator(".saved-drafts").screenshot({ path: testInfo.outputPath(`drafts-${theme.toLowerCase()}-${mode.toLowerCase()}-${width}.png`) });
    }
    const axe = await new AxeBuilder({ page }).include(".saved-drafts").analyze(); expect(axe.violations).toEqual([]);
  }
});

test("field errors remain readable and associated with inputs until correction or retry", async ({ page }, testInfo) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  const key = page.getByLabel("WireGuard private key", { exact: true });
  await key.fill("synthetic-invalid-private-key"); await page.getByLabel("API key", { exact: true }).fill("synthetic-field-api-key");
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  const errorId = await key.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy(); await expect(page.locator(`[id="${errorId}"]`)).toContainText("canonical base64");
  await page.getByLabel("API key", { exact: true }).fill("synthetic-field-api-key-edited");
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await page.setViewportSize({ width: 390, height: 844 }); await key.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("persistent-field-error-mobile.png") });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await key.fill("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="); await expect(key).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click(); await expect(page.locator(".validation-chip")).toBeVisible();
  await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
  const url = page.getByLabel("Control Server base URL", { exact: true });
  await url.fill("http://user:synthetic-url-secret@example.test:8000"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(url).toHaveAttribute("aria-invalid", "true"); await expect(page.getByRole("alert").filter({ hasText: "Review these settings" })).toBeVisible();
  await page.getByLabel("Display name", { exact: true }).fill("Editing another field"); await expect(url).toHaveAttribute("aria-invalid", "true");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await url.fill("http://127.0.0.1:8199"); await expect(url).not.toHaveAttribute("aria-invalid", "true");
});

test("secret consent is consumed and manual or idle cleanup prevents late output restoration", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  if (!(await page.getByRole("button", { name: "Configure Control Server authentication", exact: true }).isVisible())) await page.getByText("Expert tasks", { exact: true }).click();
  await page.getByRole("button", { name: "Configure Control Server authentication", exact: true }).click();
  const key = page.getByLabel("API key", { exact: true });
  const consent = page.getByLabel("Include secret values in this response", { exact: true });
  const generate = page.getByRole("button", { name: "Generate guidance", exact: true });
  await key.fill("synthetic-consent-api-secret"); await consent.check(); await generate.click();
  await expect(page.locator(".code-block").filter({ hasText: "synthetic-consent-api-secret" })).toHaveCount(1); await expect(consent).not.toBeChecked();
  await generate.click(); await expect(page.locator(".result-redaction")).toBeVisible();
  await expect(page.locator(".code-block").filter({ hasText: "synthetic-consent-api-secret" })).toHaveCount(0);
  await page.route("**/api/v1/compose/generate", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "synthetic_failure", message: "Synthetic generation failure" } }) }));
  await consent.check(); await generate.click(); await expect(page.getByRole("alert").filter({ hasText: "Synthetic generation failure" })).toBeVisible(); await expect(consent).not.toBeChecked();
  await page.unroute("**/api/v1/compose/generate");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const intercepted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/v1/compose/generate", async (route) => { started(); await held; await route.continue(); });
  await consent.check(); await generate.click(); await intercepted;
  await page.getByRole("button", { name: "Clear sensitive data", exact: true }).click(); await expect(key).toHaveValue(""); await expect(consent).not.toBeChecked();
  const response = page.waitForResponse("**/api/v1/compose/generate"); release(); await response; await expect(generate).toBeEnabled();
  await expect(page.locator(".validation-chip")).toHaveCount(0);
  await page.unroute("**/api/v1/compose/generate");
  await page.clock.install();
  await key.fill("synthetic-idle-api-secret");
  const source = page.getByLabel("Paste Compose YAML (optional)", { exact: true });
  await source.fill("services: {} # synthetic-idle-compose-secret"); await consent.check();
  await generate.click(); await expect(page.locator(".code-block").filter({ hasText: "synthetic-idle-api-secret" })).toHaveCount(1);
  await page.clock.fastForward(14 * 60_000); await expect(key).toHaveValue("synthetic-idle-api-secret");
  await expect(page.locator(".code-block").filter({ hasText: "synthetic-idle-api-secret" })).toHaveCount(1);
  await page.getByRole("button", { name: "Overview", exact: true }).first().click();
  await page.clock.fastForward(61_000);
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await expect(key).toHaveValue(""); await expect(source).toHaveValue(""); await expect(consent).not.toBeChecked();
  await expect(page.locator(".validation-chip")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Sensitive inputs and output cleared after 15 minutes" })).toBeVisible();
});

test("connection settings explain memory lifetime and can clear transient credentials", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
  await expect(page.getByText(/Test connection checks these inputs without saving/)).toBeVisible();
  await expect(page.getByText("Local HTTP · Local HTTP policy", { exact: true })).toBeVisible();
  await expect(page.locator("dl div").filter({ has: page.getByText("SQLite journal", { exact: true }) })).toContainText("wal");
  await page.getByLabel("Authentication mode").selectOption("api_key"); await page.getByLabel("API key", { exact: true }).fill("synthetic-memory-ui-key");
  await page.getByLabel("Store credential encrypted").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Credential is held in server memory until restart or explicit clear.")).toBeVisible();
  await page.getByRole("button", { name: "Delete stored credential", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Delete stored credential", exact: true })).toHaveCount(0);
  await page.getByLabel("Authentication mode").selectOption("none"); await page.getByRole("button", { name: "Save", exact: true }).click();
});

test("guided setup preserves progress and distinguishes observed VPN state from application verification", async ({ page }, testInfo) => {
  let stale = false;
  const writes: string[] = [];
  page.on("request", request => { if (["POST", "PUT", "DELETE"].includes(request.method()) && /\/instances\//.test(request.url())) writes.push(request.url()); });
  await page.route("**/api/v1/instances/*/overview*", route => route.fulfill({ json: { overview: { instanceId: "11111111-1111-4111-8111-111111111111", connected: true, stale, lastUpdatedAt: new Date().toISOString(), error: null, vpn: { status: "running" }, publicIp: { publicIp: "203.0.113.7", country: "Synthetic", region: null, city: null }, dns: null, updater: null, portForwarding: null, settings: null, capabilities: {} } } }));
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  const guide = page.getByRole("region", { name: "Your VPN setup" });
  await expect(guide.getByRole("button", { name: "1. Set up VPN" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Expert tasks", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish an app port", exact: true })).toBeHidden();
  await guide.getByRole("button", { name: "2. Connect application" }).click();
  await page.getByLabel("Application service name").fill("synthetic-client");
  await page.getByLabel("Application image").fill("synthetic/client:local");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator(".snippet-card .code-block")).toContainText("network_mode: service:gluetun");
  await expect(guide).toContainText("same Compose project");
  await guide.getByRole("button", { name: "Next: verify deployment" }).click();
  await guide.getByRole("button", { name: "Refresh deployment checks" }).click();
  await expect(guide).toContainText("Control Server response received");
  await expect(guide).toContainText("203.0.113.7");
  await expect(guide).toContainText("They do not prove that your application uses this VPN");
  await guide.getByRole("button", { name: "Inspect application ports" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await expect(guide.getByRole("button", { name: "3. Verify" })).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Application service name")).toHaveValue("synthetic-client");
  stale = true;
  await guide.getByRole("button", { name: "Refresh deployment checks" }).click();
  await expect(guide).toContainText("No current successful check");
  await expect(guide.getByRole("alert")).toContainText("outdated");
  await expect(guide).not.toContainText("203.0.113.7");
  for (const viewport of [{ width: 390, height: 844 }, { width: 412, height: 915 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 960, height: 540 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include('.setup-workflow').analyze()).violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`guided-verify-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["lavender", "mint", "sky", "amber", "rose", "graphite"]) for (const mode of ["light", "dark"]) {
    await page.evaluate(({ theme, mode }) => { document.documentElement.setAttribute("data-theme", theme); document.documentElement.setAttribute("data-mode", mode); document.documentElement.setAttribute("data-resolved-mode", mode); document.documentElement.style.colorScheme = mode; }, { theme, mode });
    // Theme backgrounds transition over 160ms. Inspect the settled theme,
    // rather than a light/dark interpolation frame with the new text color.
    await page.waitForFunction(() => [...document.querySelectorAll('.setup-workflow .button')].every(button => button.getAnimations().every(animation => animation.playState === "finished")));
    expect((await new AxeBuilder({ page }).include('.setup-workflow').analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`guided-${theme}-${mode}.png`) });
  }
  expect(writes).toEqual([]);
});

test("setup connection handoff requires review and explicit saving, and clears transferred form secrets", async ({ page }) => {
  const writes: string[] = [];
  const tests: string[] = [];
  page.on("request", request => { if (request.method() === "PUT" && /\/instances\//.test(request.url())) writes.push(request.url()); });
  page.on("request", request => { if (request.method() === "POST" && /\/instances\/[^/]+\/test$/.test(request.url())) tests.push(request.url()); });
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  const vpnKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
  const controlKey = "synthetic-handoff-control-key";
  await page.getByLabel("WireGuard private key").fill(vpnKey); await page.getByLabel("API key", { exact: true }).fill(controlKey);
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await page.getByRole("button", { name: "Use setup connection" }).click();
  const review = page.getByRole("dialog", { name: "Review setup connection" });
  await expect(review).toContainText("Nothing is tested or saved automatically");
  await expect(review).not.toContainText(controlKey); await expect(review).not.toContainText(vpnKey);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toEqual([]);
  const before = (await (await page.request.get("/api/v1/instances")).json()).instances;
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const transfer = async () => { await page.getByRole("button", { name: "Use setup connection" }).click(); await review.getByRole("button", { name: "Use these inputs in Settings" }).click(); await expect(settings.getByLabel("API key", { exact: true })).toHaveValue(controlKey); };
  await transfer();
  await expect(settings.getByLabel("Control Server base URL")).toHaveValue("http://gluetun:8000");
  await expect(settings.getByLabel("Store credential encrypted")).not.toBeChecked();
  expect(await settings.locator("input").evaluateAll(inputs => inputs.map(input => input.value))).not.toContain(vpnKey);
  const configuration = ({ lastConnectedAt: _connected, updatedAt: _updated, capabilityCache: _capabilities, ...settings }: Record<string, unknown>) => settings;
  expect((await (await page.request.get("/api/v1/instances")).json()).instances.map(configuration)).toEqual(before.map(configuration));
  expect(tests).toEqual([]);
  await settings.getByLabel("Control Server base URL").fill("http://127.0.0.1:8199");
  await settings.getByRole("button", { name: "Test connection" }).click();
  await expect(settings.getByText("Reachable · Authentication accepted")).toBeVisible();
  expect(tests).toHaveLength(1);
  expect(writes).toEqual([]);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
  await expect(settings.getByLabel("API key", { exact: true })).toHaveValue("");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await transfer(); await settings.getByLabel("Control Server base URL").fill("http://127.0.0.1:8199");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByText("Credential is held in server memory until restart or explicit clear.")).toBeVisible();
  expect(writes).toHaveLength(1);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await transfer();
  await settings.getByLabel("Control Server base URL").fill("http://127.0.0.1:8199");
  let releaseTest: () => Promise<void> = async () => {};
  let markHeld: () => void = () => {};
  const held = new Promise<void>(resolve => { markHeld = resolve; });
  await page.route("**/api/v1/instances/*/test", async route => { const response = await route.fetch(); releaseTest = () => route.fulfill({ response }); markHeld(); });
  await settings.getByRole("button", { name: "Test connection" }).click(); await held;
  await page.clock.fastForward(15 * 60_000 + 1);
  await expect(settings.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(settings.getByText(/Transferred credentials cleared after 15 minutes/)).toBeVisible();
  await releaseTest(); await page.unroute("**/api/v1/instances/*/test");
  await expect(settings.getByRole("button", { name: "Test connection" })).toBeEnabled();
  await expect(settings.getByText("Reachable · Authentication accepted")).toHaveCount(0);
  expect((await (await page.request.get("/api/v1/admin/diagnostics")).json()).gluetun.accessState).toBe("memory_only");
  await settings.getByRole("button", { name: "Delete stored credential", exact: true }).click();
  await settings.getByLabel("Authentication mode").selectOption("none");
  await settings.getByLabel("Control Server base URL").fill("http://127.0.0.1:8199");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
});

test("only trusted interaction sends session activity and expiry clears unsaved secret inputs", async ({ page, request }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.clock.install();
  const activities: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/auth/activity")) activities.push(request.url()); });
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  if (!(await page.getByRole("button", { name: "Configure Control Server authentication", exact: true }).isVisible())) await page.getByText("Expert tasks", { exact: true }).click();
  await page.getByRole("button", { name: "Configure Control Server authentication", exact: true }).click();
  await page.getByLabel("API key", { exact: true }).fill("synthetic-idle-ui-key");
  await page.clock.fastForward(16_000); await expect.poll(() => activities.length).toBeGreaterThan(0);
  const before = activities.length;
  await page.evaluate(() => document.dispatchEvent(new Event("keydown", { bubbles: true })));
  await page.clock.fastForward(2 * 60_000); expect(activities.length).toBe(before);
  const response = page.waitForResponse("**/auth/activity");
  await page.getByLabel("API key", { exact: true }).press("ArrowLeft"); await response;
  expect(activities.length).toBeGreaterThan(before);
  const cookies = await page.context().cookies();
  const cookie = cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
  const session = await request.get("/api/v1/auth/session", { headers: { cookie } });
  expect(session.ok()).toBe(true);
  await request.post("/api/v1/auth/logout", { headers: { cookie, "x-csrf-token": (await session.json()).csrfToken }, data: {} });
  await page.getByLabel("API key", { exact: true }).press("ArrowRight"); await page.clock.fastForward(16_000);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toHaveCount(0);
});


test("draft deletion requires confirmation and cancelled single or bulk deletion preserves data", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  const original = await (await page.request.get("/api/v1/compose/drafts?summary=true")).json();
  expect(original.drafts.length).toBeGreaterThan(0);
  const target = original.drafts[0];
  await page.getByText("Saved export drafts", { exact: true }).click();
  await page.getByRole("button", { name: `Delete draft: ${target.title}`, exact: true }).click();
  const single = page.getByRole("dialog", { name: "Delete saved draft?", exact: true });
  await expect(single).toBeVisible(); await single.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await page.request.get(`/api/v1/compose/drafts/${target.id}`)).status()).toBe(200);
  await page.getByRole("button", { name: `Delete draft: ${target.title}`, exact: true }).click();
  await single.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open draft: ${target.title}`, exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/v1/compose/drafts/${target.id}`)).status()).toBe(404);
  await page.getByRole("button", { name: /Settings: Tuniku Admin/ }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Delete Compose drafts", exact: true }).click();
  const bulk = page.getByRole("dialog", { name: "Delete all saved drafts?", exact: true });
  await expect(bulk).toBeVisible(); await bulk.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await (await page.request.get("/api/v1/compose/drafts?summary=true")).json()).drafts).toHaveLength(original.drafts.length - 1);
  await settings.getByRole("button", { name: "Delete Compose drafts", exact: true }).click();
  await bulk.getByRole("button", { name: "Delete all drafts", exact: true }).click(); await expect(bulk).toHaveCount(0);
  expect((await (await page.request.get("/api/v1/compose/drafts?summary=true")).json()).drafts).toHaveLength(0);
});

test("IPv6 port notes reject invalid input and copy bracketed TCP and UDP mappings", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Ports", exact: true }).first().click();
  await page.getByRole("button", { name: "Add port note", exact: true }).click();
  await page.getByLabel("Label", { exact: true }).fill("Synthetic IPv6 mapping");
  await page.getByLabel("Host address (optional)").fill("2001:db8::invalid");
  await page.getByLabel("Host port", { exact: true }).fill("8585"); await page.getByLabel("Container port", { exact: true }).fill("85");
  const sheet = page.getByRole("dialog", { name: "Add port note", exact: true });
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Host address (optional)")).toHaveAttribute("aria-invalid", "true");
  await expect(sheet.getByText(/Enter a valid IPv4 or IPv6 host address/).first()).toBeVisible();
  await page.getByLabel("Host address (optional)").fill("2001:db8::1"); await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("[2001:db8::1]:8585", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy Synthetic IPv6 mapping", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"[2001:db8::1]:8585:85/tcp"');
  await page.getByRole("button", { name: "Edit Synthetic IPv6 mapping", exact: true }).click(); await page.getByRole("combobox", { name: "Protocol", exact: true }).selectOption("udp");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await page.getByRole("button", { name: "Copy Synthetic IPv6 mapping", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"[2001:db8::1]:8585:85/udp"');
  await page.getByRole("button", { name: "Delete Synthetic IPv6 mapping", exact: true }).click(); await expect(page.getByText("Synthetic IPv6 mapping", { exact: true })).toHaveCount(0);
});


test("local port-note collisions distinguish addresses and retain an associated host-port correction", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Ports", exact: true }).first().click();
  for (const [label, address] of [["Synthetic address one", "127.0.0.1"], ["Synthetic address two", "127.0.0.2"]]) {
    await page.getByRole("button", { name: "Add port note", exact: true }).click();
    await page.getByLabel("Label", { exact: true }).fill(label!); await page.getByLabel("Host address (optional)").fill(address!);
    await page.getByLabel("Host port", { exact: true }).fill("8585"); await page.getByLabel("Container port", { exact: true }).fill("85");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByText(label!, { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Edit Synthetic address two", exact: true }).click(); await page.getByLabel("Host address (optional)").fill("127.0.0.1");
  const sheet = page.getByRole("dialog", { name: "Edit port note", exact: true }); await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Host port", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(sheet.getByText(/A local port note overlaps/).last()).toBeVisible();
  await page.getByLabel("Host address (optional)").fill("127.0.0.2"); await expect(page.getByLabel("Host port", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
  await sheet.getByRole("button", { name: "Save", exact: true }).click(); await expect(sheet).toHaveCount(0);
  for (const label of ["Synthetic address one", "Synthetic address two"]) await page.getByRole("button", { name: `Delete ${label}`, exact: true }).click();
});

test("port workflow reviews handoff and isolates same-host service URLs without applying changes", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Ports", exact: true }).first().click();
  await page.getByRole("button", { name: "Add port note", exact: true }).click();
  await page.getByLabel("Label", { exact: true }).fill("Synthetic web service"); await page.getByLabel("Host address (optional)").fill("127.0.0.1");
  await page.getByLabel("Host port", { exact: true }).fill("8585"); await page.getByLabel("Container port", { exact: true }).fill("85");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Review web address for Synthetic web service", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Review service web address", exact: true });
  await expect(preview.getByLabel("Service URL", { exact: true })).toHaveValue("http://127.0.0.1:8585/");
  await expect(preview.getByRole("button", { name: "Open service", exact: true })).toBeDisabled();
  await preview.getByRole("button", { name: "Copy service URL", exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("http://127.0.0.1:8585/");
  await preview.getByLabel("Reachable service host", { exact: true }).fill("2001:db8::1"); await preview.getByRole("combobox", { name: "Web protocol", exact: true }).selectOption("https");
  await expect(preview.getByLabel("Service URL", { exact: true })).toHaveValue("https://[2001:db8::1]:8585/"); await expect(preview.getByRole("button", { name: "Open service", exact: true })).toBeEnabled();
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  let mutations = 0; page.on("request", request => { if (request.method() === "POST" && /\/compose\/(generate|drafts)|\/management\//.test(request.url())) mutations++; });
  await page.getByRole("button", { name: "Configure Synthetic web service in Assistant", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review port configuration", exact: true }); await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Ports", exact: true }).first().click(); await page.getByRole("button", { name: "Configure Synthetic web service in Assistant", exact: true }).click();
  await review.getByRole("button", { name: "Use in Assistant", exact: true }).click();
  await expect(page.getByLabel("Host port", { exact: true })).toHaveValue("8585"); await expect(page.getByLabel("Container port", { exact: true })).toHaveValue("85"); expect(mutations).toBe(0);
  await page.getByRole("button", { name: "Ports", exact: true }).first().click(); await page.getByRole("button", { name: "Edit Synthetic web service", exact: true }).click(); await page.getByRole("combobox", { name: "Protocol", exact: true }).selectOption("udp"); await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review web address for Synthetic web service", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete Synthetic web service", exact: true }).click();
});

test("explicit any-location choice preserves credentials and category and reviews existing filter removal", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Reported IP location; not proof of the selected VPN server location.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click(); await page.getByLabel("VPN service provider").selectOption("nordvpn");
  await page.getByLabel("WireGuard private key", { exact: true }).fill("synthetic-retained-key");
  const country = page.getByRole("combobox", { name: /^Server countries/ }); const category = page.getByRole("combobox", { name: /^Server categories/ });
  await country.fill("Netherlands"); await category.fill("P2P");
  await page.getByRole("button", { name: "Any supported location", exact: true }).click(); await expect(country).toHaveValue(""); await expect(country).toBeDisabled(); await expect(category).toHaveValue("P2P"); await expect(category).toBeEnabled(); await expect(page.getByLabel("WireGuard private key", { exact: true })).toHaveValue("synthetic-retained-key");
  if (!(await page.getByRole("button", { name: "Set server location", exact: true }).isVisible())) await page.getByText("Expert tasks", { exact: true }).click();
  await page.getByRole("button", { name: "Set server location", exact: true }).click();
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click(); await expect(page.getByText(/A fragment alone does not delete them/).first()).toBeVisible();
  await page.getByRole("button", { name: "Choose location filters", exact: true }).click(); await expect(country).toBeEnabled(); await country.fill("Sweden"); await expect(page.getByRole("button", { name: "Any supported location", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("provider schema review is independent of refreshed server values and exposes its immutable review source", async ({ page }) => {
  await page.route(/\/api\/v1\/compose\/providers\/[^/]+\/server-options(?:\/refresh)?(?:\?.*)?$/, async route => {
    if (route.request().method() === "POST") { await route.fulfill({ json: { refreshed: { sourceRevision: "synthetic-new-catalog", updatedAt: "2035-01-01T00:00:00Z" } } }); return; }
    const field = new URL(route.request().url()).searchParams.get("field");
    await route.fulfill({ json: { options: { providerId: "mullvad", vpnType: "wireguard", field, values: ["Synthetic value"], source: "refreshed", sourceRevision: "synthetic-new-catalog", updatedAt: "2035-01-01T00:00:00Z" } } });
  });
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  const beforeResponse = await page.request.get("/api/v1/compose/providers"); expect(beforeResponse.status()).toBe(200); const before = await beforeResponse.json();
  await page.getByLabel("VPN service provider").selectOption("mullvad");
  await expect(page.getByText(/Provider rules reviewed on 2026-10-07/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Reviewed provider instructions", exact: true })).toHaveAttribute("href", /\/888ab89a61433de6561bf60e5af52d99374f48b1\/setup\/providers\/mullvad.md$/);
  const [refreshResponse] = await Promise.all([page.waitForResponse(response => response.url().endsWith("/server-options/refresh") && response.request().method() === "POST"), page.getByRole("button", { name: "Refresh server data", exact: true }).click()]);
  expect(refreshResponse.status()).toBe(200);
  await expect(page.getByText(/Refreshed catalog.*2035/)).toBeVisible(); await expect(page.getByText(/Provider rules reviewed on 2026-10-07/)).toBeVisible();
  expect((await (await page.request.get("/api/v1/compose/providers")).json()).providers).toEqual(before.providers);
});

test("server catalog shows immutable provenance without claiming agreement with running Gluetun", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByLabel("VPN service provider").selectOption("mullvad");
  const provenance = page.getByLabel("Server catalog provenance", { exact: true });
  await expect(provenance).toContainText("Running Gluetun catalog comparison unavailable");
  await expect(provenance).toContainText("refreshing here updates Tuniku only");
  const response = await page.request.get("/api/v1/compose/providers/mullvad/server-options?vpnType=wireguard&field=countries");
  expect(response.status()).toBe(200); const { options } = await response.json();
  expect(options.runtimeComparison).toBe("unavailable"); expect(options.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
  await expect(provenance).toContainText(options.sourceRevision);
  await expect(provenance).toContainText(`Server data timestamp: ${options.updatedAt}`);
  if (options.source === "bundled") await expect(provenance).toContainText(`Bundled: ${options.bundledAt}`);
  else await expect(provenance).toContainText(`Retrieved: ${options.retrievedAt}`);
  await expect(page.getByRole("link", { name: "View exact server source", exact: true })).toHaveAttribute("href", options.sourceUrl);
});

test("deployment names prepare a consistent proposal and connection handoff without renaming running services", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await page.getByText("Compose service and deployment names", { exact: true }).click();
  await page.getByLabel("VPN service name", { exact: true }).fill("vpn-main"); await page.getByLabel("VPN container name", { exact: true }).fill("vpn-container"); await page.getByLabel("Compose project name", { exact: true }).fill("vpn-project"); await page.getByLabel("Existing Tuniku network name", { exact: true }).fill("existing-shared-network");
  await page.getByLabel("VPN service provider").selectOption("mullvad"); await page.getByLabel("WireGuard private key", { exact: true }).fill("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="); await page.getByLabel("WireGuard addresses", { exact: true }).fill("10.0.0.2/32"); await page.getByLabel("API key", { exact: true }).fill("synthetic-named-control-key");
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click();
  const code = page.locator(".snippet-card .code-block"); await expect(code).toContainText("name: vpn-project"); await expect(code).toContainText("vpn-main:"); await expect(code).toContainText("container_name: vpn-container"); await expect(code).toContainText("name: existing-shared-network");
  await page.getByRole("button", { name: "Use setup connection", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review setup connection", exact: true }); await expect(dialog).toContainText("http://vpn-main:8000"); await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  if (!(await page.getByRole("button", { name: "Publish an app port", exact: true }).isVisible())) await page.getByText("Expert tasks", { exact: true }).click();
  await page.getByRole("button", { name: "Publish an app port", exact: true }).click();
  await page.getByLabel("Paste Compose YAML (optional)", { exact: true }).fill("services:\n  vpn-main:\n    image: qmcgaw/gluetun:latest\n  vpn-other:\n    image: qmcgaw/gluetun:latest\n"); await page.getByLabel("VPN service name", { exact: true }).fill("");
  await page.getByRole("button", { name: "Generate guidance", exact: true }).click(); await expect(page.locator(".field-error").filter({ hasText: "Several Gluetun services exist" })).toBeVisible();
  await page.getByLabel("VPN service name", { exact: true }).fill("vpn-other"); await page.getByRole("button", { name: "Generate guidance", exact: true }).click(); await expect(code).toContainText("vpn-other:"); await expect(code).not.toContainText("vpn-main:");
});


test("managed inventory reviews dependencies and recovery before explicit adoption", async ({ page }) => {
  const vpnId = "a".repeat(64);
  const projectId = "33333333-3333-4333-8333-333333333333";
  const longName = "application-" + "x".repeat(100);
  let crossProject = true;
  let adopted = false;
  let posts = 0;
  const candidate = (id: string, name: string, kind: string, recovery = false) => ({ id: id.repeat(64), name, image: "synthetic:local", state: "running", project: "synthetic-vpn", role: "application", network: { kind, vpnId: kind === "vpn_namespace" ? vpnId : null }, recovery });
  await page.route("**/api/v1/management", route => route.fulfill({ json: { enabled: true, candidates: [
    { ...candidate("a", "vpn", "vpn"), role: "vpn" },
    candidate("b", longName, "vpn_namespace"), candidate("c", "separate-network", "other_network"),
    candidate("d", "different-container", "other_container"), candidate("e", "unknown-namespace", "unknown"),
    candidate("f", "recovery-application", "vpn_namespace", true),
    { ...candidate("8", "recovery-vpn", "vpn", true), role: "vpn" },
    ...(crossProject ? [{ ...candidate("9", "cross-project-client", "vpn_namespace"), project: "other-approved" }] : [])
  ], projects: adopted ? [{ id: projectId, vpnId, clientIds: ["b".repeat(64), "e".repeat(64)], composeProject: "synthetic-vpn" }] : [], operations: [] } }));
  await page.route("**/api/v1/management/adopt", route => {
    posts++;
    expect(route.request().postDataJSON()).toEqual({ vpnId, clientIds: ["b".repeat(64), "e".repeat(64)], confirmed: true });
    adopted = true;
    return route.fulfill({ json: { project: { id: projectId } } });
  });
  await page.goto("/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Sign in" }).click();
  async function openInventory() {
    await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
    await page.getByRole("button", { name: "Manage an existing stack", exact: true }).click();
    await page.getByText("Adopt an existing VPN stack", { exact: true }).click();
    await page.getByRole("combobox", { name: "VPN container to adopt", exact: true }).selectOption(vpnId);
  }
  await openInventory();
  const adopt = page.getByRole("button", { name: "Adopt selected stack", exact: true });
  const consent = page.getByLabel("I authorize Tuniku to manage this VPN and the selected applications.", { exact: true });
  await expect(page.getByRole("checkbox", { name: longName, exact: true })).toBeChecked();
  for (const name of ["separate-network", "different-container", "recovery-application"]) await expect(page.getByRole("checkbox", { name, exact: true })).toBeDisabled();
  await expect(page.locator('option[value="' + "8".repeat(64) + '"]')).toHaveAttribute("disabled", "");
  await expect(page.getByRole("checkbox", { name: "unknown-namespace", exact: true })).not.toBeChecked();
  await consent.check();
  await expect(adopt).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: "cross-project-client (other-approved)" })).toBeVisible();
  expect(posts).toBe(0);
  crossProject = false;
  await page.reload();
  await openInventory();
  await expect(adopt).toBeDisabled();
  await page.getByRole("checkbox", { name: "unknown-namespace", exact: true }).check();
  for (const width of [390, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  const accessibility = await new AxeBuilder({ page }).include('[aria-labelledby="managed-stack-title"]').analyze();
  expect(accessibility.violations.filter(violation => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  expect(posts).toBe(0);
  await consent.check();
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(page.getByRole("combobox", { name: "Managed VPN stack", exact: true })).toHaveValue(projectId);
  expect(posts).toBe(1);
});


test("configuration references, pending proposals and separate projects remain distinct", async ({ page }, testInfo) => {
  const projectId = "77777777-7777-4777-8777-777777777777";
  let drift = true, completed = false, inspections = 0;
  await page.route("**/api/v1/management", route => route.fulfill({ json: { enabled: true, projects: [{ id: projectId, vpnId: "a".repeat(64), clientIds: [], composeProject: "synthetic-vpn" }], candidates: [], operations: completed ? [{ id: projectId, projectId, planId: projectId, status: "succeeded", step: "Synthetic managed change completed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: null }] : [] } }));
  await page.route("**/api/v1/management/diagnostics", route => { inspections++; return route.fulfill({ json: { diagnostics: { projectId, observedAt: new Date().toISOString(), stale: false, configuration: { state: drift ? "drifted" : "matched", baselineAt: new Date().toISOString(), baselineSource: "adoption", changedServiceIds: drift ? ["a".repeat(64)] : [] }, publishedPorts: { "80/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }] }, vpn: { id: "a".repeat(64), name: "vpn", availability: "available", state: "running", health: "healthy", exitCode: 0, namespace: "vpn", issue: null }, applications: [] } } }); });
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(page.getByText("Current inputs are an unverified proposal.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Manage an existing stack", exact: true }).click();
  await page.getByRole("combobox", { name: "Managed VPN stack" }).selectOption(projectId);
  await page.getByRole("button", { name: "Inspect managed applications" }).click();
  await expect(page.getByText("Configuration drift detected.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observed published ports" })).toBeVisible();
  drift = false; await page.getByRole("button", { name: "Inspect managed applications" }).click();
  await expect(page.getByText("Observed configuration matches the saved managed reference.")).toBeVisible();
  completed = true; await page.getByRole("button", { name: "Refresh managed status" }).click();
  await expect.poll(() => inspections).toBe(3);
  await expect(page.getByText("Last successful managed change:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Set up VPN or export configuration", exact: true }).click();
  if (!(await page.getByRole("button", { name: "Place an app behind Gluetun manually", exact: true }).isVisible())) await page.getByText("Expert tasks", { exact: true }).click();
  await page.getByRole("button", { name: "Place an app behind Gluetun manually", exact: true }).click();
  await expect(page.locator(".setup-workflow")).toContainText("For the same Compose project");
  await page.getByLabel("Application project", { exact: true }).selectOption("separate_project");
  await expect(page.locator(".setup-workflow")).toContainText("For separate projects");
  await expect(page.locator(".setup-workflow")).not.toContainText("For the same Compose project");
  await page.getByLabel("Existing VPN container name", { exact: true }).fill("synthetic-vpn");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator('.snippet-card pre')).toContainText("container:synthetic-vpn");
  await expect(page.locator('.snippet-card pre')).not.toContainText("service:gluetun");
  await expect(page.getByRole("button", { name: "Download VPN port fragment" })).toBeVisible();
  for (const [width, height] of [[390, 844], [960, 540], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`planning-state-${width}.png`), fullPage: true, animations: "disabled" });
  }
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations.filter(value => value.impact === "critical" || value.impact === "serious")).toEqual([]);
});

test("managed settings, retention, recovery and complete export require deliberate actions", async ({ page }, testInfo) => {
  const projectId = "88888888-8888-4888-8888-888888888888", operationId = "99999999-9999-4999-8999-999999999999", confirmationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let recovered = false, cleanups = 0;
  await page.route("**/api/v1/management", route => route.fulfill({ json: { enabled: true, candidates: [], projects: [{ id: projectId, vpnId: "a".repeat(64), clientIds: [], composeProject: "synthetic-vpn" }], prerequisites: { projects: ["synthetic-vpn"], bindRootsConfigured: false, adoptionOnly: true, restartAlwaysSupported: false }, storage: { plans: 800, limit: 1000, bytes: 200000, expiredUnreferenced: 1, retainedContainers: 1 }, operations: [{ id: operationId, projectId, planId: confirmationId, status: recovered ? "succeeded" : "interrupted", step: recovered ? "Original recovery complete" : "Manual recovery required", startedAt: new Date().toISOString(), error: null }] } }));
  await page.route("**/api/v1/management/settings", route => route.fulfill({ json: { settings: { input: { provider: "private internet access", vpnType: "openvpn", regions: "Albania", providerOptions: {} }, clearableKeys: ["SERVER_REGIONS"], publishedPorts: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "8080" }] }, configurationSource: "environment" } } }));
  await page.route("**/api/v1/management/diagnostics", route => route.fulfill({ status: 409, json: { error: { message: "Synthetic inspection unavailable" } } }));
  await page.route("**/api/v1/management/recovery-review", route => route.fulfill({ json: { review: { operationId, fingerprint: confirmationId, services: [{ name: "original-vpn" }], effect: "Close the inspected original recovery lock. No Docker writes." } } }));
  await page.route("**/api/v1/management/recovery-complete", route => { expect(route.request().postDataJSON()).toEqual({ operationId, fingerprint: confirmationId, confirmed: true }); recovered = true; return route.fulfill({ json: { status: "rolled_back" } }); });
  await page.route("**/api/v1/management/cleanup-review", route => route.fulfill({ json: { review: { operationId, fingerprint: confirmationId, containers: [{ id: "b".repeat(64), name: "stopped-original" }], effect: "Delete only this stopped original; preserve volumes." } } }));
  await page.route("**/api/v1/management/cleanup", route => { expect(route.request().postDataJSON()).toEqual({ operationId, fingerprint: confirmationId, confirmed: true }); cleanups++; return route.fulfill({ json: { cleanedIds: ["b".repeat(64)] } }); });
  await page.route("**/api/v1/management/export", route => route.fulfill({ json: { export: { document: { services: { vpn: { volumes: ["state:/gluetun"], environment: { OPENVPN_PASSWORD: "[REDACTED]" } } } }, changes: [{ service: "vpn", field: "environment" }], warnings: ["Review image IDs and supply credentials locally."], deploymentReady: false } } }));
  await page.goto("/"); await page.getByLabel("Username").fill("admin"); await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password"); await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Managed VPN stack" })).toBeHidden();
  await page.getByRole("button", { name: "Manage an existing stack", exact: true }).click();
  await page.getByRole("combobox", { name: "Managed VPN stack" }).selectOption(projectId);
  await expect(page.getByLabel("VPN service provider")).toHaveValue("private internet access"); await expect(page.getByLabel("Server regions", { exact: true })).toHaveValue("Albania"); await expect(page.getByLabel("OpenVPN password", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Review change plan", exact: true })).toBeDisabled();
  await page.getByText("Management prerequisites", { exact: true }).click(); await expect(page.getByText("No host bind roots configured", { exact: false })).toBeVisible();
  await page.getByText("Manager storage and recovery retention", { exact: true }).click(); await expect(page.getByText("Plan storage is nearing", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Inspect repaired originals", exact: true }).click(); const complete = page.getByRole("button", { name: "Complete confirmed recovery action", exact: true }); await expect(complete).toBeDisabled();
  await page.getByLabel("I confirm completion of the inspected manual recovery without Docker changes.", { exact: true }).check(); await complete.click(); await expect.poll(() => recovered).toBe(true);
  await page.getByRole("button", { name: "Review stopped recovery containers", exact: true }).click(); await expect(complete).toBeDisabled(); await page.getByRole("button", { name: "Cancel recovery action" }).click(); expect(cleanups).toBe(0);
  await page.getByRole("button", { name: "Review stopped recovery containers", exact: true }).click(); await page.getByLabel("I confirm permanent removal of the listed stopped containers, preserving their volumes.", { exact: true }).check(); await complete.click(); expect(cleanups).toBe(1);
  await page.getByText("Reconcile Host Compose before external maintenance", { exact: true }).click(); await page.getByLabel("Complete original Compose for managed export").fill("services:\n  vpn:\n    image: qmcgaw/gluetun:latest\n"); await page.getByRole("button", { name: "Review managed Compose export" }).click(); await expect(page.getByRole("button", { name: "Download complete review document" })).toBeVisible();
  for (const width of [390, 768, 1920]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); await page.screenshot({ path: testInfo.outputPath(`managed-review-${width}.png`), fullPage: true }); }
  const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations.filter(value => value.impact === "critical" || value.impact === "serious")).toEqual([]);
});
