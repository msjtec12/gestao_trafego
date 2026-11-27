import { desc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleQueryExecutor } from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";

export type DataIntegrityStatus =
  | "VERIFIED"
  | "CONTAMINATED"
  | "INCOMPLETE_SYNC"
  | "UNAUTHORIZED"
  | "NO_DATA";

export interface OrganizationDataIntegrityReport {
  readonly organizationId: string;
  readonly overallStatus: DataIntegrityStatus;
  readonly isContaminated: boolean;
  readonly hasIncompleteLatestSync: boolean;
  readonly hasUnauthorizedAccount: boolean;
  readonly isStale: boolean;
  readonly lastVerifiedSyncAtIso: string | null;
  readonly blockingReasons: readonly string[];
  readonly counts: {
    readonly syntheticCampaigns: number;
    readonly syntheticAdAccounts: number;
    readonly contaminatedDailyMetrics: number;
    readonly contaminatedRecommendations: number;
    readonly contaminatedReports: number;
    readonly falseCompletedSyncRuns: number;
  };
  readonly ids: {
    readonly syntheticCampaignIds: readonly string[];
    readonly syntheticAdAccountIds: readonly string[];
    readonly contaminatedDailyMetricIds: readonly string[];
    readonly contaminatedRecommendationIds: readonly string[];
    readonly contaminatedReportIds: readonly string[];
    readonly falseCompletedSyncRunIds: readonly string[];
  };
}

const STALE_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Read-only reconciliation audit for an organization (strictly scoped by `organization_id` + RLS).
 * Identifies synthetic campaigns (`CAMP-*` / `is_demo_data`), fake ad accounts (`4028819001` / non-10-digit),
 * contaminated daily metrics, recommendations on synthetic campaigns, reports, and falsely-completed sync runs
 * (`ckpt-pg-*`). NEVER deletes or mutates any production data.
 */
