import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AdProviderType, UserRole } from "@/domain/types";
import { withTenantTransaction } from "@/infrastructure/db";
import * as schema from "@/infrastructure/db/schema";
import { PersistentDrizzleTenantRepository } from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import {
  PersistentAIRecommendationsAndReportsRepository,
  type PersistedExecutiveReport,
  type PersistedRecommendationWithApproval,
} from "@/infrastructure/db/repositories/ai-recommendations-reports-repository";
import {
  AUTHJS_SESSION_COOKIE_NAME,
  resolveUnifiedAuthJsPostgresSession,
  SECURE_AUTHJS_SESSION_COOKIE_NAME,
} from "@/security/auth";
import type {
  AdAccountRecordViewModel,
  AuditEventViewModel,
  IntegrationHealthViewModel,
  MemberRecordViewModel,
  OrganizationOption,
  SyncRunViewModel,
} from "./dashboard-overview-use-case";
import type {
  NormalizedCampaign,
  NormalizedDailyMetric,
} from "@/integrations/contracts/advertising-provider";
import {
  buildGuidedOnboardingChecklist,
  buildIntegrationCatalog,
  isGoogleAdsOAuthEnvReady,
  type CommercialClientViewModel,
  type CommercialIntegrationStatus,
  type GuidedOnboardingStep,
  type IntegrationCardItem,
  type OnboardingStepStatus,
} from "./workspace-helpers";

export {
  buildGuidedOnboardingChecklist,
  buildIntegrationCatalog,
  isGoogleAdsOAuthEnvReady,
  type CommercialClientViewModel,
  type CommercialIntegrationStatus,
  type GuidedOnboardingStep,
  type IntegrationCardItem,
  type OnboardingStepStatus,
};

export interface AdGroupRowViewModel {
  readonly id: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly clientName: string;
  readonly name: string;
  readonly status: string;
  readonly defaultCpcBidBrl: number | null;
  readonly externalAdGroupId: string;
}

export interface AdRowViewModel {
  readonly id: string;
  readonly adGroupId: string;
  readonly adGroupName: string;
  readonly campaignName: string;
  readonly adType: string;
  readonly headlines: readonly string[];
  readonly descriptions: readonly string[];
  readonly finalUrl: string;
  readonly policyApprovalStatus: string;
  readonly status: string;
}

export interface KeywordRowViewModel {
  readonly id: string;
  readonly adGroupId: string;
  readonly adGroupName: string;
  readonly campaignName: string;
  readonly text: string;
  readonly matchType: string;
  readonly isNegative: boolean;
  readonly qualityScore: number | null;
  readonly cpcBidBrl: number | null;
  readonly status: string;
}

export interface SearchTermRowViewModel {
  readonly id: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly searchTerm: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly spendBrl: number;
  readonly conversions: number;
  readonly observedDate: string;
}

export interface ConversionRowViewModel {
  readonly id: string;
  readonly adAccountId: string;
  readonly adAccountName: string;
  readonly name: string;
  readonly category: string;
  readonly attributionModel: string;
  readonly lookbackWindowDays: number;
  readonly isPrimaryGoal: boolean;
  readonly trackingStatus: string;
  readonly lastReceivedAtIso: string | null;
}

export interface BudgetRowViewModel {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly periodMonth: string;
  readonly plannedBudgetBrl: number;
  readonly spentBudgetBrl: number;
  readonly consumptionPct: number;
  readonly pacingAlertThresholdPct: number;
  readonly status: "SAUDAVEL" | "ATENCAO" | "EXCEDIDO" | "SEM_GASTO";
}

export interface AutomationRuleRowViewModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isEnabled: boolean;
  readonly executionMode: string;
  readonly riskLevel: string;
  readonly cooldownMinutes: number;
  readonly lastTriggeredAtIso: string | null;
}

export interface AutomationRunRowViewModel {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly status: string;
  readonly isSimulation: boolean;
  readonly executedAtIso: string;
}

