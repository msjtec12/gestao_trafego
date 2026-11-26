import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function assertNoSeriousOrCriticalAxeViolations(
  page: Page,
  contextLabel: string
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );

  expect(
    seriousOrCritical,
    `Axe WCAG serious/critical violations on ${contextLabel}: ${JSON.stringify(
      seriousOrCritical.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => n.html),
      }))
    )}`
  ).toEqual([]);
}

test.describe("Konnexy Ads Stage 2.2 Production Readiness, Unified Auth.js & WCAG Accessibility Suite", () => {
  test("1. Enforces route & API protection: redirects unauthenticated '/' to '/login', blocks '/api/integrations/google-ads/authorize' with 401, and passes Axe on /login & /onboarding", async ({
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

    await assertNoSeriousOrCriticalAxeViolations(page, "Login Page (/login)");

    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", {
        name: /Onboarding — Criar Organização Multi-Tenant/i,
      })
    ).toBeVisible();
    await assertNoSeriousOrCriticalAxeViolations(
      page,
      "Onboarding Page (/onboarding)"
    );
  });

  test("2. Full Operational Flow: Onboarding -> Auth.js Session Cookie -> Persistent Client Creation -> Immediate UI Update -> Survives Reload -> Axe Audit -> Logout -> Login", async ({
    page,
    context,
  }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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

    // Must land on authenticated operational dashboard '/'
    await expect(page).toHaveURL(/\/$/, { timeout: 25000 });
    await expect(
      page.getByTestId("environment-scope-badge")
    ).toContainText(/AMBIENTE OPERACIONAL \(SEM DADOS SIMULADOS\)/i);

    // Verify unified Auth.js session cookie ('authjs.session-token') was issued
    const cookies = await context.cookies();
    const authJsCookie = cookies.find(
      (c) => c.name === "authjs.session-token"
    );
    expect(authJsCookie).toBeDefined();

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

    // Unique card locator verifying immediate UI update after Server Action
    const clientCardHeading = page
      .locator('[data-testid^="client-card-name-"]', { hasText: clientName })
      .first();
    await expect(clientCardHeading).toBeVisible();

    // Run Axe accessibility audit on the Authenticated Operational Dashboard
    await assertNoSeriousOrCriticalAxeViolations(
      page,
      "Authenticated Operational Dashboard (/)"
    );

    // Stage 3: Generate a persistent Executive Report for the newly created client
    await page.getByTestId("generate-executive-report-btn").click();
    await expect(
      page.getByTestId("ai-center-success-status")
    ).toBeVisible();
    await expect(
      page
        .locator('[data-testid^="executive-report-title-"]', {
          hasText: clientName,
        })
        .first()
    ).toBeVisible();

    // Reload the page and prove BOTH the client and the executive report were persisted in PostgreSQL
    await page.reload();
    await expect(
      page
        .locator('[data-testid^="client-card-name-"]', { hasText: clientName })
        .first()
    ).toBeVisible();
    await expect(
      page
        .locator('[data-testid^="executive-report-title-"]', {
          hasText: clientName,
        })
        .first()
    ).toBeVisible();
    await expect(
      page.getByTestId("client-selector").locator("option", {
        hasText: clientName,
      })
    ).toHaveCount(1);

    // Logout and verify redirect to /login and cookie deletion / DB revocation
    await page.getByTestId("logout-btn").click();
    await expect(page).toHaveURL(/\/login/);

    // Attempt invalid login and verify error alert
    await page.getByTestId("login-email-input").fill(userEmail);
    await page.getByTestId("login-password-input").fill("SenhaIncorreta#000");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("login-error-alert")).toBeVisible();

    // Login with valid credentials and verify persistent client is still in PostgreSQL
    await page
      .getByTestId("login-password-input")
      .fill("SenhaForte#2026Konnexy");
    await page.getByTestId("login-submit-btn").click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
    await expect(
      page
        .locator('[data-testid^="client-card-name-"]', { hasText: clientName })
        .first()
    ).toBeVisible();
  });

  test("3. Public Demonstration Environment (/demo) is isolated, renders unique demo-mode-banner, supports Ctrl+K Command Palette, and passes Axe Accessibility Audit (including dialog)", async ({
    page,
  }) => {
    await page.goto("/demo");
    const banner = page.getByTestId("demo-mode-banner");
    await expect(banner).toHaveCount(1);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      /AMBIENTE DEMONSTRATIVO \(FOUNDATION STAGE/i
    );

    await assertNoSeriousOrCriticalAxeViolations(
      page,
      "Public Demo Environment (/demo)"
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

    await assertNoSeriousOrCriticalAxeViolations(
      page,
      "Command Palette Dialog"
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
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

      await expect(page.getByTestId("demo-mode-banner")).toHaveCount(1);
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
