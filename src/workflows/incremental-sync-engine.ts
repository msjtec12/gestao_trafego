import { and, desc, eq } from "drizzle-orm";
import type { AdProviderType, TenantContext } from "@/domain/types";
import {
  assertAuthenticatedDbContext,
  type DrizzleQueryExecutor,
} from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import { assertTenantAccess } from "@/security/rbac-and-tenant";
import { convertGoogleAdsMicrosToCents } from "@/integrations/google-ads/google-ads-oauth-and-readonly";

export interface SyncEntityCounts {
  readonly [key: string]: number;
  readonly adAccounts: number;
  readonly campaigns: number;
  readonly adGroups: number;
  readonly ads: number;
  readonly keywords: number;
  readonly searchTerms: number;
  readonly conversions: number;
  readonly dailyMetrics: number;
  readonly budgets: number;
}

export interface SyncRunRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly integrationId: string;
  readonly adAccountId: string;
  readonly provider: AdProviderType;
  readonly status:
    | "RUNNING"
    | "COMPLETED"
    | "FAILED"
    | "SKIPPED_CONCURRENT_LOCK";
  readonly checkpointToken: string;
  readonly entitiesSynced: SyncEntityCounts;
  readonly currencyCode: string;
  readonly timezone: string;
  readonly isDemoData: boolean;
  readonly startedAtIso: string;
  readonly completedAtIso: string | null;
  readonly errorCode?: string;
}

export interface RawProviderSyncBatch {
  readonly checkpointToken: string;
  readonly currencyCode: string;
  readonly timezone: string;
  readonly isDemoData: boolean;
  readonly adAccounts: readonly {
    readonly externalAccountId: string;
    readonly name: string;
    readonly managerCustomerId?: string | null;
    readonly isMccAccount?: boolean;
  }[];
  readonly campaigns: readonly {
    readonly externalCampaignId: string;
    readonly name: string;
    readonly channelType?: string;
    readonly biddingStrategy?: string;
    readonly status?:
      | "ENABLED"
      | "PAUSED"
      | "REMOVED"
      | "LIMITED_BY_BUDGET"
      | "LEARNING";
    readonly dailyBudgetMicros: number;
  }[];
  readonly adGroups: readonly {
    readonly externalAdGroupId: string;
    readonly externalCampaignId: string;
    readonly name: string;
    readonly defaultCpcBidMicros?: number;
  }[];
  readonly ads: readonly {
    readonly externalAdId: string;
    readonly externalAdGroupId: string;
    readonly adType?: string;
    readonly headlines?: readonly string[];
    readonly descriptions?: readonly string[];
    readonly finalUrl: string;
  }[];
  readonly keywords: readonly {
    readonly externalKeywordId: string;
    readonly externalAdGroupId?: string;
    readonly text: string;
    readonly matchType: "EXACT" | "PHRASE" | "BROAD";
    readonly isNegative?: boolean;
    readonly qualityScore?: number;
  }[];
  readonly searchTerms: readonly {
    readonly externalCampaignId?: string;
    readonly externalAdGroupId?: string;
    readonly searchTerm: string;
    readonly impressions?: number;
    readonly clicks?: number;
    readonly costMicros: number;
    readonly conversions?: number;
    readonly observedDate: string;
  }[];
  readonly conversions: readonly {
    readonly externalConversionId: string;
    readonly name: string;
    readonly category?: string;
    readonly attributionModel?: string;
  }[];
  readonly dailyMetrics: readonly {
    readonly externalCampaignId: string;
    readonly metricDate: string;
    readonly impressions: number;
    readonly clicks: number;
    readonly costMicros: number;
    readonly conversions: number;
    readonly conversionValueMicros: number;
  }[];
  readonly budgets: readonly {
    readonly periodMonth: string;
    readonly allocatedMicros: number;
    readonly spentMicros: number;
    readonly maxDailyHardLimitMicros?: number;
  }[];
}

export interface NormalizedDailyMetricRecord {
  readonly organizationId: string;
  readonly externalCampaignId: string;
  readonly metricDate: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly costCents: number;
  readonly conversions: number;
  readonly conversionValueCents: number;
  readonly ctrPct: number;
  readonly cpcCents: number;
  readonly cpaCents: number;
  readonly roas: number;
  readonly currencyCode: string;
  readonly timezone: string;
  readonly isDemoData: boolean;
}

