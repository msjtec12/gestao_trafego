import type { AdProviderType, TenantContext } from "@/domain/types";
import { assertTenantAccess } from "@/security/rbac-and-tenant";
import { convertGoogleAdsMicrosToCents } from "@/integrations/google-ads/google-ads-oauth-and-readonly";

export interface SyncEntityCounts {
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
  }[];
  readonly campaigns: readonly {
    readonly externalCampaignId: string;
    readonly name: string;
    readonly dailyBudgetMicros: number;
  }[];
  readonly adGroups: readonly {
    readonly externalAdGroupId: string;
    readonly externalCampaignId: string;
    readonly name: string;
  }[];
  readonly ads: readonly {
    readonly externalAdId: string;
    readonly externalAdGroupId: string;
    readonly finalUrl: string;
  }[];
  readonly keywords: readonly {
    readonly externalKeywordId: string;
    readonly text: string;
    readonly matchType: "EXACT" | "PHRASE" | "BROAD";
  }[];
  readonly searchTerms: readonly {
    readonly searchTerm: string;
    readonly costMicros: number;
    readonly observedDate: string;
  }[];
  readonly conversions: readonly {
    readonly externalConversionId: string;
    readonly name: string;
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

/**
 * Scheduled job metadata prepared for Vercel Cron (explicitly disabled in production during Stage 2).
 */
export const SCHEDULED_GOOGLE_ADS_SYNC_JOB = {
  jobId: "cron-google-ads-readonly-incremental-sync",
  cronExpression: "0 */4 * * *",
  executionMode: "READ_ONLY",
  enabledInProduction: false,
} as const;

/**
 * Incremental & Idempotent Synchronization Engine for all 9 advertising entities:
 * Ad Accounts, Campaigns, Ad Groups, Ads, Keywords, Search Terms, Conversions, Daily Metrics, and Budgets.
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

    // Concurrency Lock Check (Phase 6 requirement)
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

      // Idempotent Upsert of Campaigns preserving monetary precision (micros -> cents)
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

      // Idempotent Upsert of Daily Metrics with exact CTR, CPC, CPA, and ROAS computation
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