export interface PeriodKpiSummary {
  readonly hasData: boolean;
  readonly periodDays: number;
  readonly spendBrl: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly ctrPct: number | null;
  readonly cpcBrl: number | null;
  readonly conversions: number;
  readonly conversionRatePct: number | null;
  readonly cpaBrl: number | null;
  readonly roas: number | null;
  readonly totalMonthlyBudgetBrl: number;
  readonly budgetConsumptionPct: number | null;
  readonly previousPeriod: {
    readonly hasData: boolean;
    readonly spendBrl: number;
    readonly conversions: number;
    readonly clicks: number;
    readonly impressions: number;
    readonly spendDeltaPct: number | null;
    readonly conversionsDeltaPct: number | null;
    readonly clicksDeltaPct: number | null;
  };
}

export interface OperationalWorkspaceData {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly organizationTimezone: string;
  readonly organizationCurrency: string;
  readonly executionMode: "READ_ONLY";
  readonly emergencyStopActive: boolean;
  readonly authenticatedUserEmail: string;
  readonly authenticatedUserName: string;
  readonly authenticatedUserRole: UserRole;
  readonly organizations: readonly OrganizationOption[];
  readonly clients: readonly CommercialClientViewModel[];
  readonly adAccounts: readonly AdAccountRecordViewModel[];
  readonly members: readonly MemberRecordViewModel[];
  readonly integrations: readonly IntegrationHealthViewModel[];
  readonly integrationCatalog: readonly IntegrationCardItem[];
  readonly campaigns: NormalizedCampaign[];
  readonly dailyMetrics: NormalizedDailyMetric[];
  readonly adGroups: readonly AdGroupRowViewModel[];
  readonly ads: readonly AdRowViewModel[];
  readonly keywords: readonly KeywordRowViewModel[];
  readonly searchTerms: readonly SearchTermRowViewModel[];
  readonly conversions: readonly ConversionRowViewModel[];
  readonly budgets: readonly BudgetRowViewModel[];
  readonly automationRules: readonly AutomationRuleRowViewModel[];
  readonly automationRuns: readonly AutomationRunRowViewModel[];
  readonly syncHistory: readonly SyncRunViewModel[];
  readonly auditTrail: readonly AuditEventViewModel[];
  readonly persistedRecommendations: readonly PersistedRecommendationWithApproval[];
  readonly executiveReports: readonly PersistedExecutiveReport[];
  readonly kpiSummary: PeriodKpiSummary;
  readonly onboardingChecklist: readonly GuidedOnboardingStep[];
  readonly isGoogleAdsOAuthConfigured: boolean;
  readonly domainTables: readonly string[];
}

function computeDeltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export async function loadOperationalWorkspaceBySessionToken(params: {
  readonly sessionToken: string;
  readonly clientId?: string;
  readonly adAccountId?: string;
  readonly campaignId?: string;
  readonly periodDays?: number;
}): Promise<OperationalWorkspaceData> {
  const periodDays = params.periodDays ?? 30;
  const session = await resolveUnifiedAuthJsPostgresSession({
    rawCookieOrToken: params.sessionToken,
  });

  const isGoogleOAuthReady = isGoogleAdsOAuthEnvReady();

  return await withTenantTransaction(session.context, async (tx) => {
    const repo = new PersistentDrizzleTenantRepository(tx);
    const aiRepo = new PersistentAIRecommendationsAndReportsRepository(tx);

    const activeOrgRow = await repo.getOrganization(session.context);
    const clientRows = await repo.listClients(session.context);
    const accountRows = await repo.listAdAccounts(session.context, {
      clientId: params.clientId,
    });
    const integrationRows = await repo.listPublicIntegrations(session.context);
    const campaignRowsAll = await repo.listCampaigns(session.context, {
      clientId: params.clientId,
      adAccountId: params.adAccountId,
    });
    const campaignRows = params.campaignId
      ? campaignRowsAll.filter((c) => c.id === params.campaignId)
      : campaignRowsAll;

    const syncRunRows = await repo.listSyncRuns(session.context);
    const auditRows = await repo.listAuditLogs(session.context, 40);
    const persistedRecommendations = await aiRepo.listRecommendations(
      session.context,
      { clientId: params.clientId }
    );
    const executiveReports = await aiRepo.listExecutiveReports(
      session.context,
      { clientId: params.clientId }
    );

    // Load memberships & users for team settings
    const orgMemberships: (typeof schema.memberships.$inferSelect)[] = await tx
      .select()
      .from(schema.memberships)
      .where(
        eq(schema.memberships.organizationId, session.context.organizationId)
      );
    const memberUserIds = orgMemberships.map((m) => m.userId);
    const userRows: (typeof schema.users.$inferSelect)[] =
      memberUserIds.length > 0
        ? await tx
            .select()
            .from(schema.users)
            .where(inArray(schema.users.id, memberUserIds))
        : [];
    const clientAccessRows: (typeof schema.memberClientAccess.$inferSelect)[] =
      await tx
        .select()
        .from(schema.memberClientAccess)
        .where(
          eq(
            schema.memberClientAccess.organizationId,
            session.context.organizationId
          )
        );

    const clientMap = new Map(clientRows.map((c) => [c.id, c]));
    const accountMap = new Map(accountRows.map((a) => [a.id, a]));
    const campaignMap = new Map(campaignRows.map((c) => [c.id, c]));
    const campaignIds = campaignRows.map((c) => c.id);

    // Load real persisted operational entities (explicit org filter + RLS)
    const [
      adGroupRows,
      adRows,
      keywordRows,
      searchTermRows,
      conversionRows,
      budgetRows,
      automationRuleRows,
      automationRunRows,
      dailyMetricRows,
    ] = await Promise.all([
      tx
        .select()
        .from(schema.adGroups)
        .where(
          eq(schema.adGroups.organizationId, session.context.organizationId)
        )
        .orderBy(desc(schema.adGroups.updatedAt)),
      tx
        .select()
        .from(schema.ads)
        .where(eq(schema.ads.organizationId, session.context.organizationId))
        .orderBy(desc(schema.ads.updatedAt)),
      tx
        .select()
        .from(schema.keywords)
        .where(
          eq(schema.keywords.organizationId, session.context.organizationId)
        )
        .orderBy(desc(schema.keywords.updatedAt)),
      tx
        .select()
        .from(schema.searchTerms)
        .where(
          eq(schema.searchTerms.organizationId, session.context.organizationId)
        )
        .orderBy(desc(schema.searchTerms.costCents)),
      tx
        .select()
        .from(schema.conversions)
        .where(
          eq(schema.conversions.organizationId, session.context.organizationId)
        )
        .orderBy(desc(schema.conversions.createdAt)),
      tx
        .select()
        .from(schema.budgets)
        .where(
          eq(schema.budgets.organizationId, session.context.organizationId)
        )
        .orderBy(desc(schema.budgets.periodMonth)),
      tx
        .select()
        .from(schema.automationRules)
        .where(
          eq(
            schema.automationRules.organizationId,
            session.context.organizationId
          )
        )
        .orderBy(desc(schema.automationRules.createdAt)),
      tx
        .select()
        .from(schema.automationRuns)
        .where(
          eq(
            schema.automationRuns.organizationId,
            session.context.organizationId
          )
        )
        .orderBy(desc(schema.automationRuns.executedAt)),
      campaignIds.length > 0
        ? tx
            .select()
            .from(schema.dailyMetrics)
            .where(
              and(
                eq(
                  schema.dailyMetrics.organizationId,
                  session.context.organizationId
                ),
                inArray(schema.dailyMetrics.campaignId, campaignIds)
              )
            )
        : Promise.resolve([] as (typeof schema.dailyMetrics.$inferSelect)[]),
    ]);

    const adGroupMap = new Map(adGroupRows.map((ag) => [ag.id, ag]));
    const ruleMap = new Map(automationRuleRows.map((r) => [r.id, r]));

    // Period filtering for KPIs and comparison with previous period
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setUTCDate(now.getUTCDate() - periodDays);
    const prevStart = new Date(currentStart);
    prevStart.setUTCDate(currentStart.getUTCDate() - periodDays);

    const currentStartStr = currentStart.toISOString().slice(0, 10);
    const prevStartStr = prevStart.toISOString().slice(0, 10);

    const currentMetrics = dailyMetricRows.filter(
      (m) => m.metricDate >= currentStartStr
    );
    const previousMetrics = dailyMetricRows.filter(
      (m) => m.metricDate >= prevStartStr && m.metricDate < currentStartStr
    );

    const sumMetrics = (rows: readonly (typeof schema.dailyMetrics.$inferSelect)[]) => {
      const spendCents = rows.reduce((s, r) => s + Number(r.costCents), 0);
      const impressions = rows.reduce((s, r) => s + Number(r.impressions), 0);
      const clicks = rows.reduce((s, r) => s + Number(r.clicks), 0);
      const conversions = rows.reduce((s, r) => s + Number(r.conversions), 0);
      const conversionValueCents = rows.reduce(
        (s, r) => s + Number(r.conversionValueCents),
        0
      );
      return {
        spendBrl: Number((spendCents / 100).toFixed(2)),
        impressions,
        clicks,
        conversions: Number(conversions.toFixed(2)),
        conversionValueBrl: Number((conversionValueCents / 100).toFixed(2)),
      };
    };

    const cur = sumMetrics(currentMetrics);
    const prev = sumMetrics(previousMetrics);

    const scopedClients = params.clientId
      ? clientRows.filter((c) => c.id === params.clientId)
      : clientRows;
    const totalMonthlyBudgetBrl = Number(
      (
        scopedClients.reduce((s, c) => s + Number(c.monthlyBudgetCapCents), 0) /
        100
      ).toFixed(2)
    );

    const kpiSummary: PeriodKpiSummary = {
      hasData: currentMetrics.length > 0,
      periodDays,
      spendBrl: cur.spendBrl,
      impressions: cur.impressions,
      clicks: cur.clicks,
      ctrPct:
        cur.impressions > 0
          ? Number(((cur.clicks / cur.impressions) * 100).toFixed(2))
          : null,
      cpcBrl:
        cur.clicks > 0 ? Number((cur.spendBrl / cur.clicks).toFixed(2)) : null,
      conversions: cur.conversions,
      conversionRatePct:
        cur.clicks > 0
          ? Number(((cur.conversions / cur.clicks) * 100).toFixed(2))
          : null,
      cpaBrl:
        cur.conversions > 0
          ? Number((cur.spendBrl / cur.conversions).toFixed(2))
          : null,
      roas:
        cur.spendBrl > 0
          ? Number((cur.conversionValueBrl / cur.spendBrl).toFixed(2))
          : null,
      totalMonthlyBudgetBrl,
      budgetConsumptionPct:
        totalMonthlyBudgetBrl > 0
          ? Number(((cur.spendBrl / totalMonthlyBudgetBrl) * 100).toFixed(1))
          : null,
      previousPeriod: {
        hasData: previousMetrics.length > 0,
        spendBrl: prev.spendBrl,
        conversions: prev.conversions,
        clicks: prev.clicks,
        impressions: prev.impressions,
        spendDeltaPct: computeDeltaPct(cur.spendBrl, prev.spendBrl),
        conversionsDeltaPct: computeDeltaPct(cur.conversions, prev.conversions),
        clicksDeltaPct: computeDeltaPct(cur.clicks, prev.clicks),
      },
    };

    // Normalized campaigns
    const normalizedCampaigns: NormalizedCampaign[] = campaignRows.map((c) => {
      const acc = accountMap.get(c.adAccountId);
      const cli = acc ? clientMap.get(acc.clientId) : undefined;
      const campMetrics = currentMetrics.filter((m) => m.campaignId === c.id);
      const cSum = sumMetrics(campMetrics);

      return {
        id: c.id,
        organizationId: c.organizationId,
        clientId: cli?.id ?? acc?.clientId ?? "",
        clientName: cli?.name ?? "Cliente",
        provider: c.provider as AdProviderType,
        externalCampaignId: c.externalCampaignId,
        name: c.name,
        channelType: c.channelType as NormalizedCampaign["channelType"],
        biddingStrategy: c.biddingStrategy,
        status: c.status as NormalizedCampaign["status"],
        dailyBudgetBrl: Number((Number(c.dailyBudgetCents) / 100).toFixed(2)),
        spend7dBrl: cSum.spendBrl,
        impressions7d: cSum.impressions,
        clicks7d: cSum.clicks,
        conversions7d: cSum.conversions,
        ctr7dPct:
          cSum.impressions > 0
            ? Number(((cSum.clicks / cSum.impressions) * 100).toFixed(2))
            : 0,
        cpa7dBrl:
          cSum.conversions > 0
            ? Number((cSum.spendBrl / cSum.conversions).toFixed(2))
            : 0,
        roas7d:
          cSum.spendBrl > 0
            ? Number((cSum.conversionValueBrl / cSum.spendBrl).toFixed(2))
            : 0,
        targetCpaBrl: cli?.targetCpaCents
          ? Number((cli.targetCpaCents / 100).toFixed(2))
          : 0,
        lastAutomatedChangeAt: null,
        isDemoData: false,
      };
    });

    // Daily timeline grouped by date
    const byDate = new Map<
      string,
      {
        spendCents: number;
        conversions: number;
        clicks: number;
        impressions: number;
        conversionValueCents: number;
      }
    >();
    for (const m of currentMetrics) {
      const bucket = byDate.get(m.metricDate) ?? {
        spendCents: 0,
        conversions: 0,
        clicks: 0,
        impressions: 0,
        conversionValueCents: 0,
      };
      bucket.spendCents += Number(m.costCents);
      bucket.conversions += Number(m.conversions);
      bucket.clicks += Number(m.clicks);
      bucket.impressions += Number(m.impressions);
      bucket.conversionValueCents += Number(m.conversionValueCents);
      byDate.set(m.metricDate, bucket);
    }

    const dailyMetrics: NormalizedDailyMetric[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateStr, b]) => {
        const spendBrl = Number((b.spendCents / 100).toFixed(2));
        const convValBrl = Number((b.conversionValueCents / 100).toFixed(2));
        return {
          date: dateStr,
          label: `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`,
          spendBrl,
          conversions: Number(b.conversions.toFixed(2)),
          clicks: b.clicks,
          impressions: b.impressions,
          cpaBrl:
            b.conversions > 0
              ? Number((spendBrl / b.conversions).toFixed(2))
              : 0,
          roas:
            spendBrl > 0 ? Number((convValBrl / spendBrl).toFixed(2)) : 0,
          isDemoData: false,
        };
      });

    const clients: CommercialClientViewModel[] = clientRows.map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      name: c.name,
      industry: c.industry,
      websiteUrl: c.websiteUrl ?? null,
      monthlyBudgetCapBrl: Number(
        (Number(c.monthlyBudgetCapCents) / 100).toFixed(2)
      ),
      targetCpaBrl: c.targetCpaCents
        ? Number((c.targetCpaCents / 100).toFixed(2))
        : null,
      targetRoas: c.targetRoas ? Number(c.targetRoas) : null,
      isActive: c.isActive,
      isDemoData: false,
      createdAtIso: c.createdAt.toISOString(),
    }));

    const adAccounts: AdAccountRecordViewModel[] = accountRows.map((a) => ({
      id: a.id,
      organizationId: a.organizationId,
      clientId: a.clientId,
      clientName: clientMap.get(a.clientId)?.name ?? "Cliente",
      provider: a.provider as AdProviderType,
      externalAccountId: a.externalAccountId,
      managerCustomerId: a.managerCustomerId,
      isMccAccount: a.isMccAccount,
      isSelectedForSync: a.isSelectedForSync,
      name: a.name,
      currencyCode: a.currencyCode,
      timezone: a.timezone,
      isDemoData: false,
    }));

    const integrations: IntegrationHealthViewModel[] = integrationRows.map(
      (i) => ({
        id: i.id,
        organizationId: i.organizationId,
        provider: i.provider as AdProviderType,
        label: i.externalAccountLabel,
        status: i.status as IntegrationHealthViewModel["status"],
        mode: "READ_ONLY",
        managerCustomerId: i.managerCustomerId,
        lastSyncedAtIso: i.lastSyncedAt ? i.lastSyncedAt.toISOString() : null,
        lastCheckpoint: i.lastCheckpointToken,
        latencyMs: 0,
        message:
          i.status === "CONNECTED"
            ? "Conectado via OAuth 2.0 (READ_ONLY)."
            : i.status === "EXPIRED"
              ? "Token expirado — reautorize a conta."
              : "Aguardando autorização OAuth 2.0 (READ_ONLY).",
        isDemoData: false,
      })
    );

    const syncHistory: SyncRunViewModel[] = syncRunRows.map((s) => ({
      id: s.id,
      integrationId: s.integrationId,
      provider: s.provider as AdProviderType,
      status: s.status,
      checkpointToken: s.checkpointToken,
      entitiesSynced: (s.entitiesSynced ?? {}) as Record<string, number>,
      startedAtIso: s.startedAt.toISOString(),
      completedAtIso: s.completedAt ? s.completedAt.toISOString() : null,
      errorCode: s.errorCode,
    }));

    const auditTrail: AuditEventViewModel[] = auditRows.map((a) => ({
      id: a.id,
      timestamp: a.createdAt.toISOString(),
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      detail: JSON.stringify(a.newState ?? {}),
    }));

    const members: MemberRecordViewModel[] = orgMemberships.map((m) => {
      const u = userRows.find((usr) => usr.id === m.userId);
      const allowedClientIds = clientAccessRows
        .filter((ca) => ca.membershipId === m.id)
        .map((ca) => ca.clientId);
      return {
        id: m.id,
        organizationId: m.organizationId,
        userId: m.userId,
        fullName: u?.fullName ?? "Usuário",
        email: u?.email ?? "",
        role: m.role as UserRole,
        allowedClientIds,
      };
    });

    const organizations: OrganizationOption[] =
      session.availableOrganizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        executionMode: "READ_ONLY",
        timezone: activeOrgRow.timezone,
        currencyCode: activeOrgRow.currencyCode,
        maxDailyBudgetChangePct: activeOrgRow.maxDailyBudgetChangePct,
        minCooldownMinutes: activeOrgRow.minCooldownMinutes,
        emergencyStopActive: activeOrgRow.emergencyStopActive,
        isDemo: false,
      }));

    const adGroups: AdGroupRowViewModel[] = adGroupRows.map((ag) => {
      const camp = campaignMap.get(ag.campaignId);
      const acc = camp ? accountMap.get(camp.adAccountId) : undefined;
      const cli = acc ? clientMap.get(acc.clientId) : undefined;
      return {
        id: ag.id,
        campaignId: ag.campaignId,
        campaignName: camp?.name ?? "Campanha",
        clientName: cli?.name ?? "Cliente",
        name: ag.name,
        status: ag.status,
        defaultCpcBidBrl: ag.defaultCpcBidCents
          ? Number((ag.defaultCpcBidCents / 100).toFixed(2))
          : null,
        externalAdGroupId: ag.externalAdGroupId,
      };
    });

    const ads: AdRowViewModel[] = adRows.map((ad) => {
      const ag = adGroupMap.get(ad.adGroupId);
      const camp = ag ? campaignMap.get(ag.campaignId) : undefined;
      return {
        id: ad.id,
        adGroupId: ad.adGroupId,
        adGroupName: ag?.name ?? "Grupo de anúncios",
        campaignName: camp?.name ?? "Campanha",
        adType: ad.adType,
        headlines: ad.headlines ?? [],
        descriptions: ad.descriptions ?? [],
        finalUrl: ad.finalUrl,
        policyApprovalStatus: ad.policyApprovalStatus,
        status: ad.status,
      };
    });

    const keywords: KeywordRowViewModel[] = keywordRows.map((kw) => {
      const ag = adGroupMap.get(kw.adGroupId);
      const camp = ag ? campaignMap.get(ag.campaignId) : undefined;
      return {
        id: kw.id,
        adGroupId: kw.adGroupId,
        adGroupName: ag?.name ?? "Grupo de anúncios",
        campaignName: camp?.name ?? "Campanha",
        text: kw.text,
        matchType: kw.matchType,
        isNegative: kw.isNegative,
        qualityScore: kw.qualityScore,
        cpcBidBrl: kw.cpcBidCents
          ? Number((kw.cpcBidCents / 100).toFixed(2))
          : null,
        status: kw.status,
      };
    });

    const searchTerms: SearchTermRowViewModel[] = searchTermRows.map((st) => ({
      id: st.id,
      campaignId: st.campaignId,
      campaignName: campaignMap.get(st.campaignId)?.name ?? "Campanha",
      searchTerm: st.searchTerm,
      impressions: st.impressions,
      clicks: st.clicks,
      spendBrl: Number((Number(st.costCents) / 100).toFixed(2)),
      conversions: Number(st.conversions),
      observedDate: st.observedDate,
    }));

    const conversions: ConversionRowViewModel[] = conversionRows.map((cv) => ({
      id: cv.id,
      adAccountId: cv.adAccountId,
      adAccountName: accountMap.get(cv.adAccountId)?.name ?? "Conta de anúncios",
      name: cv.name,
      category: cv.category,
      attributionModel: cv.attributionModel,
      lookbackWindowDays: cv.lookbackWindowDays,
      isPrimaryGoal: cv.isPrimaryGoal,
      trackingStatus: cv.trackingStatus,
      lastReceivedAtIso: cv.lastReceivedAt
        ? cv.lastReceivedAt.toISOString()
        : null,
    }));

    const budgets: BudgetRowViewModel[] = budgetRows.map((b) => {
      const planned = Number((Number(b.allocatedCents) / 100).toFixed(2));
      const spent = Number((Number(b.spentCents) / 100).toFixed(2));
      const pct = planned > 0 ? Number(((spent / planned) * 100).toFixed(1)) : 0;
      const status: BudgetRowViewModel["status"] =
        spent <= 0
          ? "SEM_GASTO"
          : pct >= 100
            ? "EXCEDIDO"
            : pct >= b.alertThresholdPct
              ? "ATENCAO"
              : "SAUDAVEL";
      return {
        id: b.id,
        clientId: b.clientId,
        clientName: clientMap.get(b.clientId)?.name ?? "Cliente",
        periodMonth: b.periodMonth,
        plannedBudgetBrl: planned,
        spentBudgetBrl: spent,
        consumptionPct: pct,
        pacingAlertThresholdPct: b.alertThresholdPct,
        status,
      };
    });

    const automationRules: AutomationRuleRowViewModel[] =
      automationRuleRows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isEnabled: r.isEnabled,
        executionMode: activeOrgRow.executionMode,
        riskLevel: "LOW",
        cooldownMinutes: r.cooldownMinutes,
        lastTriggeredAtIso: r.updatedAt.toISOString(),
      }));

    const automationRuns: AutomationRunRowViewModel[] = automationRunRows.map(
      (run) => ({
        id: run.id,
        ruleId: run.ruleId,
        ruleName: ruleMap.get(run.ruleId)?.name ?? "Regra",
        status: run.blockedReason
          ? `BLOQUEADA (${run.blockedReason})`
          : run.stageReached,
        isSimulation: run.simulationOutput !== null,
        executedAtIso: run.executedAt.toISOString(),
      })
    );

    const integrationCatalog = buildIntegrationCatalog({
      integrations,
      syncHistory,
      isGoogleAdsOAuthConfigured: isGoogleOAuthReady,
    });

    const onboardingChecklist = buildGuidedOnboardingChecklist({
      organizationName: activeOrgRow.name,
      organizationTimezone: activeOrgRow.timezone,
      clients,
      adAccounts,
      integrations,
      syncHistory,
      persistedRecommendations,
      executiveReports,
      isGoogleAdsOAuthConfigured: isGoogleOAuthReady,
    });

    return {
      organizationId: activeOrgRow.id,
      organizationName: activeOrgRow.name,
      organizationSlug: activeOrgRow.slug,
      organizationTimezone: activeOrgRow.timezone,
      organizationCurrency: activeOrgRow.currencyCode,
      executionMode: "READ_ONLY",
      emergencyStopActive: activeOrgRow.emergencyStopActive,
      authenticatedUserEmail: session.user.email,
      authenticatedUserName: session.user.fullName,
      authenticatedUserRole: session.context.role,
      organizations,
      clients,
      adAccounts,
      members,
      integrations,
      integrationCatalog,
      campaigns: normalizedCampaigns,
      dailyMetrics,
      adGroups,
      ads,
      keywords,
      searchTerms,
      conversions,
      budgets,
      automationRules,
      automationRuns,
      syncHistory,
      auditTrail,
      persistedRecommendations,
      executiveReports,
      kpiSummary,
      onboardingChecklist,
      isGoogleAdsOAuthConfigured: isGoogleOAuthReady,
      domainTables: [...schema.ALL_DOMAIN_TABLES],
    };
  });
}

/**
 * Authoritative Server Component guard for all 15+ authenticated commercial routes.
 * Redirects to `/login` when unauthenticated or session expired/revoked.
 */
export async function requireOperationalWorkspace(filters?: {
  readonly clientId?: string;
  readonly adAccountId?: string;
  readonly campaignId?: string;
  readonly periodDays?: number;
}): Promise<OperationalWorkspaceData> {
  const cookieStore = await cookies();
  const sessionToken =
    cookieStore.get(SECURE_AUTHJS_SESSION_COOKIE_NAME)?.value?.trim() ??
    cookieStore.get(AUTHJS_SESSION_COOKIE_NAME)?.value?.trim();

  if (!sessionToken) {
    redirect("/login");
  }

  try {
    return await loadOperationalWorkspaceBySessionToken({
      sessionToken,
      ...filters,
    });
  } catch {
    redirect("/login");
  }
}