export async function auditOrganizationDataIntegrity(
  tx: DrizzleQueryExecutor,
  organizationId: string,
  nowMs: number = Date.now()
): Promise<OrganizationDataIntegrityReport> {
  const [
    syntheticCampaignRows,
    syntheticAccountRows,
    allCampaignRows,
    syncRunRows,
    integrationRows,
  ] = await Promise.all([
    tx
      .select({ id: schema.campaigns.id, adAccountId: schema.campaigns.adAccountId })
      .from(schema.campaigns)
      .where(
        sql`${schema.campaigns.organizationId} = ${organizationId}
          AND (${schema.campaigns.isDemoData} = true
            OR (${schema.campaigns.provider} = 'GOOGLE_ADS'
                AND ${schema.campaigns.externalCampaignId} !~ '^[0-9]+$'))`
      ),
    tx
      .select({ id: schema.adAccounts.id, clientId: schema.adAccounts.clientId })
      .from(schema.adAccounts)
      .where(
        sql`${schema.adAccounts.organizationId} = ${organizationId}
          AND (${schema.adAccounts.isDemoData} = true
            OR (${schema.adAccounts.provider} = 'GOOGLE_ADS'
                AND (${schema.adAccounts.externalAccountId} = '4028819001'
                     OR ${schema.adAccounts.externalAccountId} !~ '^[0-9]{10}$')))`
      ),
    tx
      .select({ id: schema.campaigns.id, provider: schema.campaigns.provider })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.organizationId, organizationId)),
    tx
      .select()
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.organizationId, organizationId))
      .orderBy(desc(schema.syncRuns.startedAt)),
    tx
      .select({
        id: schema.integrations.id,
        provider: schema.integrations.provider,
        status: schema.integrations.status,
      })
      .from(schema.integrations)
      .where(eq(schema.integrations.organizationId, organizationId)),
  ]);

  const syntheticCampaignIds = syntheticCampaignRows.map((r) => r.id);
  const syntheticAdAccountIds = syntheticAccountRows.map((r) => r.id);

  // Contaminated daily metrics
  const contaminatedMetricRows = await tx
    .select({ id: schema.dailyMetrics.id })
    .from(schema.dailyMetrics)
    .where(
      syntheticCampaignIds.length > 0
        ? sql`${schema.dailyMetrics.organizationId} = ${organizationId}
            AND (${schema.dailyMetrics.isDemoData} = true
                 OR ${inArray(schema.dailyMetrics.campaignId, syntheticCampaignIds)})`
        : sql`${schema.dailyMetrics.organizationId} = ${organizationId}
            AND ${schema.dailyMetrics.isDemoData} = true`
    );
  const contaminatedDailyMetricIds = contaminatedMetricRows.map((r) => r.id);

  // Contaminated recommendations
  const contaminatedRecRows = await tx
    .select({ id: schema.recommendations.id })
    .from(schema.recommendations)
    .where(
      syntheticCampaignIds.length > 0
        ? sql`${schema.recommendations.organizationId} = ${organizationId}
            AND (${schema.recommendations.isDemoData} = true
                 OR ${inArray(schema.recommendations.campaignId, syntheticCampaignIds)})`
        : sql`${schema.recommendations.organizationId} = ${organizationId}
            AND ${schema.recommendations.isDemoData} = true`
    );
  const contaminatedRecommendationIds = contaminatedRecRows.map((r) => r.id);

  // Contaminated reports (reports for clients affected by synthetic accounts/campaigns)
  const affectedClientIds = Array.from(
    new Set(syntheticAccountRows.map((a) => a.clientId))
  );
  const contaminatedReportRows =
    affectedClientIds.length > 0
      ? await tx
          .select({ id: schema.reports.id })
          .from(schema.reports)
          .where(
            sql`${schema.reports.organizationId} = ${organizationId}
              AND ${inArray(schema.reports.clientId, affectedClientIds)}`
          )
      : [];
  const contaminatedReportIds = contaminatedReportRows.map((r) => r.id);

  // Falsely completed sync runs (`is_demo_data = true` OR legacy synthetic `ckpt-pg-*`)
  const falseCompletedSyncRunIds = syncRunRows
    .filter(
      (sr) =>
        sr.isDemoData ||
        (sr.checkpointToken !== null &&
          sr.checkpointToken.startsWith("ckpt-pg-"))
    )
    .map((sr) => sr.id);

  const isContaminated =
    syntheticCampaignIds.length > 0 ||
    syntheticAdAccountIds.length > 0 ||
    contaminatedDailyMetricIds.length > 0 ||
    contaminatedRecommendationIds.length > 0 ||
    falseCompletedSyncRunIds.length > 0;

  const latestSync = syncRunRows[0];
  const hasIncompleteLatestSync = Boolean(
    latestSync &&
      (latestSync.status === "RUNNING" || latestSync.status === "FAILED")
  );

  const verifiedCompletedSync = syncRunRows.find(
    (sr) =>
      sr.status === "COMPLETED" &&
      !sr.isDemoData &&
      !(sr.checkpointToken && sr.checkpointToken.startsWith("ckpt-pg-"))
  );
  const lastVerifiedSyncAtIso = verifiedCompletedSync?.completedAt
    ? verifiedCompletedSync.completedAt.toISOString()
    : null;

  const hasGoogleAdsCampaigns = allCampaignRows.some(
    (c) => c.provider === "GOOGLE_ADS"
  );
  const hasConnectedGoogleAds = integrationRows.some(
    (i) => i.provider === "GOOGLE_ADS" && i.status === "CONNECTED"
  );
  const hasUnauthorizedAccount = hasGoogleAdsCampaigns && !hasConnectedGoogleAds;

  const isStale =
    allCampaignRows.length > 0 &&
    lastVerifiedSyncAtIso !== null &&
    nowMs - new Date(lastVerifiedSyncAtIso).getTime() > STALE_SYNC_THRESHOLD_MS;

  const blockingReasons: string[] = [];
  if (isContaminated) {
    blockingReasons.push(
      `Foram detectados registros sintéticos/contaminados (${syntheticCampaignIds.length} campanha(s), ${syntheticAdAccountIds.length} conta(s), ${contaminatedDailyMetricIds.length} métrica(s), ${falseCompletedSyncRunIds.length} sincronização(ões) sintética(s)).`
    );
  }
  if (hasIncompleteLatestSync) {
    blockingReasons.push(
      `A sincronização mais recente está incompleta (status: ${latestSync?.status}).`
    );
  }
  if (hasUnauthorizedAccount) {
    blockingReasons.push(
      "A conta Google Ads não está autorizada/conectada (status diferente de CONNECTED)."
    );
  }

  let overallStatus: DataIntegrityStatus = "NO_DATA";
  if (isContaminated) {
    overallStatus = "CONTAMINATED";
  } else if (hasUnauthorizedAccount) {
    overallStatus = "UNAUTHORIZED";
  } else if (hasIncompleteLatestSync) {
    overallStatus = "INCOMPLETE_SYNC";
  } else if (allCampaignRows.length > 0 && verifiedCompletedSync) {
    overallStatus = "VERIFIED";
  }

  return {
    organizationId,
    overallStatus,
    isContaminated,
    hasIncompleteLatestSync,
    hasUnauthorizedAccount,
    isStale,
    lastVerifiedSyncAtIso,
    blockingReasons,
    counts: {
      syntheticCampaigns: syntheticCampaignIds.length,
      syntheticAdAccounts: syntheticAdAccountIds.length,
      contaminatedDailyMetrics: contaminatedDailyMetricIds.length,
      contaminatedRecommendations: contaminatedRecommendationIds.length,
      contaminatedReports: contaminatedReportIds.length,
      falseCompletedSyncRuns: falseCompletedSyncRunIds.length,
    },
    ids: {
      syntheticCampaignIds,
      syntheticAdAccountIds,
      contaminatedDailyMetricIds,
      contaminatedRecommendationIds,
      contaminatedReportIds,
      falseCompletedSyncRunIds,
    },
  };
}

/**
 * Enforces strict data-integrity gating before AI analysis, recommendation review,
 * or executive report generation.
 */
export async function assertVerifiedOperationalDataForAI(
  tx: DrizzleQueryExecutor,
  organizationId: string
): Promise<OrganizationDataIntegrityReport> {
  const report = await auditOrganizationDataIntegrity(tx, organizationId);

  if (report.isContaminated) {
    throw new Error(
      `Operação bloqueada por integridade de dados: ${report.blockingReasons.join(" ")} Execute a reconciliação e uma sincronização oficial do Google Ads antes de gerar análises ou relatórios.`
    );
  }

  if (report.hasIncompleteLatestSync) {
    throw new Error(
      "Operação bloqueada: a sincronização mais recente está incompleta ou falhou. Conclua uma sincronização oficial completa antes de gerar recomendações ou relatórios."
    );
  }

  if (report.hasUnauthorizedAccount) {
    throw new Error(
      "Operação bloqueada: a conta Google Ads vinculada não está autorizada. Reautorize a integração em modo READ_ONLY antes de prosseguir."
    );
  }

  return report;
}
