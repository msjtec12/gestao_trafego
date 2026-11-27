import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import {
  applyAllMigrationsToPglite,
  withAdminPostgresTransaction,
  withTenantTransaction,
} from "@/infrastructure/db";
import {
  onboardFirstOrganizationRepository,
  PersistentDrizzleTenantRepository,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import { COMMERCIAL_NAV_ITEMS } from "@/components/workspace/commercial-navigation";
import {
  buildGuidedOnboardingChecklist,
  buildIntegrationCatalog,
  isGoogleAdsOAuthEnvReady,
} from "@/application/use-cases/workspace-helpers";
import type { TenantContext } from "@/domain/types";

describe("Stage 3.1 — Product Experience, Commercial Navigation, Onboarding Checklist & PostgreSQL Persistence", () => {
  it("exposes all 15 commercial routes with zero engineering jargon in main navigation", () => {
    expect(COMMERCIAL_NAV_ITEMS).toHaveLength(15);

    const hrefs = COMMERCIAL_NAV_ITEMS.map((i) => i.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/",
        "/clientes",
        "/campanhas",
        "/grupos-de-anuncios",
        "/anuncios",
        "/palavras-chave",
        "/termos-de-pesquisa",
        "/conversoes",
        "/orcamentos",
        "/ia",
        "/recomendacoes",
        "/automacoes",
        "/relatorios",
        "/integracoes",
        "/configuracoes",
      ])
    );

    const labelsJoined = COMMERCIAL_NAV_ITEMS.map((i) => i.label).join(" ");
    expect(labelsJoined).not.toMatch(/drizzle|rls|multi-tenant|mock|schema/i);
  });

  it("computes the 9-step guided onboarding checklist accurately distinguishing configured vs external credential dependencies", () => {
    const emptySteps = buildGuidedOnboardingChecklist({
      organizationName: "Konnexy Performance",
      organizationTimezone: "America/Sao_Paulo",
      clients: [],
      adAccounts: [],
      integrations: [],
      syncHistory: [],
      persistedRecommendations: [],
      executiveReports: [],
      isGoogleAdsOAuthConfigured: false,
    });

    expect(emptySteps).toHaveLength(9);
    expect(emptySteps[0]?.status).toBe("CONCLUIDO"); // org profile
    expect(emptySteps[1]?.status).toBe("PENDENTE"); // first client
    expect(emptySteps[4]?.status).toBe("BLOQUEADO_CREDENCIAIS"); // connect Google Ads
    expect(emptySteps[4]?.credentialNote).toContain("GOOGLE_ADS_CLIENT_ID");
    expect(emptySteps[5]?.status).toBe("BLOQUEADO_CREDENCIAIS"); // select account
    expect(emptySteps[6]?.status).toBe("BLOQUEADO_CREDENCIAIS"); // first sync
  });

  it("reports honest integration states for Google Ads, Meta Ads, GA4, and Google Search Console", () => {
    expect(isGoogleAdsOAuthEnvReady({})).toBe(false);
    expect(
      isGoogleAdsOAuthEnvReady({
        GOOGLE_ADS_CLIENT_ID: "id-123",
        GOOGLE_ADS_CLIENT_SECRET: "sec-456",
        GOOGLE_ADS_DEVELOPER_TOKEN: "dev-789",
      })
    ).toBe(true);

    const unconfigured = buildIntegrationCatalog({
      integrations: [],
      syncHistory: [],
      isGoogleAdsOAuthConfigured: false,
    });
    expect(unconfigured).toHaveLength(4);
    expect(unconfigured[0]?.providerKey).toBe("GOOGLE_ADS");
    expect(unconfigured[0]?.status).toBe("NAO_CONFIGURADO");
    expect(unconfigured[0]?.canConnect).toBe(false);

    for (const key of ["META_ADS", "GA4", "GSC"] as const) {
      const card = unconfigured.find((c) => c.providerKey === key);
      expect(card?.status).toBe("EM_DESENVOLVIMENTO");
      expect(card?.isOperational).toBe(false);
      expect(card?.canConnect).toBe(false);
    }

    const expired = buildIntegrationCatalog({
      integrations: [
        {
          id: "int-1",
          organizationId: "org-1",
          provider: "GOOGLE_ADS",
          label: "Google Ads",
          status: "EXPIRED",
          mode: "READ_ONLY",
          managerCustomerId: null,
          lastSyncedAtIso: "2026-11-25T10:00:00.000Z",
          lastCheckpoint: null,
          latencyMs: 0,
          message: "Expirado",
          isDemoData: false,
        },
      ],
      syncHistory: [],
      isGoogleAdsOAuthConfigured: true,
    });
    expect(expired[0]?.status).toBe("CREDENCIAL_EXPIRADA");
  });

  it("persists commercial client fields (websiteUrl, targetRoas) and organization profile updates under RLS", async () => {
    const pg = new PGlite();
    await applyAllMigrationsToPglite(pg);
    try {
      const onboarded = await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
          return await onboardFirstOrganizationRepository(tx, {
            fullName: "Gestor Comercial",
            email: "gestor.stage31@konnexy.com.br",
            password: "StrongPassword!2026",
            organizationName: "Konnexy Ads Agency",
            organizationSlug: "konnexy-ads-agency",
            timezone: "America/Sao_Paulo",
            currencyCode: "BRL",
          });
        },
        { customPg: pg }
      );

      const ctx: TenantContext = {
        organizationId: onboarded.organization.id,
        organizationSlug: onboarded.organization.slug,
        userId: onboarded.user.id,
        role: "OWNER",
        executionMode: "READ_ONLY",
        emergencyStopActive: false,
      };

      const createdClient = await withTenantTransaction(
        ctx,
        async (tx) => {
          const repo = new PersistentDrizzleTenantRepository(tx);
          return await repo.createClient(ctx, {
            name: "Clínica Vitta",
            industry: "Saúde e Estética",
            websiteUrl: "https://clinicavitta.com.br",
            monthlyBudgetCapCents: 1500000,
            targetCpaCents: 4800,
            targetRoas: "4.50",
          });
        },
        { customPg: pg }
      );

      expect(createdClient.websiteUrl).toBe("https://clinicavitta.com.br");
      expect(Number(createdClient.targetRoas)).toBe(4.5);

      const updatedClient = await withTenantTransaction(
        ctx,
        async (tx) => {
          const repo = new PersistentDrizzleTenantRepository(tx);
          return await repo.updateClient(ctx, {
            clientId: createdClient.id,
            name: "Clínica Vitta Premium",
            industry: "Saúde e Estética",
            websiteUrl: "https://vitta.com.br",
            monthlyBudgetCapCents: 2000000,
            targetCpaCents: 4200,
            targetRoas: "5.20",
          });
        },
        { customPg: pg }
      );

      expect(updatedClient.name).toBe("Clínica Vitta Premium");
      expect(updatedClient.websiteUrl).toBe("https://vitta.com.br");
      expect(Number(updatedClient.targetRoas)).toBe(5.2);

      const updatedOrg = await withTenantTransaction(
        ctx,
        async (tx) => {
          const repo = new PersistentDrizzleTenantRepository(tx);
          return await repo.updateOrganizationSettings(ctx, {
            name: "Konnexy Performance Pro",
            timezone: "America/Manaus",
            currencyCode: "BRL",
          });
        },
        { customPg: pg }
      );

      expect(updatedOrg.name).toBe("Konnexy Performance Pro");
      expect(updatedOrg.timezone).toBe("America/Manaus");
    } finally {
      await pg.close();
    }
  });
});
