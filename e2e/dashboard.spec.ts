import { test, expect } from "@playwright/test";

test.describe("Konnexy Ads Foundation 1.1 Hardened Dashboard", () => {
  test("displays demo identification banner, read-only badge, and simulated emergency kill switch", async ({
    page,
  }) => {
    await page.goto("/");
    const banner = page.getByTestId("demo-mode-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      /AMBIENTE DEMONSTRATIVO \(FOUNDATION STAGE/i
    );
    await expect(page.getByText(/isDemoData: true/i).first()).toBeVisible();
    await expect(
      page.getByTestId("emergency-kill-switch-btn")
    ).toBeVisible();

    // Activate simulated Kill Switch and verify alert banner
    await page.getByTestId("emergency-kill-switch-btn").click();
    await expect(page.getByTestId("emergency-stop-alert")).toBeVisible();
    await expect(
      page.getByText(/PARADA DE EMERGÊNCIA ACIONADA \(SIMULAÇÃO LOCAL/i)
    ).toBeVisible();
  });

  test("supports keyboard navigation for Command Palette (Ctrl+K and Escape)", async ({
    page,
  }) => {
    await page.goto("/");
    const openBtn = page.getByRole("button", {
      name: /Abrir Command Palette/i,
    });
    await expect(openBtn).toBeVisible();
    await openBtn.focus();
    await page.keyboard.press("Control+k");

    const dialog = page.getByRole("dialog", {
      name: /Command Palette Konnexy Ads/i,
    });
    await expect(dialog).toBeVisible();

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
    test(`renders responsive layout without horizontal page overflow at ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");

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
