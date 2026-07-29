import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("first-run setup, Gluetun connection, control, ports, and Compose generation", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up the administrator" })).toBeVisible();
  await page.getByLabel("Setup secret").fill("tuniku-e2e-setup-secret");
  await page.getByLabel("Display name").fill("Tuniku Admin");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("a unique e2e admin password");
  await page.getByLabel("Repeat password").fill("a unique e2e admin password");
  await page.getByRole("button", { name: "Create administrator" }).click();

  await expect(page.getByRole("heading", { name: "Configure Gluetun" })).toBeVisible();
  await page.getByRole("button", { name: "Configure Gluetun" }).click();
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
  await page.getByLabel("VPN service provider").fill("protonvpn");
  await page.getByRole("button", { name: "Generate guidance" }).click();
  await expect(page.getByRole("heading", { name: "3. Copy-paste snippet" })).toBeVisible();
  await expect(page.locator(".validation-chip", { hasText: "Generated YAML is valid" })).toBeVisible();
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