export const SCHEDULED_GOOGLE_ADS_SYNC_JOB = {
  jobId: "cron-google-ads-readonly-incremental-sync",
  cronExpression: "0 */4 * * *",
  executionMode: "READ_ONLY",
  enabledInProduction: false,
} as const;

/**
 * Persistent PostgreSQL Synchronization Engine (Section 11).
 * - Persists all 9 domains into their respective PostgreSQL tables with idempotent upserts:
 *   1. ad_accounts
 *   2. campaigns
 *   3. ad_groups
 *   4. ads
 *   5. keywords
 *   6. search_terms
 *   7. conversions
 *   8. daily_metrics
 *   9. budgets
 * - Uses durable PostgreSQL concurrency locking via `sync_runs` status='RUNNING' checks
 *   (no in-memory Set required across processes).
 * - Persists checkpoints in `integrations.last_checkpoint_token` and `sync_runs.checkpoint_token`.
 * - Recovers stale running sync jobs after process restart.
 * - Records audit events (`SYNC_STARTED`, `SYNC_COMPLETED`, `SYNC_FAILED`).
 */
export class PersistentPostgresAdsSyncEngine {
  constructor(private readonly db: DrizzleQueryExecutor) {}

  /**
   * Recovers any stale `RUNNING` sync jobs after an unexpected process crash/restart.
   */
  public async recoverStaleRunningSyncs(
    context: TenantContext,
    integrationId: string
  ): Promise<number> {
    const authCtx = assertAuthenticatedDbContext(context);
    const staleRows: (typeof schema.syncRuns.$inferSelect)[] = await this.db
      .select()
      .from(schema.syncRuns)
      .where(
        and(
          eq(schema.syncRuns.organizationId, authCtx.organizationId),
          eq(schema.syncRuns.integrationId, integrationId),
          eq(schema.syncRuns.status, "RUNNING")
        )
      );

    for (const stale of staleRows) {
      await this.db
        .update(schema.syncRuns)
        .set({
          status: "FAILED",
          errorCode: "RECOVERED_AFTER_RESTART",
          errorMessage:
            "Sync run was interrupted by a process restart and marked as recovered.",
          completedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, stale.id));
    }

    return staleRows.length;
  }

  public async getLastSuccessfulSync(
    context: TenantContext,
    integrationId: string
  ): Promise<typeof schema.syncRuns.$inferSelect | null> {
    const authCtx = assertAuthenticatedDbContext(context);
    const rows: (typeof schema.syncRuns.$inferSelect)[] = await this.db
      .select()
      .from(schema.syncRuns)
      .where(
        and(
          eq(schema.syncRuns.organizationId, authCtx.organizationId),
          eq(schema.syncRuns.integrationId, integrationId),
          eq(schema.syncRuns.status, "COMPLETED")
        )
      )
      .orderBy(desc(schema.syncRuns.completedAt));

    return rows[0] ?? null;
  }

