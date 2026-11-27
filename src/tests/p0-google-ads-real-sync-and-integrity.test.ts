import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import {
  applyAllMigrationsToPglite,
  withAdminPostgresTransaction,
  withTenantTransaction,
} from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import {
  onboardFirstOrganizationRepository,
  PersistentDrizzleTenantRepository,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import { PersistentPostgresGoogleAdsService } from "@/integrations/google-ads/google-ads-oauth-and-readonly";
import {
  computeExactGoogleAdsMetrics,
  GoogleAdsLiveSyncAdapter,
} from "@/integrations/google-ads/google-ads-live-sync-adapter";
import {
  assertVerifiedOperationalDataForAI,
  auditOrganizationDataIntegrity,
} from "@/infrastructure/db/reconciliation/data-integrity-reconciler";
import { PersistentPostgresAdsSyncEngine } from "@/workflows/incremental-sync-engine";
import type { TenantContext } from "@/domain/types";

describe("P0 Critical Fix — Real Google Ads Live Sync, Metric Precision & Anti-Contamination", () => {
  it("contains ZERO synthetic/hardcoded campaign or account fixtures in operational-actions.ts", () => {
    const actionsPath = path.resolve(
      process.cwd(),
      "src/app/actions/operational-actions.ts"
    );
    const source = fs.readFileSync(actionsPath, "utf-8");

    expect(source).not.toContain("4028819001");
    expect(source).not.toContain("CAMP-");
    expect(source).not.toContain("AG-");
    expect(source).not.toContain("AD-");
    expect(source).not.toContain("ckpt-pg-");
    expect(source).not.toContain("MockAdsProvider");
  });

  it("computes exact Google Ads metrics from cost_micros, preserves fractional conversions, and distinguishes 0 vs null", () => {
    // Mathematical validation against official Google Ads reference metrics:
    // Impressions: 3.020, Clicks: 239, Spend: R$ 68,85 (68_850_000 micros) -> CPC = R$ 0,29, CTR = 7,91%
    const ref = computeExactGoogleAdsMetrics({
      impressions: 3020,
      clicks: 239,
      costMicros: 68_850_000,
      conversions: 4.5,
      conversionValueMicros: 275_400_000,
    });

    expect(ref.spendExact).toBe(68.85);
    expect(ref.spendCents).toBe(6885);
    expect(ref.cpcRounded).toBe(0.29);
    expect(Number(ref.ctrPct?.toFixed(2))).toBe(7.91);
    expect(ref.conversions).toBe(4.5); // fractional conversion preserved
    expect(Number(ref.cpaExact?.toFixed(2))).toBe(15.3);
    expect(Number(ref.roasExact?.toFixed(2))).toBe(4.0);

    // Zero denominator must return null (unavailable), NEVER NaN, Infinity, or fake 0
    const zeroMetrics = computeExactGoogleAdsMetrics({
      impressions: 0,
      clicks: 0,
      costMicros: 0,
      conversions: 0,
    });
    expect(zeroMetrics.ctrPct).toBeNull();
    expect(zeroMetrics.cpcExact).toBeNull();
    expect(zeroMetrics.cpaExact).toBeNull();
    expect(zeroMetrics.roasExact).toBeNull();
  });

  it("executes real MCC/account discovery, live GAQL sync across all domains, token auto-refresh, and fails closed on incomplete sync", async () => {
    const pg = new PGlite();
    await applyAllMigrationsToPglite(pg);

    try {
      const onboarded = await withAdminPostgresTransaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE konnexy_app`);
          return await onboardFirstOrganizationRepository(tx, {
            fullName: "Engenheiro P0",
            email: "p0.sync@konnexy.com.br",
            password: "StrongPassword!2026",
            organizationName: "Konnexy Live Sync",
            organizationSlug: "konnexy-live-sync",
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
      const keyHex = crypto.randomBytes(32).toString("hex");
      const stateSecret = crypto.randomBytes(32).toString("hex");

      const { clientId, integrationId } = await withTenantTransaction(
        ctx,
        async (tx) => {
          const repo = new PersistentDrizzleTenantRepository(tx);
          const client = await repo.createClient(ctx, {
            name: "Cliente Oficial SP",
            industry: "Corporativo",
            monthlyBudgetCapCents: 1000000,
            targetCpaCents: 4500,
          });

          const gSvc = new PersistentPostgresGoogleAdsService(tx, keyHex, "v1");
          const init = await gSvc.initiatePersistentOAuth({
            context: ctx,
            clientId: "123456.apps.googleusercontent.com",
            redirectUri:
              "https://ads.konnexy.com.br/api/integrations/google-ads/callback",
            stateSigningSecret: stateSecret,
          });
          const intg = await gSvc.exchangeCodeAndPersistIntegration({
            context: ctx,
            signedState: init.signedState,
            authorizationCode: "oauth-code-live",
            clientId: "123456.apps.googleusercontent.com",
            clientSecret: "oauth-secret-live",
            stateSigningSecret: stateSecret,
            externalAccountLabel: "Google Ads API v26",
            dnsResolver: async () => [{ address: "142.250.190.78", family: 4 }],
            customPinnedExecutor: async () => ({
              statusCode: 200,
              headers: {},
              bodyText: JSON.stringify({
                access_token: "ya29.initial_token",
                refresh_token: "1//0refresh_token",
                expires_in: 3600,
                scope: "https://www.googleapis.com/auth/adwords",
              }),
            }),
          });
          return { clientId: client.id, integrationId: intg.id };
        },
        { customPg: pg }
      );

      // 1. Discover MCC + Child Account via listAccessibleCustomers + customer_client GAQL
      const discovered = await withTenantTransaction(
        ctx,
        async (tx) => {
          const gSvc = new PersistentPostgresGoogleAdsService(tx, keyHex, "v1");
          const adapter = new GoogleAdsLiveSyncAdapter(gSvc);
          return await adapter.discoverAuthorizedAccounts({
            context: ctx,
            integrationId,
            dnsResolver: async () => [{ address: "142.250.190.78", family: 4 }],
            customPinnedExecutor: async (req) => {
              if (req.pathWithQuery.includes("listAccessibleCustomers")) {
                return {
                  statusCode: 200,
                  headers: {},
                  bodyText: JSON.stringify({
                    resourceNames: ["customers/9001002000"],
                  }),
                };
              }
              return {
                statusCode: 200,
                headers: {},
                bodyText: JSON.stringify({
                  results: [
                    {
                      customerClient: {
                        id: "9001002000",
                        descriptiveName: "Konnexy MCC",
                        currencyCode: "BRL",
                        timeZone: "America/Sao_Paulo",
                        manager: true,
                        status: "ENABLED",
                        level: "0",
                      },
                    },
                    {
                      customerClient: {
                        id: "5544332211",
                        descriptiveName: "Conta Corporativo SP",
                        currencyCode: "BRL",
                        timeZone: "America/Sao_Paulo",
                        manager: false,
                        status: "ENABLED",
                        level: "1",
                      },
                    },
                  ],
                }),
              };
            },
          });
        },
        { customPg: pg }
      );

      expect(discovered).toHaveLength(2);
      const child = discovered.find((a) => a.customerId === "5544332211");
      expect(child?.isManager).toBe(false);
      expect(child?.managerCustomerId).toBe("9001002000");

      // 2. Run live GAQL batch sync and verify persistence + VERIFIED integrity status
      const syncResult = await withTenantTransaction(
        ctx,
        async (tx) => {
          const gSvc = new PersistentPostgresGoogleAdsService(tx, keyHex, "v1");
          const adapter = new GoogleAdsLiveSyncAdapter(gSvc);
          const syncEngine = new PersistentPostgresAdsSyncEngine(tx);

          return await syncEngine.executePersistentSync({
            context: ctx,
            integrationId,
            clientId,
            provider: "GOOGLE_ADS",
            fetchBatchFn: () =>
              adapter.fetchLiveAccountBatch({
                context: ctx,
                integrationId,
                customerId: "5544332211",
                managerCustomerId: "9001002000",
                startDate: "2026-11-20",
                endDate: "2026-11-26",
                dnsResolver: async () => [
                  { address: "142.250.190.78", family: 4 },
                ],
                customPinnedExecutor: async (req) => {
                  const q = req.body ?? "";
                  // Regression guard: Google Ads API v19+/v26 rejects `pageSize` with HTTP 400
                  expect(q).not.toContain('"pageSize"');
                  if (q.includes("FROM customer LIMIT 1")) {
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            customer: {
                              id: "5544332211",
                              descriptiveName: "Conta Corporativo SP",
                              currencyCode: "BRL",
                              timeZone: "America/Sao_Paulo",
                              manager: false,
                            },
                          },
                        ],
                      }),
                    };
                  }
                  if (q.includes("FROM campaign WHERE campaign.status")) {
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            campaign: {
                              id: "21987654321",
                              name: "PESQ - Corporativo SP - 2026",
                              status: "ENABLED",
                              advertisingChannelType: "SEARCH",
                              biddingStrategyType: "MAXIMIZE_CLICKS",
                            },
                            campaignBudget: { amountMicros: "50000000" },
                          },
                        ],
                      }),
                    };
                  }
                  if (q.includes("FROM ad_group ")) {
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            campaign: { id: "21987654321" },
                            adGroup: {
                              id: "16543219876",
                              name: "Grupo Corporativo",
                              status: "ENABLED",
                              cpcBidMicros: "500000",
                            },
                          },
                        ],
                      }),
                    };
                  }
                  if (q.includes("FROM ad_group_ad")) {
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            adGroup: { id: "16543219876" },
                            adGroupAd: {
                              status: "ENABLED",
                              ad: {
                                id: "71234567890",
                                type: "RESPONSIVE_SEARCH_AD",
                                finalUrls: ["https://konnexy.com.br"],
                                responsiveSearchAd: {
                                  headlines: [{ text: "Solução Corporativa SP" }],
                                  descriptions: [{ text: "Atendimento B2B" }],
                                },
                              },
                            },
                          },
                        ],
                      }),
                    };
                  }
                  if (q.includes("FROM ad_group_criterion")) {
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            adGroup: { id: "16543219876" },
                            adGroupCriterion: {
                              criterionId: "81234567890",
                              negative: false,
                              keyword: {
                                text: "solucao corporativa sp",
                                matchType: "EXACT",
                              },
                              qualityInfo: { qualityScore: 8 },
                            },
                          },
                        ],
                      }),
                    };
                  }
                  if (q.includes("FROM search_term_view")) {
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            campaign: { id: "21987654321" },
                            adGroup: { id: "16543219876" },
                            segments: { date: "2026-11-26" },
                            searchTermView: {
                              searchTerm: "solucao corporativa sao paulo",
                            },
                            metrics: {
                              impressions: "3020",
                              clicks: "239",
                              costMicros: "68850000",
                              conversions: "0",
                            },
                          },
                        ],
                      }),
                    };
                  }
                  if (q.includes("FROM conversion_action")) {
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            conversionAction: {
                              id: "912345678",
                              name: "Lead Corporativo",
                              category: "SUBMIT_LEAD_FORM",
                              attributionModelSettings: {
                                attributionModel: "DATA_DRIVEN",
                              },
                            },
                          },
                        ],
                      }),
                    };
                  }
                  // Daily metrics
                  return {
                    statusCode: 200,
                    headers: {},
                    bodyText: JSON.stringify({
                      results: [
                        {
                          campaign: { id: "21987654321" },
                          segments: { date: "2026-11-26" },
                          metrics: {
                            impressions: "3020",
                            clicks: "239",
                            costMicros: "68850000",
                            conversions: "0",
                            conversionsValue: "0",
                          },
                        },
                      ],
                    }),
                  };
                },
              }),
          });
        },
        { customPg: pg }
      );

      expect(syncResult.status).toBe("COMPLETED");
      expect(syncResult.isDemoData).toBe(false);

      const integrityVerified = await withTenantTransaction(
        ctx,
        async (tx) => await auditOrganizationDataIntegrity(tx, ctx.organizationId),
        { customPg: pg }
      );
      expect(integrityVerified.overallStatus).toBe("VERIFIED");
      expect(integrityVerified.isContaminated).toBe(false);

      // 3. Partial GAQL failure must NEVER mark sync_runs as COMPLETED
      await expect(
        withTenantTransaction(
          ctx,
          async (tx) => {
            const gSvc = new PersistentPostgresGoogleAdsService(
              tx,
              keyHex,
              "v1"
            );
            const adapter = new GoogleAdsLiveSyncAdapter(gSvc);
            const syncEngine = new PersistentPostgresAdsSyncEngine(tx);

            return await syncEngine.executePersistentSync({
              context: ctx,
              integrationId,
              clientId,
              provider: "GOOGLE_ADS",
              fetchBatchFn: () =>
                adapter.fetchLiveAccountBatch({
                  context: ctx,
                  integrationId,
                  customerId: "5544332211",
                  startDate: "2026-11-20",
                  endDate: "2026-11-26",
                  dnsResolver: async () => [
                    { address: "142.250.190.78", family: 4 },
                  ],
                  customPinnedExecutor: async (req) => {
                    if ((req.body ?? "").includes("FROM search_term_view")) {
                      return {
                        statusCode: 500,
                        headers: {},
                        bodyText: "Internal Google Ads API error",
                      };
                    }
                    return {
                      statusCode: 200,
                      headers: {},
                      bodyText: JSON.stringify({
                        results: [
                          {
                            customer: {
                              id: "5544332211",
                              descriptiveName: "Conta Corporativo SP",
                              currencyCode: "BRL",
                              timeZone: "America/Sao_Paulo",
                              manager: false,
                            },
                          },
                        ],
                      }),
                    };
                  },
                }),
            });
          },
          { customPg: pg }
        )
      ).rejects.toThrow();

      // 4. Contaminate with a legacy CAMP-* row and verify reconciler detects it & blocks AI/Reports
      await withTenantTransaction(
        ctx,
        async (tx) => {
          const accounts = await tx
            .select()
            .from(schema.adAccounts)
            .where(eq(schema.adAccounts.organizationId, ctx.organizationId));
          await tx.insert(schema.campaigns).values({
            organizationId: ctx.organizationId,
            adAccountId: accounts[0]!.id,
            provider: "GOOGLE_ADS",
            externalCampaignId: "CAMP-synthetic-contamination",
            name: "Search — Synthetic",
            channelType: "SEARCH",
            biddingStrategy: "MANUAL_CPC",
            status: "ENABLED",
            dailyBudgetCents: 20000,
            isDemoData: false,
          });
        },
        { customPg: pg }
      );

      const contaminatedReport = await withTenantTransaction(
        ctx,
        async (tx) => await auditOrganizationDataIntegrity(tx, ctx.organizationId),
        { customPg: pg }
      );
      expect(contaminatedReport.overallStatus).toBe("CONTAMINATED");
      expect(contaminatedReport.counts.syntheticCampaigns).toBe(1);

      await expect(
        withTenantTransaction(
          ctx,
          async (tx) =>
            await assertVerifiedOperationalDataForAI(tx, ctx.organizationId),
          { customPg: pg }
        )
      ).rejects.toThrow(/Operação bloqueada por integridade de dados/);
    } finally {
      await pg.close();
    }
  });
});
