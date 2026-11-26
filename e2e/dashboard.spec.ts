import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Konnexy Ads Stage 2.1 Operational Completion & Accessibility Suite", () => {
  test("1. Enforces route & API protection: redirects unauthenticated '/' to '/login' and blocks '/api/integrations/google-ads/authorize' with 401", async ({
    page,
    request,
  }) => {
    const apiRes = await request.get("/api/integrations/google-ads/authorize");
    expect(apiRes.status()).toBe(401);
    const apiJson = await apiRes.json();
    expect(apiJson.errorCode).toBe("UNAUTHENTICATED_ACCESS");

    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: /KONNEXY ADS/i })
    ).toBeVisible();
  });

  test("2. Full Operational Flow: Onboarding -> Persistent Client Creation -> Survives Reload -> Logout -> Login & Error State", async ({
    page,
  }) => {
    const uniqueSuffix = Date.now();
    const userEmail = `operador.${uniqueSuffix}@konnexy.com.br`;
    const orgSlug = `konnexy-agencia-${uniqueSuffix}`;
    const clientName = `Clínica Persistente ${uniqueSuffix}`;

    // Go to Onboarding
    await page.goto("/onboarding");
    await page
      .getByTestId("onboard-fullname-input")
      .fill("Operador Sênior Konnexy");
    await page.getByTestId("onboard-email-input").fill(userEmail);
    await page
      .getByTestId("onboard-password-input")
      .fill("SenhaForte#2026Konnexy");
    await page
      .getByTestId("onboard-orgname-input")
      .fill(`Konnexy Agência ${uniqueSuffix}`);
    await page.getByTestId("onboard-orgslug-input").fill(orgSlug);
    await page.getByTestId("onboard-submit-btn").click();

    // Must land on authenticated operational dashboard '/' (first render applies PGlite migrations)
    await expect(page).toHaveURL("http://localhost:3100/", { timeout: 25000 });
    await expect(
      page.getByTestId("environment-scope-badge")
    ).toContainText(/AMBIENTE OPERACIONAL \(SEM DADOS SIMULADOS\)/i);

    // Initially no fake campaigns or fake metrics exist ("Sem dados")
    await expect(page.getByText("Sem dados").first()).toBeVisible();

    // Create a persistent client in PostgreSQL via Server Action
    await page.getByTestId("create-client-name-input").fill(clientName);
    await page
      .getByTestId("create-client-industry-input")
      .fill("Odontologia Especializada");
    await page.getByTestId("create-client-budget-input").fill("12000");
    await page.getByTestId("create-client-cpa-input").fill("42");
    await page.getByTestId("create-client-submit-btn").click();

    await expect(
      page.getByTestId("management-success-status")
    ).toBeVisible();
    await expect(
      page.locator("span, p", { hasText: clientName }).first()
    ).toBeVisible();

    // Reload the page and prove the client was persisted in PostgreSQL (not React local state)
    await page.reload();
    await expect(
      page.locator("span, p", { hasText: clientName }).first()
    ).toBeVisible();

    // Logout and verify redirect to /login
    await page.getByTestId("logout-btn").click();
    await expect(page).toHaveURL(/\/login/);

    // Attempt invalid login and verify error alert
    await page.getByTestId("login-email-input").fill(userEmail);
    await page.getByTestId("login-password-input").fill("SenhaIncorreta#000");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("login-error-alert")).toBeVisible();

    // Login with valid credentials and verify persistent client is still there
    await page
      .getByTestId("login-password-input")
      .fill("SenhaForte#2026Konnexy");
    await page.getByTestId("login-submit-btn").click();
    await expect(page).toHaveURL("http://localhost:3100/", { timeout: 20000 });
    await expect(
      page.locator("span, p", { hasText: clientName }).first()
    ).toBeVisible();
  });

  test("3. Public Demonstration Environment (/demo) is isolated, supports Ctrl+K Command Palette, and passes Automated Axe Accessibility Audit", async ({
    page,
  }) => {
    await page.goto("/demo");
    const banner = page.getByTestId("demo-mode-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      /AMBIENTE DEMONSTRATIVO \(FOUNDATION STAGE/i
    );

    const openBtn = page.getByRole("button", {
      name: /Abrir Command Palette/i,
    });
    await openBtn.focus();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", {
      name: /Command Palette Konnexy Ads/i,
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Run automated WCAG accessibility check with @axe-core/playwright
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === "critical"
    );
    expect(criticalViolations).toEqual([]);
  });

  const viewports = [
    { width: 320, height: 640, name: "Mobile Small (320px)" },
    { width: 375, height: 812, name: "Mobile Standard (375px)" },
    { width: 768, height: 1024, name: "Tablet (768px)" },
    { width: 1024, height: 768, name: "Laptop (1024px)" },
    { width: 1440, height: 900, name: "Desktop Wide (1440px)" },
  ];

  for (const vp of viewports) {
    test(`4. Renders responsive layout without horizontal page overflow at ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/demo");

      await expect(page.getByTestId("demo-mode-banner")).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: /Command Center — Gestão & Automação Supervisionada/i,
        })
      ).toBeVisible();

      const hasHorizontalOverflow = await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
        );
      });
      expect(hasHorizontalOverflow).toBe(false);
    });
  }
});