  public async executePersistentSync(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly clientId: string;
    readonly provider: AdProviderType;
    readonly fetchBatchFn: (
      lastCheckpoint: string | null
    ) => Promise<RawProviderSyncBatch>;
  }): Promise<typeof schema.syncRuns.$inferSelect> {
    const {
      context,
      integrationId,
      clientId,
      provider,
      fetchBatchFn,
    } = params;

    const authCtx = assertAuthenticatedDbContext(context);

    // 1. Durable PostgreSQL Concurrency Lock Check: inspect `sync_runs` for active RUNNING job
    const activeRunning: (typeof schema.syncRuns.$inferSelect)[] =
      await this.db
        .select()
        .from(schema.syncRuns)
        .where(
          and(
            eq(schema.syncRuns.organizationId, authCtx.organizationId),
            eq(schema.syncRuns.integrationId, integrationId),
            eq(schema.syncRuns.status, "RUNNING")
          )
        );

    const integrationsFound: (typeof schema.integrations.$inferSelect)[] =
      await this.db
        .select()
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.organizationId, authCtx.organizationId),
            eq(schema.integrations.id, integrationId)
          )
        );

    const integration = integrationsFound[0];
    if (!integration) {
      throw new Error(
        `Integration '${integrationId}' not found for organization '${authCtx.organizationId}'.`
      );
    }

    const previousCheckpoint = integration.lastCheckpointToken ?? null;

    if (activeRunning.length > 0) {
      const [skipped] = await this.db
        .insert(schema.syncRuns)
        .values({
          organizationId: authCtx.organizationId,
          integrationId,
          provider,
          status: "SKIPPED_CONCURRENT_LOCK",
          checkpointToken: previousCheckpoint ?? "INITIAL",
          entitiesSynced: {
            adAccounts: 0,
            campaigns: 0,
            adGroups: 0,
            ads: 0,
            keywords: 0,
            searchTerms: 0,
            conversions: 0,
            dailyMetrics: 0,
            budgets: 0,
          },
          isDemoData: provider === "MOCK_ADS",
          startedAt: new Date(),
          completedAt: new Date(),
        })
        .returning();

      if (!skipped) {
        throw new Error("Falha ao registrar sync_run SKIPPED_CONCURRENT_LOCK.");
      }

      return skipped;
    }

    // 2. Insert RUNNING sync_run lock row in PostgreSQL + Audit Log
    const [runningJob] = await this.db
      .insert(schema.syncRuns)
      .values({
        organizationId: authCtx.organizationId,
        integrationId,
        provider,
        status: "RUNNING",
        checkpointToken: previousCheckpoint,
        entitiesSynced: {},
        isDemoData: provider === "MOCK_ADS",
        startedAt: new Date(),
      })
      .returning();

    if (!runningJob) {
      throw new Error("Falha ao criar job de sincronização RUNNING.");
    }

    await this.db.insert(schema.auditLogs).values({
      organizationId: authCtx.organizationId,
      actorUserId: authCtx.userId,
      actorType: "USER",
      action: "SYNC_STARTED",
      entityType: "sync_run",
      entityId: runningJob.id,
      newState: {
        integrationId,
        provider,
        previousCheckpoint,
      },
    });

    try {
      const batch = await fetchBatchFn(previousCheckpoint);

      // ----------------------------------------------------------------------
      // DOMAIN 1: AD ACCOUNTS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      let primaryAdAccountId: string | null = null;
      for (const acc of batch.adAccounts) {
        const existingAcc: (typeof schema.adAccounts.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.adAccounts)
            .where(
              and(
                eq(schema.adAccounts.organizationId, authCtx.organizationId),
                eq(schema.adAccounts.provider, provider),
                eq(schema.adAccounts.externalAccountId, acc.externalAccountId)
              )
            );

        if (existingAcc[0]) {
          const [upd] = await this.db
            .update(schema.adAccounts)
            .set({
              name: acc.name,
              currencyCode: batch.currencyCode,
              timezone: batch.timezone,
              managerCustomerId:
                acc.managerCustomerId ?? existingAcc[0].managerCustomerId,
              isMccAccount: acc.isMccAccount ?? existingAcc[0].isMccAccount,
              isDemoData: batch.isDemoData,
              updatedAt: new Date(),
            })
            .where(eq(schema.adAccounts.id, existingAcc[0].id))
            .returning();
          if (upd) {
            primaryAdAccountId = primaryAdAccountId ?? upd.id;
          }
        } else {
          const [ins] = await this.db
            .insert(schema.adAccounts)
            .values({
              organizationId: authCtx.organizationId,
              clientId,
              integrationId,
              provider,
              externalAccountId: acc.externalAccountId,
              name: acc.name,
              currencyCode: batch.currencyCode,
              timezone: batch.timezone,
              managerCustomerId: acc.managerCustomerId ?? null,
              isMccAccount: acc.isMccAccount ?? false,
              isSelectedForSync: true,
              isDemoData: batch.isDemoData,
            })
            .returning();
          if (ins) {
            primaryAdAccountId = primaryAdAccountId ?? ins.id;
          }
        }
      }

      if (!primaryAdAccountId) {
        const fallbackAccs: (typeof schema.adAccounts.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.adAccounts)
            .where(
              and(
                eq(schema.adAccounts.organizationId, authCtx.organizationId),
                eq(schema.adAccounts.integrationId, integrationId)
              )
            );
        primaryAdAccountId = fallbackAccs[0]?.id ?? null;
      }

      if (!primaryAdAccountId) {
        throw new Error(
          "Sync batch must contain or reference at least one Ad Account."
        );
      }

      // ----------------------------------------------------------------------
      // DOMAIN 2: CAMPAIGNS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      const campaignIdByExternalId = new Map<string, string>();
      for (const camp of batch.campaigns) {
        const dailyBudgetCents = convertGoogleAdsMicrosToCents(
          camp.dailyBudgetMicros
        );
        const existingCamp: (typeof schema.campaigns.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.campaigns)
            .where(
              and(
                eq(schema.campaigns.organizationId, authCtx.organizationId),
                eq(schema.campaigns.provider, provider),
                eq(schema.campaigns.externalCampaignId, camp.externalCampaignId)
              )
            );

        if (existingCamp[0]) {
          const [upd] = await this.db
            .update(schema.campaigns)
            .set({
              name: camp.name,
              status: camp.status ?? "ENABLED",
              channelType: camp.channelType ?? "SEARCH",
              biddingStrategy: camp.biddingStrategy ?? "TARGET_CPA",
              dailyBudgetCents,
              isDemoData: batch.isDemoData,
              updatedAt: new Date(),
            })
            .where(eq(schema.campaigns.id, existingCamp[0].id))
            .returning();
          if (upd) {
            campaignIdByExternalId.set(camp.externalCampaignId, upd.id);
          }
        } else {
          const [ins] = await this.db
            .insert(schema.campaigns)
            .values({
              organizationId: authCtx.organizationId,
              adAccountId: primaryAdAccountId,
              provider,
              externalCampaignId: camp.externalCampaignId,
              name: camp.name,
              status: camp.status ?? "ENABLED",
              channelType: camp.channelType ?? "SEARCH",
              biddingStrategy: camp.biddingStrategy ?? "TARGET_CPA",
              dailyBudgetCents,
              isDemoData: batch.isDemoData,
            })
            .returning();
          if (ins) {
            campaignIdByExternalId.set(camp.externalCampaignId, ins.id);
          }
        }
      }

      const defaultCampaignId = Array.from(campaignIdByExternalId.values())[0];

      // ----------------------------------------------------------------------
      // DOMAIN 3: AD GROUPS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      const adGroupIdByExternalId = new Map<string, string>();
      for (const ag of batch.adGroups) {
        const campaignId =
          campaignIdByExternalId.get(ag.externalCampaignId) ??
          defaultCampaignId;
        if (!campaignId) continue;

        const defaultCpcBidCents = ag.defaultCpcBidMicros
          ? convertGoogleAdsMicrosToCents(ag.defaultCpcBidMicros)
          : null;

        const existingAg: (typeof schema.adGroups.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.adGroups)
            .where(
              and(
                eq(schema.adGroups.organizationId, authCtx.organizationId),
                eq(schema.adGroups.campaignId, campaignId),
                eq(schema.adGroups.externalAdGroupId, ag.externalAdGroupId)
              )
            );

        if (existingAg[0]) {
          const [upd] = await this.db
            .update(schema.adGroups)
            .set({
              name: ag.name,
              defaultCpcBidCents,
              updatedAt: new Date(),
            })
            .where(eq(schema.adGroups.id, existingAg[0].id))
            .returning();
          if (upd) {
            adGroupIdByExternalId.set(ag.externalAdGroupId, upd.id);
          }
        } else {
          const [ins] = await this.db
            .insert(schema.adGroups)
            .values({
              organizationId: authCtx.organizationId,
              campaignId,
              externalAdGroupId: ag.externalAdGroupId,
              name: ag.name,
              defaultCpcBidCents,
            })
            .returning();
          if (ins) {
            adGroupIdByExternalId.set(ag.externalAdGroupId, ins.id);
          }
        }
      }

      const defaultAdGroupId = Array.from(adGroupIdByExternalId.values())[0];

      // ----------------------------------------------------------------------
      // DOMAIN 4: ADS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      for (const ad of batch.ads) {
        const adGroupId =
          adGroupIdByExternalId.get(ad.externalAdGroupId) ?? defaultAdGroupId;
        if (!adGroupId) continue;

        const existingAd: (typeof schema.ads.$inferSelect)[] = await this.db
          .select()
          .from(schema.ads)
          .where(
            and(
              eq(schema.ads.organizationId, authCtx.organizationId),
              eq(schema.ads.adGroupId, adGroupId),
              eq(schema.ads.externalAdId, ad.externalAdId)
            )
          );

        if (existingAd[0]) {
          await this.db
            .update(schema.ads)
            .set({
              finalUrl: ad.finalUrl,
              headlines: [...(ad.headlines ?? ["Anúncio Search"])],
              descriptions: [...(ad.descriptions ?? ["Descrição oficial"])],
              updatedAt: new Date(),
            })
            .where(eq(schema.ads.id, existingAd[0].id));
        } else {
          await this.db.insert(schema.ads).values({
            organizationId: authCtx.organizationId,
            adGroupId,
            externalAdId: ad.externalAdId,
            adType: ad.adType ?? "RESPONSIVE_SEARCH_AD",
            headlines: [...(ad.headlines ?? ["Anúncio Search"])],
            descriptions: [...(ad.descriptions ?? ["Descrição oficial"])],
            finalUrl: ad.finalUrl,
          });
        }
      }

      // ----------------------------------------------------------------------
      // DOMAIN 5: KEYWORDS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      for (const kw of batch.keywords) {
        const adGroupId =
          (kw.externalAdGroupId
            ? adGroupIdByExternalId.get(kw.externalAdGroupId)
            : undefined) ?? defaultAdGroupId;
        if (!adGroupId) continue;

        const existingKw: (typeof schema.keywords.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.keywords)
            .where(
              and(
                eq(schema.keywords.organizationId, authCtx.organizationId),
                eq(schema.keywords.adGroupId, adGroupId),
                eq(schema.keywords.externalKeywordId, kw.externalKeywordId)
              )
            );

        if (existingKw[0]) {
          await this.db
            .update(schema.keywords)
            .set({
              text: kw.text,
              matchType: kw.matchType,
              isNegative: kw.isNegative ?? false,
              qualityScore: kw.qualityScore ?? null,
              updatedAt: new Date(),
            })
            .where(eq(schema.keywords.id, existingKw[0].id));
        } else {
          await this.db.insert(schema.keywords).values({
            organizationId: authCtx.organizationId,
            adGroupId,
            externalKeywordId: kw.externalKeywordId,
            text: kw.text,
            matchType: kw.matchType,
            isNegative: kw.isNegative ?? false,
            qualityScore: kw.qualityScore ?? null,
          });
        }
      }

      // ----------------------------------------------------------------------
      // DOMAIN 6: SEARCH TERMS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      for (const st of batch.searchTerms) {
        const campaignId =
          (st.externalCampaignId
            ? campaignIdByExternalId.get(st.externalCampaignId)
            : undefined) ?? defaultCampaignId;
        if (!campaignId) continue;

        const adGroupId =
          (st.externalAdGroupId
            ? adGroupIdByExternalId.get(st.externalAdGroupId)
            : undefined) ??
          defaultAdGroupId ??
          null;

        const costCents = convertGoogleAdsMicrosToCents(st.costMicros);
        const existingSt: (typeof schema.searchTerms.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.searchTerms)
            .where(
              and(
                eq(schema.searchTerms.organizationId, authCtx.organizationId),
                eq(schema.searchTerms.campaignId, campaignId),
                eq(schema.searchTerms.searchTerm, st.searchTerm),
                eq(schema.searchTerms.observedDate, st.observedDate)
              )
            );

        if (existingSt[0]) {
          await this.db
            .update(schema.searchTerms)
            .set({
              impressions: st.impressions ?? existingSt[0].impressions,
              clicks: st.clicks ?? existingSt[0].clicks,
              costCents,
              conversions: String(st.conversions ?? 0),
            })
            .where(eq(schema.searchTerms.id, existingSt[0].id));
        } else {
          await this.db.insert(schema.searchTerms).values({
            organizationId: authCtx.organizationId,
            campaignId,
            adGroupId,
            searchTerm: st.searchTerm,
            impressions: st.impressions ?? 10,
            clicks: st.clicks ?? 2,
            costCents,
            conversions: String(st.conversions ?? 0),
            observedDate: st.observedDate,
          });
        }
      }

      // ----------------------------------------------------------------------
      // DOMAIN 7: CONVERSIONS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      for (const conv of batch.conversions) {
        const existingConv: (typeof schema.conversions.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.conversions)
            .where(
              and(
                eq(schema.conversions.organizationId, authCtx.organizationId),
                eq(schema.conversions.adAccountId, primaryAdAccountId),
                eq(
                  schema.conversions.externalConversionId,
                  conv.externalConversionId
                )
              )
            );

        if (existingConv[0]) {
          await this.db
            .update(schema.conversions)
            .set({
              name: conv.name,
              category: conv.category ?? "LEAD",
              attributionModel: conv.attributionModel ?? "DATA_DRIVEN",
              lastReceivedAt: new Date(),
            })
            .where(eq(schema.conversions.id, existingConv[0].id));
        } else {
          await this.db.insert(schema.conversions).values({
            organizationId: authCtx.organizationId,
            adAccountId: primaryAdAccountId,
            externalConversionId: conv.externalConversionId,
            name: conv.name,
            category: conv.category ?? "LEAD",
            attributionModel: conv.attributionModel ?? "DATA_DRIVEN",
            lastReceivedAt: new Date(),
          });
        }
      }

      // ----------------------------------------------------------------------
      // DOMAIN 8: DAILY METRICS (Idempotent Upsert & Reconciliation)
      // ----------------------------------------------------------------------
      for (const dm of batch.dailyMetrics) {
        const campaignId =
          campaignIdByExternalId.get(dm.externalCampaignId) ??
          defaultCampaignId;
        if (!campaignId) continue;

        const costCents = convertGoogleAdsMicrosToCents(dm.costMicros);
        const conversionValueCents = convertGoogleAdsMicrosToCents(
          dm.conversionValueMicros
        );
        const ctrPct =
          dm.impressions > 0
            ? Number(((dm.clicks / dm.impressions) * 100).toFixed(2))
            : 0;
        const cpcCents = dm.clicks > 0 ? Math.round(costCents / dm.clicks) : 0;
        const cpaCents =
          dm.conversions > 0 ? Math.round(costCents / dm.conversions) : 0;
        const roas =
          costCents > 0
            ? Number((conversionValueCents / costCents).toFixed(2))
            : 0;

        const existingDm: (typeof schema.dailyMetrics.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.dailyMetrics)
            .where(
              and(
                eq(schema.dailyMetrics.organizationId, authCtx.organizationId),
                eq(schema.dailyMetrics.campaignId, campaignId),
                eq(schema.dailyMetrics.metricDate, dm.metricDate)
              )
            );

        if (existingDm[0]) {
          await this.db
            .update(schema.dailyMetrics)
            .set({
              impressions: dm.impressions,
              clicks: dm.clicks,
              costCents,
              conversions: String(dm.conversions),
              conversionValueCents,
              ctrPct: String(ctrPct),
              cpcCents,
              cpaCents,
              roas: String(roas),
              isDemoData: batch.isDemoData,
            })
            .where(eq(schema.dailyMetrics.id, existingDm[0].id));
        } else {
          await this.db.insert(schema.dailyMetrics).values({
            organizationId: authCtx.organizationId,
            campaignId,
            metricDate: dm.metricDate,
            impressions: dm.impressions,
            clicks: dm.clicks,
            costCents,
            conversions: String(dm.conversions),
            conversionValueCents,
            ctrPct: String(ctrPct),
            cpcCents,
            cpaCents,
            roas: String(roas),
            isDemoData: batch.isDemoData,
          });
        }
      }

      // ----------------------------------------------------------------------
      // DOMAIN 9: BUDGETS (Idempotent Upsert)
      // ----------------------------------------------------------------------
      for (const b of batch.budgets) {
        const allocatedCents = convertGoogleAdsMicrosToCents(b.allocatedMicros);
        const spentCents = convertGoogleAdsMicrosToCents(b.spentMicros);
        const maxDailyHardLimitCents = b.maxDailyHardLimitMicros
          ? convertGoogleAdsMicrosToCents(b.maxDailyHardLimitMicros)
          : Math.round(allocatedCents / 20);

        const existingBudget: (typeof schema.budgets.$inferSelect)[] =
          await this.db
            .select()
            .from(schema.budgets)
            .where(
              and(
                eq(schema.budgets.organizationId, authCtx.organizationId),
                eq(schema.budgets.clientId, clientId),
                eq(schema.budgets.periodMonth, b.periodMonth)
              )
            );

        if (existingBudget[0]) {
          await this.db
            .update(schema.budgets)
            .set({
              allocatedCents,
              spentCents,
              maxDailyHardLimitCents,
              updatedAt: new Date(),
            })
            .where(eq(schema.budgets.id, existingBudget[0].id));
        } else {
          await this.db.insert(schema.budgets).values({
            organizationId: authCtx.organizationId,
            clientId,
            campaignId: defaultCampaignId ?? null,
            periodMonth: b.periodMonth,
            allocatedCents,
            spentCents,
            maxDailyHardLimitCents,
          });
        }
      }

      const counts: SyncEntityCounts = {
        adAccounts: batch.adAccounts.length,
        campaigns: batch.campaigns.length,
        adGroups: batch.adGroups.length,
        ads: batch.ads.length,
        keywords: batch.keywords.length,
        searchTerms: batch.searchTerms.length,
        conversions: batch.conversions.length,
        dailyMetrics: batch.dailyMetrics.length,
        budgets: batch.budgets.length,
      };

      const completedAt = new Date();

      await this.db
        .update(schema.integrations)
        .set({
          lastSyncedAt: completedAt,
          lastCheckpointToken: batch.checkpointToken,
          updatedAt: completedAt,
        })
        .where(eq(schema.integrations.id, integrationId));

      const [completedJob] = await this.db
        .update(schema.syncRuns)
        .set({
          adAccountId: primaryAdAccountId,
          status: "COMPLETED",
          checkpointToken: batch.checkpointToken,
          entitiesSynced: counts,
          isDemoData: batch.isDemoData,
          completedAt,
        })
        .where(eq(schema.syncRuns.id, runningJob.id))
        .returning();

      if (!completedJob) {
        throw new Error("Falha ao concluir sync_run COMPLETED.");
      }

      await this.db.insert(schema.auditLogs).values({
        organizationId: authCtx.organizationId,
        actorUserId: authCtx.userId,
        actorType: "USER",
        action: "SYNC_COMPLETED",
        entityType: "sync_run",
        entityId: runningJob.id,
        newState: {
          checkpointToken: batch.checkpointToken,
          entitiesSynced: counts,
        },
      });

      return completedJob;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Unknown sync failure";
      await this.db
        .update(schema.syncRuns)
        .set({
          status: "FAILED",
          errorCode:
            error instanceof Error ? error.name : "SYNC_EXECUTION_ERROR",
          errorMessage: errorMsg,
          completedAt: new Date(),
        })
        .where(eq(schema.syncRuns.id, runningJob.id));

      await this.db.insert(schema.auditLogs).values({
        organizationId: authCtx.organizationId,
        actorUserId: authCtx.userId,
        actorType: "SYSTEM",
        action: "SYNC_FAILED",
        entityType: "sync_run",
        entityId: runningJob.id,
        newState: { error: errorMsg },
      });

      throw error;
    }
  }
}

