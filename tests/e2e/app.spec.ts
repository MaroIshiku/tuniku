import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe.configure({ mode: "serial" });

test("first-run setup, Gluetun connection, control, ports, and Compose generation", async ({ page }, testInfo) => {
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
  await page.getByLabel("WireGuard private key").fill("e2e-wireguard-private-key");
  await page.getByLabel("WireGuard addresses").fill("10.2.0.2/32");
  await page.getByLabel("API key").fill("e2e-control-api-key");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.locator(".validation-chip", { hasText: "Generated YAML is valid" })).toBeVisible();
  await expect(page.locator(".code-block", { hasText: "gluetun:" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Overview", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect existing Gluetun" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Control Server base URL").fill("http://127.0.0.1:8199");
  await page.getByLabel("Authentication mode").selectOption("none");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Reachable · Authentication accepted")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("heading", { name: "VPN is stopped" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-overview.png"), fullPage: true });

  await page.getByRole("button", { name: "VPN", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "VPN Control" })).toBeVisible();
  await page.getByRole("button", { name: "Start VPN" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start VPN" }).click();
  await expect(page.getByRole("heading", { name: "VPN is running" })).toBeVisible();

  await page.getByRole("button", { name: "Ports", exact: true }).first().click();
  await page.getByRole("button", { name: "Add local port" }).first().click();
  await page.getByLabel("Label").fill("Example Web UI");
  await page.getByLabel("Host port").fill("8080");
  await page.getByLabel("Container port").fill("8080");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Example Web UI")).toBeVisible();

  await page.getByRole("button", { name: "Assistant", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Compose Assistant" })).toBeVisible();
  await page.getByLabel("VPN service provider").selectOption("protonvpn");
  await page.getByLabel("WireGuard private key").fill("e2e-wireguard-private-key");
  await page.getByLabel("WireGuard addresses").fill("10.2.0.2/32");
  await page.getByLabel("API key").fill("e2e-control-api-key");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.getByRole("heading", { name: "3. Copy-paste snippet" })).toBeVisible();
  await expect(page.locator(".validation-chip", { hasText: "Generated YAML is valid" })).toBeVisible();
  const composeText = await page.locator(".snippet-card .code-block").textContent();
  expect(composeText).toContain("VPN_SERVICE_PROVIDER: protonvpn");
  expect(composeText).not.toContain("${");
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
  await context.close();
});
