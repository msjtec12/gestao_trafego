import { test, expect } from "@playwright/test";

test.describe("Konnexy Ads Foundation Dashboard", () => {
  test("displays demo identification banner, read-only badge, and emergency kill switch", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByText(/AMBIENTE DEMONSTRATIVO \(FOUNDATION STAGE/i)
    ).toBeVisible();
    await expect(
      page.getByText(/MODO PADRÃO: SOMENTE LEITURA/i)
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Botão de Emergência \(Kill Switch\)/i })
    ).toBeVisible();
  });
});