/**
 * Legacy-compatible in-memory sync engine kept for existing Stage 2 unit tests.
 */
export class IncrementalAdsSyncEngine {
  private readonly activeLocks = new Set<string>();
  private readonly checkpoints = new Map<string, string>();
  private readonly syncHistory: SyncRunRecord[] = [];
  private readonly normalizedMetricsStore = new Map<
    string,
    NormalizedDailyMetricRecord
  >();
  private readonly syncedCampaignsStore = new Map<
    string,
    {
      readonly organizationId: string;
      readonly externalCampaignId: string;
      readonly name: string;
      readonly dailyBudgetCents: number;
      readonly provider: AdProviderType;
      readonly isDemoData: boolean;
    }
  >();

  private lockKey(organizationId: string, adAccountId: string): string {
    return `${organizationId}:${adAccountId}`;
  }

  public getLastCheckpoint(
    organizationId: string,
    adAccountId: string
  ): string | null {
    return (
      this.checkpoints.get(this.lockKey(organizationId, adAccountId)) ?? null
    );
  }

  public getSyncHistory(context: TenantContext): SyncRunRecord[] {
    assertTenantAccess(context, context.organizationId);
    return this.syncHistory.filter(
      (r) => r.organizationId === context.organizationId
    );
  }

  public getSyncedDailyMetrics(
    context: TenantContext
  ): NormalizedDailyMetricRecord[] {
    assertTenantAccess(context, context.organizationId);
    return Array.from(this.normalizedMetricsStore.values()).filter(
      (m) => m.organizationId === context.organizationId
    );
  }

