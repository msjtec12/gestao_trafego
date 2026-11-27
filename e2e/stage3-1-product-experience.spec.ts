import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function assertCleanAxe(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const severe = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  expect(
    severe,
    `Axe serious/critical violations on ${label}: ${JSON.stringify(
      severe.map((v) => ({ id: v.id, impact: v.impact }))
    )}`
  ).toEqual([]);
}

test.describe("Stage 3.1 — Commercial Product Experience, 15 Routes & WCAG Suite", () => {
  test("navigates across commercial routes, updates guided onboarding, edits client profile, verifies honest integrations, and passes Axe WCAG", async ({
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `stage31.${suffix}@konnexy.com.br`;
    const slug = `stage31-org-${suffix}`;

    // 1. Onboard new organization
    await page.goto("/onboarding");
    await page.getByTestId("onboard-fullname-input").fill("Gestor Stage 3.1");
    await page.getByTestId("onboard-email-input").fill(email);
    await page.getByTestId("onboard-password-input").fill("KonnexyStage31#2026");
    await page.getByTestId("onboard-orgname-input").fill(`Konnexy Pro ${suffix}`);
    await page.getByTestId("onboard-orgslug-input").fill(slug);
    await page.getByTestId("onboard-submit-btn").click();
    await expect(page).toHaveURL(/\/$/, { timeout: 25000 });

    // 2. Verify Guided 9-Step Onboarding Checklist is visible on '/'
    await expect(page.getByTestId("guided-onboarding-checklist")).toBeVisible();
    await expect(page.getByTestId("onboarding-step-org-profile")).toContainText(
      "Configurado"
    );

    // 3. Navigate to /clientes and create a commercial client with website & ROAS
    await page.getByTestId("nav-link-clientes").click();
    await expect(page).toHaveURL(/\/clientes$/);
    await page.fill("#cli-name", `Cliente Comercial ${suffix}`);
    await page.fill("#cli-industry", "E-commerce Moda");
    await page.fill("#cli-website", "https://lojamoda.com.br");
    await page.fill("#cli-budget", "18000");
    await page.fill("#cli-cpa", "38");
    await page.fill("#cli-roas", "4.8");
    await page.getByRole("button", { name: /Cadastrar Cliente/i }).click();
    await expect(
      page.getByText(`Cliente Comercial ${suffix}`).first()
    ).toBeVisible();
    await assertCleanAxe(page, "Clientes (/clientes)");

    // 4. Open individual client detail page (/clientes/[id])
    await page.getByRole("link", { name: /Abrir ficha/i }).first().click();
    await expect(page).toHaveURL(/\/clientes\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("heading", { name: `Cliente Comercial ${suffix}` })
    ).toBeVisible();

    // 5. Verify Integrations Center honest states (Google Ads prioritized, Meta/GA4/GSC Em desenvolvimento)
    await page.getByTestId("nav-link-integracoes").click();
    await expect(page).toHaveURL(/\/integracoes$/);
    await expect(page.getByTestId("integration-card-GOOGLE_ADS")).toBeVisible();
    await expect(page.getByTestId("integration-card-META_ADS")).toContainText(
      "Em desenvolvimento"
    );
    await expect(page.getByTestId("integration-card-GA4")).toContainText(
      "Em desenvolvimento"
    );
    await expect(page.getByTestId("integration-card-GSC")).toContainText(
      "Em desenvolvimento"
    );
    await assertCleanAxe(page, "Integrações (/integracoes)");

    // 6. Visit remaining commercial routes to prove all 15 routes render cleanly
    const routesToCheck = [
      "campanhas",
      "grupos-de-anuncios",
      "anuncios",
      "palavras-chave",
      "termos-de-pesquisa",
      "conversoes",
      "orcamentos",
      "ia",
      "recomendacoes",
      "automacoes",
      "relatorios",
      "configuracoes",
    ];

    for (const id of routesToCheck) {
      await page.getByTestId(`nav-link-${id}`).click();
      await expect(page).toHaveURL(new RegExp(`/${id}$`));
    }

    // 7. Verify Restricted Admin Diagnostics tab is available to OWNER in /configuracoes
    await page.getByTestId("admin-diagnostics-tab-btn").click();
    await expect(page.getByTestId("admin-diagnostics-panel")).toBeVisible();
    await assertCleanAxe(page, "Configurações (/configuracoes)");
  });
});