  public async runIncrementalSync(params: {
    readonly context: TenantContext;
    readonly integrationId: string;
    readonly adAccountId: string;
    readonly provider: AdProviderType;
    readonly fetchBatchFn: (
      lastCheckpoint: string | null
    ) => Promise<RawProviderSyncBatch>;
  }): Promise<SyncRunRecord> {
    const {
      context,
      integrationId,
      adAccountId,
      provider,
      fetchBatchFn,
    } = params;

    assertTenantAccess(context, context.organizationId);
    const key = this.lockKey(context.organizationId, adAccountId);
    const startedAtIso = new Date().toISOString();

    if (this.activeLocks.has(key)) {
      const skippedRecord: SyncRunRecord = {
        id: `sync-skip-${Date.now()}`,
        organizationId: context.organizationId,
        integrationId,
        adAccountId,
        provider,
        status: "SKIPPED_CONCURRENT_LOCK",
        checkpointToken: this.checkpoints.get(key) ?? "INITIAL",
        entitiesSynced: {
          adAccounts: 0,
          campaigns: 0,
          adGroups: 0,
          ads: 0,
          keywords: 0,
          searchTerms: 0,
          conversions: 0,
          dailyMetrics: 0,
          budgets: 0,
        },
        currencyCode: "BRL",
        timezone: "America/Sao_Paulo",
        isDemoData: provider === "MOCK_ADS",
        startedAtIso,
        completedAtIso: new Date().toISOString(),
      };
      this.syncHistory.unshift(skippedRecord);
      return skippedRecord;
    }

    this.activeLocks.add(key);

    try {
      const previousCheckpoint = this.checkpoints.get(key) ?? null;
      const batch = await fetchBatchFn(previousCheckpoint);

      for (const camp of batch.campaigns) {
        const dailyBudgetCents = convertGoogleAdsMicrosToCents(
          camp.dailyBudgetMicros
        );
        const campKey = `${context.organizationId}:${provider}:${camp.externalCampaignId}`;
        this.syncedCampaignsStore.set(campKey, {
          organizationId: context.organizationId,
          externalCampaignId: camp.externalCampaignId,
          name: camp.name,
          dailyBudgetCents,
          provider,
          isDemoData: batch.isDemoData,
        });
      }

      for (const dm of batch.dailyMetrics) {
        const costCents = convertGoogleAdsMicrosToCents(dm.costMicros);
        const conversionValueCents = convertGoogleAdsMicrosToCents(
          dm.conversionValueMicros
        );
        const ctrPct =
          dm.impressions > 0
            ? Number(((dm.clicks / dm.impressions) * 100).toFixed(2))
            : 0;
        const cpcCents = dm.clicks > 0 ? Math.round(costCents / dm.clicks) : 0;
        const cpaCents =
          dm.conversions > 0 ? Math.round(costCents / dm.conversions) : 0;
        const roas =
          costCents > 0
            ? Number((conversionValueCents / costCents).toFixed(2))
            : 0;

        const metricCompositeKey = `${context.organizationId}:${dm.externalCampaignId}:${dm.metricDate}`;
        this.normalizedMetricsStore.set(metricCompositeKey, {
          organizationId: context.organizationId,
          externalCampaignId: dm.externalCampaignId,
          metricDate: dm.metricDate,
          impressions: dm.impressions,
          clicks: dm.clicks,
          costCents,
          conversions: dm.conversions,
          conversionValueCents,
          ctrPct,
          cpcCents,
          cpaCents,
          roas,
          currencyCode: batch.currencyCode,
          timezone: batch.timezone,
          isDemoData: batch.isDemoData,
        });
      }

      this.checkpoints.set(key, batch.checkpointToken);

      const completedRecord: SyncRunRecord = {
        id: `sync-ok-${Date.now()}`,
        organizationId: context.organizationId,
        integrationId,
        adAccountId,
        provider,
        status: "COMPLETED",
        checkpointToken: batch.checkpointToken,
        entitiesSynced: {
          adAccounts: batch.adAccounts.length,
          campaigns: batch.campaigns.length,
          adGroups: batch.adGroups.length,
          ads: batch.ads.length,
          keywords: batch.keywords.length,
          searchTerms: batch.searchTerms.length,
          conversions: batch.conversions.length,
          dailyMetrics: batch.dailyMetrics.length,
          budgets: batch.budgets.length,
        },
        currencyCode: batch.currencyCode,
        timezone: batch.timezone,
        isDemoData: batch.isDemoData,
        startedAtIso,
        completedAtIso: new Date().toISOString(),
      };

      this.syncHistory.unshift(completedRecord);
      return completedRecord;
    } catch (error) {
      const failedRecord: SyncRunRecord = {
        id: `sync-fail-${Date.now()}`,
        organizationId: context.organizationId,
        integrationId,
        adAccountId,
        provider,
        status: "FAILED",
        checkpointToken: this.checkpoints.get(key) ?? "INITIAL",
        entitiesSynced: {
          adAccounts: 0,
          campaigns: 0,
          adGroups: 0,
          ads: 0,
          keywords: 0,
          searchTerms: 0,
          conversions: 0,
          dailyMetrics: 0,
          budgets: 0,
        },
        currencyCode: "BRL",
        timezone: "America/Sao_Paulo",
        isDemoData: provider === "MOCK_ADS",
        startedAtIso,
        completedAtIso: new Date().toISOString(),
        errorCode:
          error instanceof Error ? error.name : "SYNC_EXECUTION_ERROR",
      };
      this.syncHistory.unshift(failedRecord);
      throw error;
    } finally {
      this.activeLocks.delete(key);
    }
  }
}
